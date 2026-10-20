"""Resolve explicitly configured GCP credential paths without reading secrets."""

from pathlib import Path


STORYSAGE_ROOT = Path(__file__).resolve().parents[3]
WORKSPACE_ROOT = STORYSAGE_ROOT.parent


def _candidate_paths(raw_path: str | None) -> list[Path]:
    value = (raw_path or "").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1].strip()
    if not value:
        return []

    try:
        path = Path(value).expanduser()
        candidates = [path] if path.is_absolute() else [
            Path.cwd() / path,
            STORYSAGE_ROOT / path,
            WORKSPACE_ROOT / path,
        ]
        return list(dict.fromkeys(candidates))
    except (OSError, RuntimeError, ValueError):
        return []


def resolve_gcp_credentials_path(raw_path: str | None) -> Path | None:
    """Find a credential file at the configured path, or return ``None``.

    Relative paths are checked against the current directory, StorySage root,
    then repository root, in that order. No credentials are discovered, read,
    generated, or validated here; provider SDKs validate the selected file.
    """
    for candidate in _candidate_paths(raw_path):
        try:
            if candidate.is_file():
                return candidate.resolve()
        except (OSError, RuntimeError, ValueError):
            continue
    return None


def require_gcp_credentials_path(raw_path: str | None) -> Path:
    """Resolve a provider's credential file or raise an actionable error."""
    resolved = resolve_gcp_credentials_path(raw_path)
    if resolved is not None:
        return resolved

    checked = ", ".join(str(path) for path in _candidate_paths(raw_path))
    raise ValueError(
        "Set GCP_CREDENTIALS to an existing service-account JSON file. "
        f"Checked: {checked or '(no usable path configured)'}. "
        "Keep credential files outside version control."
    )
