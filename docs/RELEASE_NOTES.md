# Public release notes

## Full source, explicit limits

This repository retains the three public applications, optional graph service,
Scenario Studio, deployment examples, existing project assets and research code.
It is not a stripped-down simulator fork and does not claim to be a turnkey
hosted service. No private sibling repositories, participant records, credentials,
local databases, logs or unpublished results are incorporated.

Baseline: public anonymous-release commit
`63d1e7ef43e1aae3783050c884d04bcf6f5fc2a3`.

## Startup and regression repairs

- Restored the missing `utils/llm/gcp_credentials.py` module and narrowly exempted
  that source file from the broad credential-file ignore rule. Actual credential
  files remain ignored. The helper reads no credential contents and generates
  no secrets.
- Relative GCP paths resolve from the working directory, `StorySage/`, then the
  repository root. For Vertex models configure `GCP_PROJECT`, `GCP_REGION` and
  `GCP_CREDENTIALS`; the SDK, not the resolver, validates file contents.
- Deferred the AWS client until S3 use, so importing the voice router does not
  probe cloud metadata just to start a local server.
- Session agenda/logger paths read the runtime log directory, and malformed
  biography paths no longer fall through to an unrelated matching title.
- Added isolated regression coverage and maintained stale smoke expectations
  against the existing same-card replay protocol and study interview gates.
  Those protocol/threshold behaviors were not changed to make tests pass.

## Scenario Studio credential transport

The card generator previously applied display-text redaction to the credential
itself, turning credential-shaped keys into `[redacted]` before authentication.
The repair separates bounded, trim-only credential transport from content
sanitization, adds no storage or logs, and redacts provider errors before
truncating them as well as at the public response boundary. Mocked regressions
cover OpenAI, DeepSeek, Anthropic and Gemini success/error paths, invalid input
and long-key error echoes. No live provider call was made.

## Authentication repair

The public frontend imported an absent demo credential-store module. Its callers
also attempted registration after a failed login and could reuse a cached token
if recreation failed. Recreating a password/token cache would add an unsafe
persistence path, so those demo-only fallback calls were removed instead.

Normal explicit login, signup, group selection and normal authStore session-token
handling remain. No password cache or new token store was added. Login errors do
not silently create an account. The previous demo auto-login/recreation behavior
is no longer supported; users must explicitly sign in or register.

## Dependencies

Compatible npm lockfile refreshes were tested with clean installs and builds.
On 2026-10-20 the simulator reported zero advisories; the cockpit reported seven
(five high, two moderate), all in the development/build chain. Runtime-only cockpit
audit reported zero. Remaining findings include the unpatched braces/Tailwind 3
chain and selector-parser chain. No forced Tailwind 4 migration was performed.

The runtime explicitly pins bcrypt 4.0.1, matching the existing compatible
development version: bcrypt 5 breaks passlib 1.7.4 even for short passwords.
An unmocked synthetic local register/login/hash/verify regression covers this
compatibility boundary, including rejection paths and JWT subject checks.

The separately resolved Python 3.12 production runtime passed startup and mock
integration checks and pip-audit with zero known findings. The runtime lock is
provided for the tested Linux environment. This does not certify every optional
service or the older broad development dependency inventory as vulnerability-free.

## Validation boundaries

No live-provider authentication, paid API calls, embeddings, voice-provider run,
Windows execution or full browser-to-provider study session was completed. Local
Chromium launch was blocked by the cloud execution environment; browser scripts
must be run in a supported environment before calling that layer verified.

No hosted demo is deployed. Existing deployment examples still require real
origins, secrets and storage configuration; missing production URL checks should
not be bypassed. Builds and source smoke tests do not prove production readiness.
