# RewindAI Frontend

Main participant-facing web cockpit and admin dashboard.

## What It Does

- User registration, login, and group assignment.
- Natural interview entry.
- Biography, graph, and mental-model viewing.
- simulation-test launch and account handoff.
- Self, generic AI, and clone-style reflection flows.
- Privacy-bounded admin dashboard.

## Run Locally

```bash
npm install
npm run dev
```

Default local API targets:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_REWIND_APP_URL=http://127.0.0.1:5174
```

## Check

```bash
npm run build
npm run smoke:rewindai-ui
npm run smoke:auth
npm run smoke:interview-gate
```

Do not put model-provider keys in frontend `VITE_*` variables.

## Authentication boundary

Login succeeds only after the backend accepts the submitted credentials. A
rejected login never creates an account, restores a cached demo token, or enters
the cockpit. If an ephemeral demo database loses an account, the participant
must explicitly use the registration page to create it again; this does not
restore the lost account data.

The login and registration pages do not cache passwords or provider secrets.
They retain the existing authenticated-session token handling in `authStore`;
logout clears that session and the current user's local evidence. There is no
separate demo credential store or automatic account-recreation fallback.
