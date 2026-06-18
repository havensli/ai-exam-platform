import pytest

from grading.code_retriever import CodeRetriever, MAX_FILE_SIZE


@pytest.fixture
def repo(tmp_path):
    (tmp_path / 'src').mkdir()
    (tmp_path / 'src' / 'main.py').write_text('line1\nline2\nline3\n')
    (tmp_path / 'README.md').write_text('hello world\nkeyword here\n')
    ignored = tmp_path / 'node_modules' / 'pkg'
    ignored.mkdir(parents=True)
    (ignored / 'lib.js').write_text('module.exports = {}\n')
    secret = tmp_path.parent / 'outside_secret.txt'
    secret.write_text('top secret\n')
    return CodeRetriever(str(tmp_path))


class TestReadFile:
    def test_reads_file_content(self, repo):
        assert repo.read_file('src/main.py') == 'line1\nline2\nline3\n'

    def test_blocks_path_traversal(self, repo):
        with pytest.raises(ValueError, match='Path traversal'):
            repo.read_file('../outside_secret.txt')

    def test_raises_for_missing_file(self, repo):
        with pytest.raises(FileNotFoundError):
            repo.read_file('does/not/exist.py')

    def test_rejects_oversized_file(self, repo, tmp_path):
        big = tmp_path / 'big.txt'
        big.write_bytes(b'x' * (MAX_FILE_SIZE + 1))
        with pytest.raises(ValueError, match='too large'):
            repo.read_file('big.txt')


class TestValidateEvidenceRef:
    def test_true_for_valid_range(self, repo):
        assert repo.validate_evidence_ref('src/main.py', 1, 2) is True

    def test_false_for_out_of_range(self, repo):
        assert repo.validate_evidence_ref('src/main.py', 1, 100) is False

    def test_false_for_missing_file(self, repo):
        assert repo.validate_evidence_ref('nope.py', 1, 1) is False

    def test_false_for_path_traversal_attempt(self, repo):
        assert repo.validate_evidence_ref('../outside_secret.txt', 1, 1) is False


class TestReadLines:
    def test_returns_requested_slice(self, repo):
        assert repo.read_lines('src/main.py', 2, 3) == 'line2\nline3'


class TestSearchAndGrep:
    def test_search_files_excludes_ignored_dirs(self, repo):
        results = repo.search_files('**/*.js')
        assert results == []

    def test_search_files_finds_matching_files(self, repo):
        results = repo.search_files('**/*.py')
        assert results == ['src/main.py']

    def test_grep_finds_keyword_case_insensitively(self, repo):
        hits = repo.grep('KEYWORD')
        assert any(h['file'] == 'README.md' and h['line_no'] == 2 for h in hits)

    def test_grep_excludes_ignored_dirs(self, repo):
        hits = repo.grep('module.exports')
        assert hits == []


class TestDirectoryTree:
    def test_excludes_ignored_dirs(self, repo):
        tree = repo.get_directory_tree()
        assert 'node_modules' not in tree
        assert 'main.py' in tree
