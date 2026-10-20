# simulation-test

Campus decision simulation used by RewindAI to collect behavioral traces.

## What It Does

- Presents a shared random campus scenario deck.
- Records choices, response time, resource changes, and failure categories.
- Shows a run report and decision trajectory.
- Sends trace summaries back to StorySage when launched from RewindAI.
- Supports self, generic AI, and clone reflection entry points.

## Run Locally

```bash
npm install
npm run dev
```

Default local web URL: `http://127.0.0.1:5174`

## Check

```bash
npm run smoke:session
npm run smoke:bridge
npm run smoke:generator-auth
```

The Scenario Studio authentication smoke uses synthetic keys and mocked provider
responses. It checks unchanged credential transport and public-error redaction,
including long and URL-encoded keys, without calling a model provider. It does
not verify live provider access or end-to-end custom-card generation.

Production URLs and provider keys should be supplied through environment
variables, not committed files.
