# Cove Private Agent — Development Plan

## Product boundary

Cove is a privacy-first personal agent. Personal memory, OAuth credentials, raw meeting audio, and the searchable personal data index remain on the user's device or private hub. A small local model handles routine work. In balanced mode, selected difficult requests may be escalated to a configured cloud provider only after minimization and redaction.

External actions are never executed solely because a model generated a tool call. The application validates the action, applies policy, requests approval where required, executes a narrow tool, verifies the outcome, and records a receipt.

## Milestone 1 — Trustworthy local vertical slice

Status: MVP complete in this repository.

- Local web application bound to `127.0.0.1`
- Encrypted local memory and action history
- Explicit-memory capture
- Local OpenAI-compatible model adapter
- Disabled-by-default cloud escalation adapter
- Context minimization and basic sensitive-data redaction
- Email-draft, message-preparation, and calendar-event workflows
- Approval gate before Gmail draft or Calendar mutation
- Local-only receipts when Google is disconnected
- Notes, reminders, meeting summaries, daily brief, browser dictation, and action history
- Automated policy, privacy, and storage tests

Exit criteria:

- The application starts without third-party packages.
- Stored memory is encrypted at rest.
- A disconnected local model does not cause silent cloud use.
- Balanced mode cannot use the cloud unless the server owner enables and configures it.
- Proposed actions cannot execute twice.

## Milestone 2 — Local intelligence

Target: weeks 2–4.

- Device benchmark harness for Qwen, Phi, Gemma, and LFM candidates
- Structured local tool-selection grammar
- Local embeddings and hybrid keyword/vector retrieval
- Memory review, edit, delete, export, confidence, and expiry controls
- Contact resolution and time-zone normalization
- Local speech-to-text and native text-to-speech
- Evaluation dataset covering the top 100 personal-assistant requests

Exit criteria:

- At least 95% schema-valid local tool proposals.
- Zero action execution from untrusted email/document instructions.
- Personal-memory retrieval precision measured on synthetic and consented test profiles.

## Milestone 3 — Google integration

Status: MVP implementation complete; production hardening remains.

- Google OAuth with explicit minimal scopes
- Encrypted refresh-token vault (OS Keychain/Keystore migration remains)
- Gmail search (single-thread retrieval remains)
- Gmail draft creation; sending remains a separately approved action
- Calendar event listing and creation (availability, update, and cancellation remain)
- Event idempotency key (post-action verification remains)
- OAuth consent, privacy policy, deletion, and verification preparation

Exit criteria:

- No duplicate email or event under retries.
- Every external mutation has a user-visible receipt.
- Revoking Google access immediately disables all scheduled work.

## Milestone 4 — Mobile and voice

Target: weeks 7–11.

- React Native mobile shell with native security modules
- Phone-side 1–2B quantized model or Apple Foundation Models
- Encrypted pairing with the user's private laptop hub
- Push-to-talk with local transcription
- Share-sheet email/text drafting
- Mobile approval notifications
- Background behavior compliant with iOS and Android constraints

Exit criteria:

- Sensitive personal context remains local during ordinary phone requests.
- Phone-to-hub messages are end-to-end encrypted and mutually authenticated.
- Voice sessions clearly indicate recording and retention state.

## Milestone 5 — Meetings and routines

Target: weeks 11–15.

- Consent-forward meeting recording
- Local transcription and optional speaker segmentation
- Summary, decisions, and proposed follow-up tasks
- Morning brief and end-of-day review
- Bounded automations with scopes, limits, expiry, and notification rules
- Failure recovery for sleeping or disconnected hubs

## Milestone 6 — Private beta hardening

Target: weeks 15–20.

- Threat model and independent security review
- Prompt-injection and data-exfiltration test suite
- Signed application and model updates
- Encrypted backup/recovery
- Account and local-data deletion
- Telemetry that excludes content by construction
- Per-model quality, latency, energy, and cost reporting

## Initial technical decisions

- Begin as a modular local service, not a fleet of microservices.
- Keep model providers behind a common interface.
- Use deterministic workflows for communication and calendar actions.
- Store personal data locally; cloud requests receive only task-specific context.
- Make local-only mode the default.
- Do not implement autonomous sending or purchasing in the first release.
- For the initial 24 GB Apple Silicon development target, use the already-installed Ollama `llama3.1:8b` Q4 model as the stable default. Retain Qwen3.5 9B MLX as an optional comparison rather than a runtime dependency.

## Metrics

- Consequential-action error rate
- Duplicate-action rate
- Draft acceptance and edit distance
- Local completion rate versus cloud escalation rate
- Memory correction/deletion rate
- Median time to complete a request
- Percentage of requests containing redacted fields
- Per-user cloud cost and energy use
