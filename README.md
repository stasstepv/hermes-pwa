<div align="center">

# 📱 Hermes Mobile <sup>(unofficial)</sup>

### Your Hermes Agent instance — on your phone.

A **plugin for the [Hermes Agent](https://github.com/NousResearch/Hermes-Agent) Dashboard** — the web UI.
You install it like any other Dashboard plugin; it adds a **Mobile** tab and serves an installable,
phone-native PWA from it. No separate app to host, no second login.
Chat, approve actions, and watch your agent work from your phone, over your own private network.

![Beta](https://img.shields.io/badge/release-0.1.2--beta-ff6f00?style=for-the-badge)
![License: MIT](https://img.shields.io/badge/License-MIT-3da639?style=for-the-badge)
![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8?style=for-the-badge)
![React + TypeScript](https://img.shields.io/badge/React%20%2B%20TypeScript-20232a?style=for-the-badge&logo=react)
![Status](https://img.shields.io/badge/status-beta%20·%20solo%20·%20spare--time-f59e0b?style=for-the-badge)
![Unofficial](https://img.shields.io/badge/unofficial-community%20client-9aa2b4?style=for-the-badge)

<br/>

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/home-screen.png" alt="Installed on the phone home screen" width="260"/><br/><sub><b>Installed on your home screen</b></sub></td>
    <td align="center"><img src="docs/screenshots/chat.png" alt="Chat with streaming replies" width="260"/><br/><sub><b>Chat with your agent, streaming live</b></sub></td>
  </tr>
</table>

</div>

---

> 🧪 **Beta — `0.1.2-beta`.** Usable, and I run it daily, but expect rough edges. Please
> [report anything that breaks](https://github.com/stasstepv/hermes-pwa/issues) — especially on iOS.

## 👋 Hey — a quick honest note

I built this **for myself**. Driving Hermes from Telegram on my phone worked, but it was painful for longer chats,
approvals, and checking what the agent was doing. I wanted a small phone cockpit for my own Hermes instance, so I built one.

This is a **solo, spare-time project**, built over about **a week of evenings** with heavy help from AI coding tools.
It's not polished enterprise software, and it's **not affiliated with Nous Research**. But I use it daily, and if it helps
someone else, good.

Issues, ideas, and PRs are welcome.

---

## ✨ What you can do

- 💬 **Chat** with your main Hermes agent — replies stream in live.
- ✅ **Approve or reject** high-impact agent actions, right from your phone.
- 📥 **Activity inbox** — watch running tasks, delegations, and cron jobs.
- 🗂️ **Projects & kanban** — browse boards and steer tasks.
- 🧠 **Agents & system** — see profiles, workers, and live status.
- 📲 **Install to home screen** on iOS Safari and Android Chrome.

## Companion X/Twitter Briefs

For mobile social monitoring workflows, pair Hermes Mobile with
[Hermes Tweet](https://github.com/Xquik-dev/hermes-tweet). Hermes Tweet can
collect X/Twitter account, post, or trend context inside Hermes, while this PWA
lets you review social briefs, approve follow-up actions, and watch activity
from your phone. Hermes Tweet is a third-party project maintained by Xquik-dev,
not by this repository.

## 📸 Screenshots

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/chat.png" alt="Chat" width="230"/><br/><sub><b>Chat — streaming replies</b></sub></td>
    <td align="center"><img src="docs/screenshots/activity.png" alt="Activity and approvals" width="230"/><br/><sub><b>Activity — approvals & tasks</b></sub></td>
    <td align="center"><img src="docs/screenshots/projects.png" alt="Projects kanban" width="230"/><br/><sub><b>Projects — kanban</b></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/agents.png" alt="Agents" width="230"/><br/><sub><b>Agents & workers</b></sub></td>
    <td align="center"><img src="docs/screenshots/profiles_screen.png" alt="Profiles" width="230"/><br/><sub><b>Profiles</b></sub></td>
    <td align="center"><img src="docs/screenshots/system_screen.png" alt="System status" width="230"/><br/><sub><b>System status</b></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/connection_screen.png" alt="Sign-in" width="230"/><br/><sub><b>Sign in</b></sub></td>
    <td align="center"><img src="docs/screenshots/menu.png" alt="Navigation drawer" width="230"/><br/><sub><b>Navigation</b></sub></td>
    <td align="center"><img src="docs/screenshots/cron.png" alt="Cron jobs" width="230"/><br/><sub><b>Cron jobs</b></sub></td>
  </tr>
</table>

<sub>Installed as a Hermes Dashboard plugin → opened from the <b>Mobile</b> tab → added to the phone home screen.</sub>

## 🔌 How it works

Hermes Mobile ships as a **Hermes Dashboard plugin**, not a separate web service. It runs on the **same origin**
as your Dashboard, so:

- 🔑 **No new accounts, no API keys, no secrets in the client** — it reuses your existing Dashboard session.
- 🔒 **Same auth, same network boundary** as Hermes itself — nothing new exposed.
- 🛰️ Designed for **private access over [Tailscale](./docs/NETWORK_TAILSCALE.md)** (HTTPS via Tailscale Serve).

Install it, open the **Mobile** tab in your Dashboard, and add it to your home screen.

<div align="center">
  <img src="docs/screenshots/mobile-tab.png" alt="The Mobile tab inside the Hermes Agent Dashboard web UI" width="820"/>
  <br/>
  <sub><b>The plugin lives inside your Hermes Dashboard — the Mobile tab runs diagnostics, shows the install QR, and serves the app URL.</b></sub>
</div>

## 🚀 Install

> Requires a running **Hermes Dashboard**, and HTTPS in production (Tailscale Serve recommended).

**Option A — Hermes Dashboard plugin (recommended)**

```bash
hermes plugins install stasstepv/hermes-pwa
hermes plugins enable hermes-pwa
```

**Option B — npm installer**

```bash
npx hermes-pwa install
```

**Option C — just ask your Hermes agent**

Don't want to touch the CLI? Tell the agent in chat:

> Install the Hermes Dashboard plugin from `https://github.com/stasstepv/hermes-pwa` and enable it.

It runs the install for you — then continue below.

Then restart the Dashboard, open the **Mobile** tab, and follow the on-screen instructions to install on your phone.
Sign in with your **existing Dashboard credentials** — that's it.

📖 Full guides: [Install](./docs/INSTALL.md) · [Tailscale setup](./docs/NETWORK_TAILSCALE.md) · [Rollback & reinstall](./docs/ROLLBACK_AND_REINSTALL.md)

## 🔐 Security & privacy

This client can drive a powerful agent, so privacy is taken seriously:

- No credentials or API keys are ever stored in the PWA.
- Reuses your existing Dashboard session cookie (same-origin auth) — nothing persisted.
- High-impact actions always require **explicit** confirmation.
- **No telemetry, no third-party trackers**, nothing phones home.

Read the full [Security & Privacy statement](./docs/SECURITY.md).

## 🗺️ Roadmap

Things I want to improve when I have time:

- 🛡️ Resilience to upstream API changes (version probe, contract tests).
- ⚡ Performance: code-splitting, lighter bundle, smoother long chats.
- 💬 Chat behavior: clearer message states, better system-message display, and cleaner long conversations.
- 🔄 Smarter in-app updates.
- 📱 A real native build (iOS / Android via Capacitor) — if people want it.
- ✨ More polish across every screen.

No timeline promises. Contributions help.

## 🤝 Contributing

I built this alone but would welcome help. Bug reports, ideas, design tweaks, PRs — all welcome.

Start with **[CONTRIBUTING.md](./CONTRIBUTING.md)** (it covers the dev setup, quality gates,
and one important rule: this is a **clean-room** client — we never copy upstream code).

New here? Good first areas: docs, accessibility, tests, and small cleanups.

## 🛠️ Development

```bash
npm install
npm run typecheck && npm run lint && npm test
npm run build && npm run verify:pwa
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [CODING_RULES.md](./CODING_RULES.md) for the engineering guide.

## 💛 Acknowledgements

Built over about a week of evenings, with AI help at each stage:

- **Claude Design** — design prototype, taking visual cues from the Hermes desktop app.
- **KiloCode** — initial code prototype.
- **KimiCode** — implementing the design.
- **Claude Code** — audits and reviews.
- **Codex** — bug and gap fixes.

The foundation is **Hermes Agent** by [Nous Research](https://github.com/NousResearch/Hermes-Agent), the platform that
makes this possible. This is an independent, unofficial client — see [NOTICE](./NOTICE) for attribution and trademark details.

Thanks to everyone who tried early versions and gave feedback.

## ⚖️ Unofficial status & license

**Hermes Mobile is an independent, community-built, unofficial client.** It is **not** affiliated with, endorsed by,
sponsored by, or supported by Nous Research. "Hermes" and related marks belong to their respective owners and are
used here only to describe interoperability. See [NOTICE](./NOTICE) for full attribution and trademark details.

Released under the [MIT License](./LICENSE) © 2026 Stanislav Stepchenko.

<div align="center"><sub>Built for myself, shared in case it helps you too. 💛</sub></div>
