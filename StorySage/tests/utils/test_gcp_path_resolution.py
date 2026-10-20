"""Offline regression coverage for the public release's credential helper."""

import json
from pathlib import Path

import pytest

from utils.llm import gcp_credentials


@pytest.fixture
def roots(tmp_path, monkeypatch):
    cwd = tmp_path / "cwd"
    project = tmp_path / "workspace" / "StorySage"
    cwd.mkdir()
    project.mkdir(parents=True)
    monkeypatch.chdir(cwd)
    monkeypatch.setattr(gcp_credentials, "STORYSAGE_ROOT", project)
    monkeypatch.setattr(gcp_credentials, "WORKSPACE_ROOT", project.parent)
    return cwd, project, project.parent


@pytest.mark.parametrize("raw_path", [None, "", "  ", '""', "''", "\0"])
def test_unconfigured_or_invalid_path_is_not_resolved(raw_path, roots):
    assert gcp_credentials.resolve_gcp_credentials_path(raw_path) is None
    with pytest.raises(ValueError, match="GCP_CREDENTIALS.*Checked:"):
        gcp_credentials.require_gcp_credentials_path(raw_path)


@pytest.mark.parametrize("root_index", [0, 1, 2])
def test_relative_paths_resolve_against_supported_roots(roots, root_index):
    credential = roots[root_index] / "fixture.json"
    credential.write_text("{}", encoding="utf-8")
    assert gcp_credentials.resolve_gcp_credentials_path("fixture.json") == credential
    assert gcp_credentials.require_gcp_credentials_path("fixture.json") == credential


def test_cwd_takes_precedence_over_project_and_workspace(roots):
    for root in roots:
        (root / "fixture.json").write_text("{}", encoding="utf-8")
    assert gcp_credentials.resolve_gcp_credentials_path("fixture.json") == roots[0] / "fixture.json"
    (roots[0] / "fixture.json").unlink()
    assert gcp_credentials.resolve_gcp_credentials_path("fixture.json") == roots[1] / "fixture.json"


@pytest.mark.parametrize("quote", ["", "'", '"'])
def test_absolute_path_and_optional_quotes(roots, quote):
    credential = roots[0] / "fixture with spaces.json"
    credential.write_text("{}", encoding="utf-8")
    raw_path = f"  {quote}{credential}{quote}  "
    assert gcp_credentials.resolve_gcp_credentials_path(raw_path) == credential


def test_home_relative_path(roots, monkeypatch):
    monkeypatch.setenv("HOME", str(roots[0]))
    credential = roots[0] / "fixture.json"
    credential.write_text("{}", encoding="utf-8")
    assert gcp_credentials.resolve_gcp_credentials_path("~/fixture.json") == credential


def test_directories_are_not_credential_files(roots):
    assert gcp_credentials.resolve_gcp_credentials_path(str(roots[0])) is None


def test_missing_path_error_lists_candidates(roots):
    with pytest.raises(ValueError) as error:
        gcp_credentials.require_gcp_credentials_path("missing.json")
    for root in roots:
        assert str(root / "missing.json") in str(error.value)


def test_resolver_never_reads_credential_contents(roots, monkeypatch):
    credential = roots[0] / "fixture.json"
    credential.write_text("not real credentials", encoding="utf-8")

    def forbid_read(*args, **kwargs):
        raise AssertionError("Path resolution must not read credential contents")

    monkeypatch.setattr(Path, "open", forbid_read)
    assert gcp_credentials.resolve_gcp_credentials_path(str(credential)) == credential


def test_provider_status_imports_without_gcp_configuration(roots, monkeypatch):
    from utils.llm.provider_status import get_llm_provider_status

    for name in ("GCP_PROJECT", "GCP_REGION", "GCP_CREDENTIALS", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MODEL_NAME", "gpt-4o")
    status = get_llm_provider_status()
    assert status["provider"] == "openai"
    assert status["missing"] == ["OPENAI_API_KEY"]


def test_vertex_status_does_not_leak_path_or_contents(roots, monkeypatch):
    from utils.llm.provider_status import get_llm_provider_status

    credential = roots[0] / "fixture.json"
    credential.write_text("not real credentials", encoding="utf-8")
    monkeypatch.setenv("MODEL_NAME", "gemini-2.0-flash")
    monkeypatch.setenv("GCP_PROJECT", "test-project")
    monkeypatch.setenv("GCP_REGION", "test-region")
    monkeypatch.setenv("GCP_CREDENTIALS", str(credential))
    status = get_llm_provider_status()
    assert status["configured"] is True  # File existence, not authentication.
    assert status["gcp"]["credentials_basename"] == credential.name
    assert str(credential) not in json.dumps(status)
    assert "not real credentials" not in json.dumps(status)

    credential.unlink()
    status = get_llm_provider_status()
    assert status["configured"] is False
    assert "GCP_CREDENTIALS_RESOLVED" in status["missing"]
