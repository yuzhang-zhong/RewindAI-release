# RewindAI Frontend

Main participant-facing web cockpit and admin dashboard.

## What it does

The web cockpit is the participant-facing interface for the RewindAI research
flow. It handles:

- registration, login and study-group assignment
- the interview experience and session gating
- biography, relationship graph and mental-model review
- simulator launch and handoff back to reflection/replay
- privacy-bounded admin access for local operation and review

In other words, this app is the control surface for the whole autobiographical
reconstruction loop: collect evidence, inspect it, revise it, then test it in a
shared decision environment.

## Project shape

A quick mental model for the front-end:

- `src/App.tsx` is the route shell and auth gate.
- `src/components/Home.tsx` is the main participant dashboard and decision
  cockpit.
- `src/components/chat/` contains the interview and message flows.
- `src/components/biography/` contains the editable biography experience.
- `src/stores/authStore.ts` holds the authenticated session state.
- `src/utils/` holds API helpers, local evidence persistence and language/config
  helpers.

This keeps the product flow readable without needing to understand the entire
research backend just to navigate the UI.

## Run locally

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
