# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); this project uses [SemVer](https://semver.org/).

## Unreleased

### Fixed

- Plugin install scan. The CI session fixture and the safety snapshot no longer look like a shipped secret or a write into Hermes config, so `hermes plugins install` can accept this repo.

## 0.1.2-beta — 2026-06-28

### Fixed

- **WebSocket connect compatibility with official Hermes backend.** The PWA sent the WS ticket
  only as a subprotocol (`Sec-WebSocket-Protocol: hermes.ws-ticket, <ticket>`), but official
  Hermes-Agent `main` accepts the ticket only as a query param (`/api/ws?ticket=<ticket>`), so a
  fresh install could hang on `Connecting…`. The transport now keeps the subprotocol path as primary
  (no ticket in the URL) and falls back **once** to the legacy query path if the first socket closes
  before it opens. Post-open closes never trigger the fallback.

## 0.1.1-beta — 2026-06-28

First beta. Marked beta to set expectations while it gets real-world testing.

### Fixed

- **Chat transcript order.** History is now rendered in the backend's returned order
  instead of being re-sorted by timestamp. After history compression, a freshly inserted
  user message can carry a newer timestamp than the restored assistant/tool rows below it,
  which made replies jump above their prompt. The PWA now trusts the backend order.

## 0.1.0 — 2026-06-28

Initial public release — an installable, mobile-first PWA control plane for the
self-hosted [Hermes Agent](https://github.com/NousResearch/Hermes-Agent), shipped as a
Hermes Dashboard plugin. Independent, unofficial client.

### Added

- Installable PWA with Add-to-Home-Screen on iOS Safari and Android Chrome.
- Chat with streaming replies; Activity inbox with approvals; Projects/kanban; Agents & system screens.
- Same-origin Dashboard session auth — no separate mobile credentials.
- Web push notifications (VAPID), scoped to the active Hermes profile.
- Read-only update-check endpoint + in-app notification banner with manual update instructions.
- Settings install-prompt button when the browser exposes `beforeinstallprompt`.
- `npx hermes-pwa install` npm installer wrapper.
- Tailscale Serve setup docs and a security/privacy statement.
- GitHub Actions CI and release workflows.

### Security & hardening

- ws-ticket passed via the WebSocket subprotocol (never in the URL); credentials never persisted.
- Local transcript cache purged on logout and on user switch.
- Authenticated Dashboard session required for sensitive plugin endpoints.
- Attachment filename sanitization; sanitized push error state.
