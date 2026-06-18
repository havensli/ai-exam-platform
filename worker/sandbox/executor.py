"""
Docker sandbox executor — two-phase design:
  Phase 1: clone repo + install deps  (network ON,  host temp dir)
  Phase 2: run tests                  (network OFF, isolated container)
"""

from __future__ import annotations

import logging
import os
import shlex
import shutil
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

SECCOMP_PROFILE_PATH = Path(__file__).parent / "seccomp-profile.json"

# Resource limits applied to the test-execution container
SANDBOX_LIMITS = {
    "memory": "512m",
    "memory_swap": "512m",       # swap = memory means no extra swap
    "cpus": "1.0",
    "pids_limit": "128",         # prevents fork bombs
    "shm_size": "64m",
}

# Per-phase timeouts (seconds)
CLONE_TIMEOUT = 120
INSTALL_TIMEOUT = 300
RUN_TIMEOUT = 300


@dataclass
class SandboxResult:
    submission_id: str
    phase: str                   # "clone" | "install" | "run"
    returncode: int
    stdout: str
    stderr: str
    duration_seconds: float
    timed_out: bool = False
    oom_killed: bool = False
    error: Optional[str] = None
    artifacts: dict = field(default_factory=dict)

    @property
    def succeeded(self) -> bool:
        return self.returncode == 0 and not self.timed_out and not self.oom_killed


class SandboxExecutor:
    """
    Executes untrusted code repos in an isolated Docker container.

    Usage:
        executor = SandboxExecutor(docker_image="python:3.12-slim")
        result = executor.run(
            submission_id="sub_123",
            repo_url="https://github.com/...",
            git_token="ghp_...",          # optional, for private repos
            run_command="pytest tests/ -v --tb=short",
        )
    """

    def __init__(
        self,
        docker_image: str = "python:3.12-slim",
        work_base_dir: str = "/tmp/sandbox_workdir",
        seccomp_profile: Optional[Path] = SECCOMP_PROFILE_PATH,
    ):
        self.docker_image = docker_image
        self.work_base_dir = Path(work_base_dir)
        self.seccomp_profile = seccomp_profile
        self._verify_docker()

    def run(
        self,
        submission_id: str,
        repo_url: str,
        run_command: str,
        git_token: Optional[str] = None,
        install_command: Optional[str] = None,
        env_vars: Optional[dict[str, str]] = None,
    ) -> list[SandboxResult]:
        """
        Full lifecycle: clone → install → run tests.
        Returns one SandboxResult per phase. Caller should check each phase's
        .succeeded before proceeding to the next.
        """
        work_dir = self._make_work_dir(submission_id)
        results: list[SandboxResult] = []

        try:
            # Phase 1: clone (runs on host, needs network)
            clone_result = self._phase_clone(submission_id, repo_url, git_token, work_dir)
            results.append(clone_result)
            if not clone_result.succeeded:
                return results

            # Phase 2: install deps (Docker with network, read/write)
            if install_command:
                install_result = self._phase_install(
                    submission_id, install_command, work_dir
                )
                results.append(install_result)
                if not install_result.succeeded:
                    return results

            # Phase 3: run tests (Docker, fully isolated)
            run_result = self._phase_run(
                submission_id, run_command, work_dir, env_vars or {}
            )
            results.append(run_result)

        finally:
            self._cleanup_work_dir(work_dir)

        return results

    # ------------------------------------------------------------------
    # Phase implementations
    # ------------------------------------------------------------------

    def _phase_clone(
        self,
        submission_id: str,
        repo_url: str,
        git_token: Optional[str],
        work_dir: Path,
    ) -> SandboxResult:
        repo_dir = work_dir / "repo"
        repo_dir.mkdir()

        # Embed token in URL without logging it
        clone_url = self._build_clone_url(repo_url, git_token)
        cmd = ["git", "clone", "--depth=1", clone_url, str(repo_dir)]

        # Mask token in logs
        safe_cmd = ["git", "clone", "--depth=1", self._mask_token(repo_url, git_token), str(repo_dir)]
        logger.info("[%s] clone: %s", submission_id, " ".join(safe_cmd))

        return self._run_host_command(
            submission_id=submission_id,
            phase="clone",
            cmd=cmd,
            timeout=CLONE_TIMEOUT,
            cwd=work_dir,
            # Never log or store the actual URL with token
            log_cmd=safe_cmd,
        )

    def _phase_install(
        self,
        submission_id: str,
        install_command: str,
        work_dir: Path,
    ) -> SandboxResult:
        """
        Install dependencies inside Docker WITH network access.
        Uses a separate container that is removed after completion.
        """
        container_name = f"exam-install-{submission_id}-{uuid.uuid4().hex[:8]}"
        repo_mount = str(work_dir / "repo")

        cmd = [
            "docker", "run",
            "--rm",
            "--name", container_name,
            "--user", "1000:1000",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--memory", SANDBOX_LIMITS["memory"],
            "--memory-swap", SANDBOX_LIMITS["memory_swap"],
            "--cpus", SANDBOX_LIMITS["cpus"],
            "--pids-limit", SANDBOX_LIMITS["pids_limit"],
            # Read-write mount: install writes to node_modules / .venv
            "-v", f"{repo_mount}:/app:rw",
            "-w", "/app",
            self.docker_image,
            "sh", "-c", install_command,
        ]

        logger.info("[%s] install: %s", submission_id, install_command)
        return self._run_docker_command(
            submission_id=submission_id,
            phase="install",
            cmd=cmd,
            container_name=container_name,
            timeout=INSTALL_TIMEOUT,
        )

    def _phase_run(
        self,
        submission_id: str,
        run_command: str,
        work_dir: Path,
        env_vars: dict[str, str],
    ) -> SandboxResult:
        """
        Run tests inside Docker with FULL isolation:
          - no network
          - read-only filesystem (except /tmp tmpfs)
          - all caps dropped
          - seccomp profile applied
          - resource limits enforced
        """
        container_name = f"exam-run-{submission_id}-{uuid.uuid4().hex[:8]}"
        repo_mount = str(work_dir / "repo")

        env_args: list[str] = []
        for k, v in env_vars.items():
            env_args += ["-e", f"{k}={v}"]

        seccomp_arg = (
            f"seccomp={self.seccomp_profile}"
            if self.seccomp_profile and self.seccomp_profile.exists()
            else "unconfined"
        )

        cmd = [
            "docker", "run",
            "--rm",
            "--name", container_name,
            "--network", "none",                          # no network
            "--read-only",                                # immutable root FS
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m", # writable /tmp only
            "--user", "1000:1000",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--security-opt", seccomp_arg,
            "--memory", SANDBOX_LIMITS["memory"],
            "--memory-swap", SANDBOX_LIMITS["memory_swap"],
            "--cpus", SANDBOX_LIMITS["cpus"],
            "--pids-limit", SANDBOX_LIMITS["pids_limit"],
            "--shm-size", SANDBOX_LIMITS["shm_size"],
            # Repo is read-only inside the test container
            "-v", f"{repo_mount}:/app:ro",
            # Let tests write output to /tmp
            "-w", "/app",
            *env_args,
            self.docker_image,
            "sh", "-c", run_command,
        ]

        logger.info("[%s] run: %s", submission_id, run_command)
        return self._run_docker_command(
            submission_id=submission_id,
            phase="run",
            cmd=cmd,
            container_name=container_name,
            timeout=RUN_TIMEOUT,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _run_host_command(
        self,
        submission_id: str,
        phase: str,
        cmd: list[str],
        timeout: int,
        cwd: Optional[Path] = None,
        log_cmd: Optional[list[str]] = None,
    ) -> SandboxResult:
        start = time.monotonic()
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
            )
            duration = time.monotonic() - start
            return SandboxResult(
                submission_id=submission_id,
                phase=phase,
                returncode=proc.returncode,
                stdout=self._truncate(proc.stdout),
                stderr=self._truncate(proc.stderr),
                duration_seconds=round(duration, 2),
            )
        except subprocess.TimeoutExpired:
            return SandboxResult(
                submission_id=submission_id,
                phase=phase,
                returncode=-1,
                stdout="",
                stderr="",
                duration_seconds=timeout,
                timed_out=True,
                error=f"Phase '{phase}' timed out after {timeout}s",
            )

    def _run_docker_command(
        self,
        submission_id: str,
        phase: str,
        cmd: list[str],
        container_name: str,
        timeout: int,
    ) -> SandboxResult:
        start = time.monotonic()
        proc = None
        timed_out = False

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                stdout, stderr = proc.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                self._force_kill_container(container_name)
                proc.wait(timeout=10)
                stdout, stderr = proc.communicate()

        except Exception as exc:
            duration = time.monotonic() - start
            return SandboxResult(
                submission_id=submission_id,
                phase=phase,
                returncode=-1,
                stdout="",
                stderr="",
                duration_seconds=round(duration, 2),
                error=str(exc),
            )

        duration = time.monotonic() - start
        oom_killed = self._was_oom_killed(container_name, stderr)

        return SandboxResult(
            submission_id=submission_id,
            phase=phase,
            returncode=proc.returncode if not timed_out else -1,
            stdout=self._truncate(stdout),
            stderr=self._truncate(stderr),
            duration_seconds=round(duration, 2),
            timed_out=timed_out,
            oom_killed=oom_killed,
            error="OOM killed" if oom_killed else ("Timed out" if timed_out else None),
        )

    def _force_kill_container(self, container_name: str) -> None:
        """Send SIGKILL to the container — no grace period."""
        try:
            subprocess.run(
                ["docker", "kill", "--signal", "SIGKILL", container_name],
                capture_output=True,
                timeout=10,
            )
        except Exception:
            pass

    def _was_oom_killed(self, container_name: str, stderr: str) -> bool:
        return "Killed" in stderr or "OOMKilled" in stderr

    def _make_work_dir(self, submission_id: str) -> Path:
        self.work_base_dir.mkdir(parents=True, exist_ok=True)
        work_dir = self.work_base_dir / submission_id
        work_dir.mkdir(exist_ok=True)
        return work_dir

    def _cleanup_work_dir(self, work_dir: Path) -> None:
        """Remove the entire work directory including cloned repo."""
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
            logger.info("Cleaned up work dir: %s", work_dir)
        except Exception as exc:
            logger.warning("Failed to clean up %s: %s", work_dir, exc)

    def _build_clone_url(self, repo_url: str, token: Optional[str]) -> str:
        if not token:
            return repo_url
        # Inject token: https://token@github.com/...
        if repo_url.startswith("https://"):
            return repo_url.replace("https://", f"https://{token}@", 1)
        return repo_url

    def _mask_token(self, repo_url: str, token: Optional[str]) -> str:
        if not token:
            return repo_url
        return repo_url.replace("https://", "https://***@", 1)

    def _truncate(self, text: str, max_chars: int = 50_000) -> str:
        if len(text) > max_chars:
            return text[:max_chars] + f"\n... [truncated, total {len(text)} chars]"
        return text

    def _verify_docker(self) -> None:
        result = subprocess.run(["docker", "info"], capture_output=True, timeout=10)
        if result.returncode != 0:
            raise RuntimeError("Docker is not running or not accessible")
