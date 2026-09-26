# Hermes PWA — rollback, uninstall, reinstall safety plan

This project will be tested against the default Hermes profile, so every install attempt must be reversible.

## Ground truth

- Plugin name: `hermes-pwa` (`plugin.yaml`).
- User-installed plugins live under: `~/.hermes/plugins/`.
- Enable/disable state lives in: `~/.hermes/config.yaml`, under `plugins.enabled` / `plugins.disabled`.
- Hermes gateway must be restarted after plugin enable/disable/remove.
- `hermes plugins install ... --force` removes the existing plugin directory and reinstalls.
- `hermes plugins remove hermes-pwa` deletes the installed plugin directory.

## Safety rule

Before testing on the default profile, create both:

1. A **full Hermes backup** with `hermes backup`.
2. A **small plugin-state snapshot** of:
   - `~/.hermes/config.yaml`
   - `~/.hermes/plugins/hermes-pwa/` if present
   - gateway service status

The full backup may contain `.env` and auth data. Keep it local; do not paste or commit it.

## Backup before install/test

Recommended command:

```bash
mkdir -p ~/.hermes/backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
hermes backup -o "$HOME/.hermes/backups/before-hermes-pwa-$stamp.zip" -l "before-hermes-pwa-$stamp"
```

Optional quick backup if time matters:

```bash
hermes backup --quick -l "before-hermes-pwa-quick-$(date -u +%Y%m%dT%H%M%SZ)"
```

## Clean uninstall path

Use this if the plugin breaks the dashboard/gateway or you need a clean reinstall:

```bash
hermes plugins disable hermes-pwa || true
hermes plugins remove hermes-pwa || true
hermes gateway restart
hermes plugins list --plain | grep -i hermes-pwa || true
hermes gateway status
```

Expected after removal:

- `hermes-pwa` is absent from user-installed plugins.
- Gateway restarts cleanly.
- Normal Hermes Telegram/Desktop behavior is restored.

## Reinstall path

When testing from a Git repo/remote:

```bash
hermes plugins install <owner-or-url>/hermes-pwa --enable --force
hermes gateway restart
```

For local dogfooding, the Hermes installer accepts `file://` Git URLs, not raw filesystem paths. The local repo must have a commit containing the files to test:

```bash
git status --short
hermes plugins install "file://$(pwd -P)" --enable --force
hermes gateway restart
```

The safety wrapper does this conversion automatically:

```bash
scripts/hermes-pwa-safety.sh reinstall . --yes
```

## Emergency rollback

If disable/remove/restart does not restore Hermes:

1. Stop gateway:
   ```bash
   hermes gateway stop
   ```
2. Move plugin directory out of discovery path manually:
   ```bash
   mkdir -p ~/.hermes/plugins-disabled
   mv ~/.hermes/plugins/hermes-pwa ~/.hermes/plugins-disabled/hermes-pwa.$(date -u +%Y%m%dT%H%M%SZ) 2>/dev/null || true
   ```
3. In `~/.hermes/config.yaml`, remove `hermes-pwa` from `plugins.enabled` and add it to `plugins.disabled` if needed.
4. Start gateway:
   ```bash
   hermes gateway start
   hermes gateway status
   ```
5. If still broken, restore from the full backup archive created before testing.

## Phase 1 live verification after reinstall

```bash
npm run verify:pwa -- --url <dashboard-origin>/api/plugins/hermes-pwa/app/
```

Manual device checks still required:

- Android Chrome: install prompt → launcher launch.
- iOS Safari: Share → Add to Home Screen → standalone launch.
- Offline mode after install: should show `offline.html`, not a browser error.
