# VPS Restore Guide

Procedura **PRIMA del reset VPS** e **DOPO la ricreazione** per ripristinare il bot identico.

## 🔻 PRIMA del reset (backup)

Esegui questi comandi dal tuo PC locale (Windows Git Bash):

```bash
# 1. Crea cartella backup locale
mkdir -p ~/hyperliquid-vps-backup
cd ~/hyperliquid-vps-backup

# 2. Backup .env (contiene segreti — NON pushare su GitHub!)
scp -i ~/.ssh/impact_vps root@81.17.100.112:/opt/hyperliquid-bot/.env ./env.vps

# 3. Backup database SQLite (orders, fills, equity_curve, audit demo state)
scp -i ~/.ssh/impact_vps -r root@81.17.100.112:/opt/hyperliquid-bot/data ./data

# 4. Backup config Caddy (reverse proxy + basic auth)
scp -i ~/.ssh/impact_vps root@81.17.100.112:/etc/caddy/Caddyfile ./Caddyfile.vps

# 5. Verifica
ls -la ~/hyperliquid-vps-backup/
# Aspettati:
#   env.vps          (~3 KB)
#   Caddyfile.vps    (~600 B)
#   data/bot.db      (~225 KB)
#   data/audit/      (audit log)
```

**Cifra il backup** (contiene chiavi/segreti):
```bash
tar -czf hl-backup-$(date +%Y%m%d).tar.gz hyperliquid-vps-backup/
# Salva il file su disco esterno / cloud cifrato
```

## 🔁 DOPO il reset (ripristino)

### 1. Ricostruisci la VPS Contabo

- OS: Ubuntu 22.04 LTS o 24.04 LTS
- IP: stesso (`81.17.100.112`) o nuovo (aggiorna nip.io dominio se cambia)

### 2. Installa Docker + Caddy

```bash
# SSH come root
ssh -i ~/.ssh/impact_vps root@81.17.100.112

# Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

### 3. Clone repo + ripristina .env

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/lumontech/hyper.git hyperliquid-bot
cd hyperliquid-bot
git checkout feat/audit-suite-funding-harvest    # o main se PR mergiata
```

Da tuo PC locale, copia il `.env` salvato:
```bash
scp -i ~/.ssh/impact_vps ~/hyperliquid-vps-backup/env.vps root@81.17.100.112:/opt/hyperliquid-bot/.env
```

### 4. Ripristina data/ (demo state, equity curve, audit)

```bash
# Da tuo PC locale
scp -i ~/.ssh/impact_vps -r ~/hyperliquid-vps-backup/data root@81.17.100.112:/opt/hyperliquid-bot/

# Su VPS, fix permessi (container gira come user 1000:1000)
ssh -i ~/.ssh/impact_vps root@81.17.100.112 "chown -R 1000:1000 /opt/hyperliquid-bot/data"
```

### 5. Ripristina Caddyfile + restart Caddy

```bash
# Da PC locale
scp -i ~/.ssh/impact_vps ~/hyperliquid-vps-backup/Caddyfile.vps root@81.17.100.112:/etc/caddy/Caddyfile

# Su VPS
systemctl restart caddy
systemctl status caddy   # verifica running + HTTPS auto via Let's Encrypt
```

### 6. Build & start bot

```bash
cd /opt/hyperliquid-bot
docker compose build --no-cache
docker compose up -d
docker compose logs -f bot   # verifica boot pulito
```

### 7. Smoke test

```bash
# Da PC locale
curl -s -u stefano:Gst.L581 https://hyperliquid-81-17-100-112.nip.io/status | head -c 500
```

Deve restituire JSON con `"ok":true`, `"demoEquity":1039.25` (o valore preservato) e tutti i 10 coin in `allowedCoins`.

## 📋 Checklist verifica post-restore

- [ ] HTTPS funziona (Caddy + Let's Encrypt automatico)
- [ ] Basic auth richiesta su tutti gli endpoint
- [ ] `/status` mostra `demoEquity` preservata dal backup
- [ ] `/funding-live` ritorna 10 coin con rate aggiornati (poll 60s)
- [ ] `/strategies` mostra 11 strategie (incluso `fundingHarvest`)
- [ ] Frontend caricabile su `https://hyperliquid-81-17-100-112.nip.io`
- [ ] Container `healthy` in `docker compose ps`

## 🚨 Sicurezza post-reset

Approfittane per:

1. **Ruotare basic auth Caddy**: `Gst.L581` è già finita in chat log
   ```bash
   caddy hash-password --plaintext 'NUOVA_PASSWORD_FORTE'
   # Aggiorna /etc/caddy/Caddyfile con nuovo hash
   systemctl reload caddy
   ```

2. **Ruotare password root VPS**: `ed5zrlC*ifdJ3A4a` è esposta
   ```bash
   passwd root
   ```

3. **Disabilita login SSH password** (lascia solo chiave):
   ```bash
   # /etc/ssh/sshd_config
   PasswordAuthentication no
   PermitRootLogin prohibit-password
   systemctl restart sshd
   ```

4. **Quando andrai live** con denaro vero:
   - `HL_API_PRIVATE_KEY` deve essere **API wallet HL delegata**, NON master wallet
   - Withdraw NON autorizzato sulla key API
   - Considera secret manager (HashiCorp Vault, AWS KMS) invece di `.env` plaintext

## 📁 Branch GitHub

- `main` — versione iniziale (Bot Health dashboard + 10 strategie classiche)
- `feat/audit-suite-funding-harvest` — versione attuale completa (audit-driven, TIER A/B/C, funding harvest, FundingLive panel)

PR da mergiare per consolidare in main: https://github.com/lumontech/hyper/pull/new/feat/audit-suite-funding-harvest
