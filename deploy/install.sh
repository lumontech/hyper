#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# install.sh — bootstrap della piattaforma Hyperliquid su VPS Ubuntu/Debian.
# Pensato per CONVIVERE con altre piattaforme esistenti:
#   • Crea utente dedicato `hluser` (non tocca root né altri user)
#   • Installa in /opt/hyperliquid-bot (non interferisce con /var/www o /opt/altro)
#   • Bind 127.0.0.1:7777 (porta dedicata, non in conflitto con 80/443/3000/5173)
#   • Niente reverse proxy auto: lo configuri tu sul tuo nginx/caddy esistente
#   • Niente firewall changes: usa SSH tunnel o reverse proxy con auth
#
# Uso:
#   chmod +x deploy/install.sh
#   sudo ./deploy/install.sh
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

INSTALL_DIR="/opt/hyperliquid-bot"
SERVICE_USER="hluser"
NODE_MAJOR="22"

step() { echo -e "\n\e[1;33m==>\e[0m \e[1m$*\e[0m"; }
ok()   { echo -e "  \e[1;32m✓\e[0m $*"; }
warn() { echo -e "  \e[1;33m!\e[0m $*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Devi essere root: sudo $0" >&2
  exit 1
fi

step "Check OS"
if ! command -v apt-get >/dev/null; then
  echo "Questo script è per Debian/Ubuntu. Per Alpine/CentOS adatta manualmente." >&2
  exit 1
fi
ok "Debian/Ubuntu detected"

step "Update apt + install prerequisiti (curl, git, ca-certificates)"
apt-get update -qq
apt-get install -yqq curl git ca-certificates gnupg lsb-release
ok "prerequisiti installati"

step "Install Node.js ${NODE_MAJOR} (NodeSource)"
if ! command -v node >/dev/null || [[ "$(node -v | grep -oP 'v\K[0-9]+')" -lt "${NODE_MAJOR}" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -yqq nodejs
  ok "Node $(node -v) installato"
else
  ok "Node $(node -v) già presente (≥ ${NODE_MAJOR})"
fi

step "Crea utente dedicato '${SERVICE_USER}'"
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "${SERVICE_USER}"
  ok "utente ${SERVICE_USER} creato"
else
  ok "utente ${SERVICE_USER} già presente"
fi

step "Setup directory ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
ok "directory ready"

step "Clone/update repo"
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  sudo -u "${SERVICE_USER}" git -C "${INSTALL_DIR}" pull --ff-only
  ok "repo aggiornato"
elif [[ -n "${REPO_URL:-}" ]]; then
  sudo -u "${SERVICE_USER}" git clone "${REPO_URL}" "${INSTALL_DIR}"
  ok "repo clonato da ${REPO_URL}"
else
  warn "REPO_URL non impostato — assumo che tu abbia già copiato i sorgenti in ${INSTALL_DIR}"
  warn "Per clone automatico: REPO_URL=https://github.com/tu/repo.git sudo ./install.sh"
fi

step "Install dependencies (backend + frontend)"
sudo -u "${SERVICE_USER}" bash -c "cd '${INSTALL_DIR}' && npm ci --no-audit --no-fund"
sudo -u "${SERVICE_USER}" bash -c "cd '${INSTALL_DIR}/web' && npm ci --no-audit --no-fund"
ok "npm install completato"

step "Build frontend statico"
sudo -u "${SERVICE_USER}" bash -c "cd '${INSTALL_DIR}' && npm run web:build"
ok "frontend buildato in ${INSTALL_DIR}/web/dist"

step "Setup .env"
if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/.env"
  chmod 600 "${INSTALL_DIR}/.env"
  warn "Edita ${INSTALL_DIR}/.env per impostare HL_MASTER_ADDRESS (opzionale) e API key (mai master wallet!)"
else
  ok ".env già presente, lasciato com'è"
fi

step "Install systemd unit"
cp "${INSTALL_DIR}/deploy/hyperliquid-bot.service" /etc/systemd/system/
systemctl daemon-reload
ok "unit installata"

step "Enable + start"
systemctl enable hyperliquid-bot
systemctl restart hyperliquid-bot
sleep 3
if systemctl is-active --quiet hyperliquid-bot; then
  ok "service attivo"
else
  warn "service NON attivo — controlla: journalctl -u hyperliquid-bot -n 50"
fi

step "Health check"
if curl -fsS http://127.0.0.1:7777/status >/dev/null 2>&1; then
  ok "backend risponde su 127.0.0.1:7777"
else
  warn "backend non risponde. Logs: journalctl -u hyperliquid-bot -f"
fi

echo
echo -e "\e[1;32m═══════════════════════════════════════════════════════════════\e[0m"
echo -e "\e[1;32m  Hyperliquid Platform installata.\e[0m"
echo -e "\e[1;32m═══════════════════════════════════════════════════════════════\e[0m"
echo
echo "  Service:     systemctl status hyperliquid-bot"
echo "  Logs live:   journalctl -u hyperliquid-bot -f"
echo "  Backend:     http://127.0.0.1:7777/status   (bind locale, mai esposto)"
echo "  Frontend:    ${INSTALL_DIR}/web/dist (statico, da servire via nginx/caddy)"
echo "  .env:        ${INSTALL_DIR}/.env (chmod 600, edita per API key)"
echo
echo "  Per accedere da remoto: SSH tunnel oppure reverse proxy."
echo "  Vedi deploy/README.md per dettagli."
