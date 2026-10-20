# StorySage Backend

RewindAI's interview, biography, graph, mental-model, simulation-trace,
reflection and admin APIs. Derived from [StorySage](https://github.com/ShayanTalaei/StorySage).

## Local development

Use Python 3.12 and a separate virtual environment. Configure your own untracked
`.env` using the [root quick start](../README.md#quick-start); do not commit keys,
passwords, credential files, participant data or local logs.

```bash
python -m venv .venv
# Activate .venv using the command for your shell.
python -m pip install -r requirements.runtime.lock
python src/main.py --mode setup_db
python -m uvicorn api.app:app --app-dir src --host 127.0.0.1 --port 8000
```

The runtime lock records the tested Linux/Python 3.12 dependency environment.
`requirements.production.txt` remains the runtime inventory; the older, broader
`requirements.txt` is retained but is not the audited quick-start environment.
The explicit uvicorn command binds the development API to loopback. Keep the
research service local unless you have reviewed its hosting/security requirements.

Health checks can run without a provider key. Model-backed interviews, generation,
embeddings and speech require their own provider configuration and may incur API
charges; no successful live-provider session is implied by an import or health test.
The optional graph compatibility service is configured separately.

## Offline checks

```bash
python -m pip install -r requirements.test.txt
python -m pytest tests/utils tests/biography tests/session_agenda
python scripts/smoke_rewindai_backend.py
```

The smoke script creates isolated temporary data/logs, uses synthetic fixtures,
stubs provider-backed clone replay, and fails on attempted non-loopback DNS/TCP
connections even when application code catches the network error. Question-bank
tests require live embeddings and are deliberately excluded from this command.

For Vertex models set `GCP_PROJECT`, `GCP_REGION` and `GCP_CREDENTIALS`. The latter
names your own file; relative paths are checked from the working directory,
`StorySage/`, then the repository root. The helper checks file existence only;
the provider SDK validates contents. No secret is bundled, read by the resolver,
or automatically generated.

See [release notes](../docs/RELEASE_NOTES.md) for repairs, provenance and limitations.
