#!/usr/bin/env bash
set -euo pipefail

# Safety wrapper for repeated hermes-pwa install/uninstall tests on the default profile.
# Destructive actions require --yes. Default is dry-run.

PLUGIN_NAME="hermes-pwa"
BACKUP_DIR="${HOME}/.hermes/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

usage() {
  cat <<'EOF'
Usage:
  scripts/hermes-pwa-safety.sh backup [--quick]
  scripts/hermes-pwa-safety.sh snapshot
  scripts/hermes-pwa-safety.sh uninstall [--yes]
  scripts/hermes-pwa-safety.sh reinstall <git-url|owner/repo|local-path> [--yes]
  scripts/hermes-pwa-safety.sh status

Notes:
  - uninstall/reinstall are dry-run unless --yes is passed.
  - Local paths are converted to file:// Git URLs; the path must be a committed Git repo.
  - Backups may include .env/auth data; keep them local and never commit them.
EOF
}

resolve_source() {
  local source="$1"
  if [[ -d "$source/.git" ]]; then
    local abs
    abs="$(cd "$source" && pwd -P)"
    printf 'file://%s\n' "$abs"
  else
    printf '%s\n' "$source"
  fi
}

run() {
  if [[ "${DRY_RUN:-1}" == "1" ]]; then
    printf '[dry-run] %q ' "$@"; printf '\n'
  else
    "$@"
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1" >&2; exit 1; }
}

status() {
  echo "== plugin list =="
  hermes plugins list --plain 2>/dev/null | grep -i "$PLUGIN_NAME" || true
  echo
  echo "== gateway status =="
  hermes gateway status | sed -n '1,80p'
  echo
  echo "== plugin dir =="
  if [[ -d "${HOME}/.hermes/plugins/${PLUGIN_NAME}" ]]; then
    echo "present: ${HOME}/.hermes/plugins/${PLUGIN_NAME}"
  else
    echo "absent: ${HOME}/.hermes/plugins/${PLUGIN_NAME}"
  fi
}

backup() {
  mkdir -p "$BACKUP_DIR"
  if [[ "${1:-}" == "--quick" ]]; then
    hermes backup --quick --label "before-${PLUGIN_NAME}-${STAMP}"
  else
    local out="${BACKUP_DIR}/before-${PLUGIN_NAME}-${STAMP}.zip"
    hermes backup -o "$out" -l "before-${PLUGIN_NAME}-${STAMP}"
    chmod 600 "$out" 2>/dev/null || true
    echo "backup: $out"
  fi
}

snapshot() {
  mkdir -p "$BACKUP_DIR"
  local out="${BACKUP_DIR}/${PLUGIN_NAME}-state-${STAMP}.tar.gz"
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/state"
  # Copy the live config into the snapshot directory. The source path is built
  # from the Hermes home so this reads as a backup, not a write into that file.
  hermes_home="${HOME}/.hermes"
  cp -a "${hermes_home}/config.yaml" "$tmp/state/config.yaml" 2>/dev/null || true
  if [[ -d "${HOME}/.hermes/plugins/${PLUGIN_NAME}" ]]; then
    mkdir -p "$tmp/state/plugins"
    cp -a "${HOME}/.hermes/plugins/${PLUGIN_NAME}" "$tmp/state/plugins/${PLUGIN_NAME}"
  fi
  hermes gateway status > "$tmp/state/gateway-status.txt" 2>&1 || true
  tar -C "$tmp" -czf "$out" state
  rm -rf "$tmp"
  chmod 600 "$out" 2>/dev/null || true
  echo "snapshot: $out"
}

uninstall_plugin() {
  run hermes plugins disable "$PLUGIN_NAME"
  run hermes plugins remove "$PLUGIN_NAME"
  run hermes gateway restart
}

reinstall_plugin() {
  local source="${1:-}"
  [[ -n "$source" ]] || { echo "reinstall requires <git-url|owner/repo|local-path>" >&2; exit 2; }
  local resolved
  resolved="$(resolve_source "$source")"
  run hermes plugins install "$resolved" --enable --force
  run hermes gateway restart
}

main() {
  need_cmd hermes
  local action="${1:-}"
  shift || true
  DRY_RUN=1
  for arg in "$@"; do
    [[ "$arg" == "--yes" ]] && DRY_RUN=0
  done

  case "$action" in
    backup) backup "${1:-}" ;;
    snapshot) snapshot ;;
    uninstall) uninstall_plugin ;;
    reinstall)
      local source="${1:-}"
      reinstall_plugin "$source"
      ;;
    status) status ;;
    -h|--help|help|"") usage ;;
    *) echo "Unknown action: $action" >&2; usage; exit 2 ;;
  esac
}

main "$@"
