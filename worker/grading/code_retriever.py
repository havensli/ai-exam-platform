from __future__ import annotations

from pathlib import Path

IGNORED_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', '.next', 'build'}
MAX_FILE_SIZE = 500_000  # 500 KB — skip binary/huge files


class CodeRetriever:
    def __init__(self, repo_path: str) -> None:
        self.repo_path = Path(repo_path).resolve()

    def get_directory_tree(self, max_depth: int = 3) -> str:
        lines: list[str] = [str(self.repo_path.name) + '/']
        self._walk_tree(self.repo_path, lines, prefix='', depth=0, max_depth=max_depth)
        return '\n'.join(lines)

    def _walk_tree(self, path: Path, lines: list[str], prefix: str, depth: int, max_depth: int) -> None:
        if depth >= max_depth:
            return
        try:
            entries = sorted(path.iterdir(), key=lambda p: (p.is_file(), p.name))
        except PermissionError:
            return
        for i, entry in enumerate(entries):
            if entry.name in IGNORED_DIRS:
                continue
            connector = '└── ' if i == len(entries) - 1 else '├── '
            lines.append(f"{prefix}{connector}{entry.name}{'/' if entry.is_dir() else ''}")
            if entry.is_dir():
                extension = '    ' if i == len(entries) - 1 else '│   '
                self._walk_tree(entry, lines, prefix + extension, depth + 1, max_depth)

    def read_file(self, relative_path: str) -> str:
        resolved = (self.repo_path / relative_path).resolve()
        if not str(resolved).startswith(str(self.repo_path)):
            raise ValueError(f'Path traversal attempt blocked: {relative_path}')
        if not resolved.exists():
            raise FileNotFoundError(f'File not found: {relative_path}')
        if resolved.stat().st_size > MAX_FILE_SIZE:
            raise ValueError(f'File too large (>{MAX_FILE_SIZE} bytes): {relative_path}')
        return resolved.read_text(encoding='utf-8', errors='replace')

    def search_files(self, pattern: str) -> list[str]:
        results = [str(p.relative_to(self.repo_path)) for p in self._glob(pattern)]
        return sorted(results)[:50]  # cap results

    def grep(self, keyword: str, file_pattern: str = '**/*') -> list[dict]:
        results: list[dict] = []
        for path in self._glob(file_pattern):
            rel = str(path.relative_to(self.repo_path))
            if path.stat().st_size > MAX_FILE_SIZE:
                continue
            try:
                for line_no, line in enumerate(path.read_text(encoding='utf-8', errors='replace').splitlines(), 1):
                    if keyword.lower() in line.lower():
                        results.append({'file': rel, 'line_no': line_no, 'content': line.strip()})
                        if len(results) >= 100:
                            return results
            except OSError:
                continue
        return results

    def validate_evidence_ref(self, file_path: str, line_start: int, line_end: int) -> bool:
        try:
            content = self.read_file(file_path)
        except (ValueError, FileNotFoundError, OSError):
            return False
        lines = content.splitlines()
        return 1 <= line_start <= len(lines) and 1 <= line_end <= len(lines)

    def read_lines(self, file_path: str, line_start: int, line_end: int) -> str:
        content = self.read_file(file_path)
        lines = content.splitlines()
        return '\n'.join(lines[line_start - 1:line_end])

    def _glob(self, pattern: str) -> list[Path]:
        results = []
        for path in self.repo_path.glob(pattern):
            if not path.is_file():
                continue
            if any(part in IGNORED_DIRS for part in path.relative_to(self.repo_path).parts):
                continue
            results.append(path)
        return results
