#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# auto-deploy-c.sh — Deploy completo lato VPS, OPZIONE C (SSH tunnel only).
#
# Configurazione:
#   • Backend in Docker, bind 127.0.0.1:7777 (mai esposto)
#   • Nessuna modifica a nginx esistente
#   • Nessun certbot, nessun DNS, nessuna porta aperta sul firewall
#   • Accesso via SSH port-forward dal PC dell'utente
#
# Idempotente: rilanciare lo script aggiorna solo ciò che è cambiato.
#
# Uso (sulla VPS):
#   sudo bash deploy/auto-deploy-c.sh
#
# Pre-req:
#   • Ubuntu/Debian
#   • Sorgenti già copiati in /opt/hyperliquid-bot (vedi scp-from-windows.bat)
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/hyperliquid-bot}"

step() { echo -e "\n\e[1;33m==>\e[0m \e[1m$*\e[0m"; }
ok()   { echo -e "  \e[1;32m✓\e[0m $*"; }
warn() { echo -e "  \e[1;33m!\e[0m $*"; }
err()  { echo -e "  \e[1;31m✗\e[0m $*" >&2; }

if [[ $EUID -ne 0 ]]; then
  err "Devi essere root: sudo bash $0"
  exit 1
fi

if [[ ! -d "${INSTALL_DIR}" ]]; then
  err "${INSTALL_DIR} non esiste. Copia prima i sorgenti via scp-from-windows.bat"
  exit 1
fi

step "Check distro"
if ! command -v apt-get >/dev/null; then
  err "Questo script è per Debian/Ubuntu. Per altre distro adatta manualmente."
  exit 1
fi
ok "Debian/Ubuntu OK"

step "Install Docker (se manca)"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  ok "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1) installato"
else
  ok "Docker già presente: $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)"
fi

step "Check Docker Compose"
if ! docker compose version >/dev/null 2>&1; then
  err "docker compose v2 non disponibile. Reinstalla Docker (lo include)."
  exit 1
fi
ok "$(docker compose version | head -1)"

step "Setup .env (se manca)"
cd "${INSTALL_DIR}"
if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  warn ".env creato da template. Edita ${INSTALL_DIR}/.env per impostare HL_MASTER_ADDRESS opzionale."
else
  chmod 600 .env
  ok ".env già presente, permessi 600 applicati"
fi

step "Verifica che bind sia 127.0.0.1 (non esposto)"
if grep -q "127.0.0.1:7777:7777" docker-compose.yml; then
  ok "docker-compose bind 127.0.0.1:7777 — NESSUNA esposizione pubblica"
else
  err "docker-compose.yml non ha bind 127.0.0.1. ABORTO per sicurezza."
  exit 1
fi

step "Verifica firewall NON espone 7777 esternamente"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  if ufw status | grep -qE "^7777"; then
    warn "ufw espone la porta 7777 — la chiudo per sicurezza"
    ufw delete allow 7777 || true
  fi
  ok "ufw configurato correttamente (7777 non aperta esternamente)"
else
  warn "ufw non attivo o non installato — l'unica protezione è il bind 127.0.0.1"
fi

step "Build container Docker"
docker compose build
ok "build completato"

step "Avvio container"
docker compose up -d
sleep 5
ok "container avviato"

step "Health check"
for i in 1 2 3 4 5; do
  if curl -fsS -m 3 http://127.0.0.1:7777/status >/dev/null 2>&1; then
    ok "backend risponde su 127.0.0.1:7777"
    break
  else
    if [[ $i -eq 5 ]]; then
      err "backend non risponde dopo 25s. Controlla: docker compose logs"
      exit 1
    fi
    sleep 5
  fi
done

step "Verifica isolamento"
LISTEN=$(ss -tlnp 2>/dev/null | grep ":7777" | head -1 || echo "")
if echo "$LISTEN" | grep -q "127.0.0.1:7777"; then
  ok "porta 7777 ascolta SOLO su 127.0.0.1 (non raggiungibile da internet)"
else
  err "porta 7777 NON è limitata a localhost. ABORTO."
  err "Output ss: $LISTEN"
  docker compose down
  exit 1
fi

# Smoke test del JSON
STATUS=$(curl -s http://127.0.0.1:7777/status | head -c 300)
if echo "$STATUS" | grep -q '"autonomous":true'; then
  ok "autonomous trading loop attivo"
else
  warn "autonomous=false — controlla config"
fi

echo
echo -e "\e[1;32m═══════════════════════════════════════════════════════════════════\e[0m"
echo -e "\e[1;32m  ✓ Hyperliquid Platform attiva su VPS (OPZIONE C - SSH tunnel)\e[0m"
echo -e "\e[1;32m═══════════════════════════════════════════════════════════════════\e[0m"
echo
echo "  Container:    docker compose ps"
echo "  Logs live:    docker compose logs -f"
echo "  Stop:         docker compose down"
echo "  Restart:      docker compose restart"
echo "  Kill switch:  touch ${INSTALL_DIR}/.HALT"
echo
echo "  Backend bind: 127.0.0.1:7777  (NON raggiungibile dall'esterno)"
echo "  Frontend:     servito dallo stesso processo (web-dist via fastify-static)"
echo
echo "  PER ACCEDERE dal tuo PC Windows:"
echo "    1. Sul PC, esegui:  ssh -N -L 7777:127.0.0.1:7777 $(whoami)@$(hostname -I | awk '{print $1}')"
echo "    2. Apri browser:    http://127.0.0.1:7777/"
echo
echo "  Oppure usa lo script tunnel-to-vps.bat sul tuo PC Windows."
echo
