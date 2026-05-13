# Contabo Ubuntu — Quickstart Hyperliquid Platform (PROGETTO ISOLATO)

Setup per **Contabo VPS Ubuntu 22.04/24.04** dove `trade.fondamentale` è già attivo.
**Garanzia di isolamento**: zero file di `trade.fondamentale` vengono toccati.

## Cosa NON tocchiamo MAI

| Risorsa di trade.fondamentale | Status |
|-------------------------------|--------|
| Cartella del progetto (`/home/user/trade.fondamentale` o ovunque sia) | INTOCCATA |
| Processo Vite / Node che gira | INTOCCATO |
| File `.env` / config / DB | INTOCCATI |
| Porta 5173 (o quella che usa) | INTOCCATA |
| File nginx esistenti (se ci sono) | INTOCCATI |
| Certificati SSL già emessi | INTOCCATI |
| DNS A record esistenti | INTOCCATI |

## Cosa creiamo (TUTTO NUOVO, ZERO OVERLAP)

| Nuova risorsa | Path / posizione |
|---------------|------------------|
| Cartella progetto | `/opt/hyperliquid-bot/` (nuova) |
| Utente Docker | `node` dentro il container (isolato) |
| Container Docker | `hyperliquid-bot` (nome univoco) |
| Porta backend | `127.0.0.1:7777` (bind locale, mai esposta) |
| File nginx | `/etc/nginx/sites-available/hyperliquid` (NUOVO file, separato) |
| Symlink nginx enable | `/etc/nginx/sites-enabled/hyperliquid` (NUOVO) |
| Sottodominio | `hl.tuodominio.com` (nuovo A record DNS) |
| Certificato SSL | `/etc/letsencrypt/live/hl.tuodominio.com/` (nuovo) |
| Basic auth password | `/etc/nginx/.hl-htpasswd` (nuovo file) |
| DB + audit log | `/opt/hyperliquid-bot/data/` (isolato dentro al progetto) |

---

## Architettura finale

```
                                      ┌──────────────┐
   user @ browser ─────HTTPS──────────│ Cloudflare   │ (opzionale)
                                      └──────┬───────┘
                                             │
                                             ▼
                              ┌──────────────────────────────┐
                              │  VPS Contabo Ubuntu          │
                              │                              │
                              │  trade.fondamentale          │  ◀── INTOCCATO
                              │    ↳ resta com'è oggi        │
                              │                              │
                              │  nginx (sistema-wide)        │
                              │    ├ tuoi server block       │  ◀── INTOCCATI
                              │    │  per trade.fondamentale │
                              │    └ NUOVO server block      │  ◀── AGGIUNTO
                              │      per hl.tuodominio.com   │      (file separato)
                              │           │                  │
                              │           ▼ proxy_pass       │
                              │  Docker container :7777      │  ◀── NUOVO
                              │   ↳ /opt/hyperliquid-bot     │
                              └──────────────────────────────┘
```

3 opzioni di accesso, in ordine di consigliato:

| Opzione | Tocca config esistenti? | Setup | HTTPS |
|---------|-------------------------|-------|-------|
| **A. Nginx server block standalone** | No (nuovo file separato) | 15 min | certbot |
| **B. Cloudflare Tunnel** | No (proprio zero modifiche) | 10 min | auto CF |
| **C. SSH tunnel solo** | No (niente esposizione) | 2 min | non serve |

---

## Pre-flight: cosa hai sulla VPS?

```bash
ssh user@TUO_IP_CONTABO

# Verifica
which docker            # se manca: serve install
which nginx             # se manca: serve install (solo se vuoi opzione A)
which cloudflared       # se manca e vuoi opzione B
node -v                 # opzionale, il container ha già Node 22
sudo ss -tlnp | grep -E "5173|7777|80|443"   # cosa già in ascolto
```

Se mancano Docker o nginx:

```bash
# Docker (se non c'è)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# logout/login per applicare gruppo

# Nginx (solo se scegli opzione A)
sudo apt update && sudo apt install -y nginx apache2-utils certbot python3-certbot-nginx
```

---

## Step 1 — Trasferisci sorgenti

### Da Windows PowerShell:

```powershell
cd C:\Users\Stefano\.claude

# Crea archivio escludendo robaccia
tar -czf hyperliquid.bot.tar.gz `
  --exclude='hyperliquid.bot/node_modules' `
  --exclude='hyperliquid.bot/web/node_modules' `
  --exclude='hyperliquid.bot/data' `
  --exclude='hyperliquid.bot/.HALT' `
  --exclude='hyperliquid.bot/out.log' `
  hyperliquid.bot

scp hyperliquid.bot.tar.gz user@TUO_IP_CONTABO:/tmp/
```

### Sulla VPS:

```bash
sudo mkdir -p /opt/hyperliquid-bot
sudo chown $USER:$USER /opt/hyperliquid-bot
cd /opt
tar -xzf /tmp/hyperliquid.bot.tar.gz
mv hyperliquid.bot/* hyperliquid.bot/.* hyperliquid-bot/ 2>/dev/null || true
rmdir hyperliquid.bot
rm /tmp/hyperliquid.bot.tar.gz
cd /opt/hyperliquid-bot
```

---

## Step 2 — Configura .env

```bash
cd /opt/hyperliquid-bot
cp .env.example .env
nano .env
```

Imposta:
```bash
HL_NETWORK=mainnet
EXEC_DRY_RUN=true            # MAI cambiare finché non hai testato 30+ giorni
HL_MASTER_ADDRESS=           # opzionale: tuo wallet HL per vedere account reale
HL_API_PRIVATE_KEY=          # vuoto = no signing (info-only)
HL_API_WALLET_ADDRESS=
```

```bash
chmod 600 .env
```

---

## Step 3 — Build + start container (isolato)

```bash
cd /opt/hyperliquid-bot
docker compose build         # 5-8 min prima volta
docker compose up -d
docker compose logs -f       # verifica "BOOT startup complete"
# Ctrl+C esce dal tail
```

Smoke test:

```bash
curl -s http://127.0.0.1:7777/status | head -c 200
```

Verifica che il container **NON espone porte pubbliche**:

```bash
sudo ss -tlnp | grep 7777
# Output deve essere SOLO: 127.0.0.1:7777   (NON 0.0.0.0:7777)
```

`trade.fondamentale` e tutto il resto continuano a girare normalmente — abbiamo solo aggiunto un container in più.

---

## Step 4 — Esporre la piattaforma (scegli UNA opzione)

### 🅰️ Opzione A — Nginx server block STANDALONE (consigliato)

#### A.1 — DNS

Sul tuo registrar/DNS, crea **nuovo A record**:
```
hl.tuodominio.com   →   TUO_IP_CONTABO
```

Aspetta propagazione (1-30 min): `dig hl.tuodominio.com +short` deve restituire l'IP.

#### A.2 — Copia il file nginx (NUOVO file, non modifica esistenti)

```bash
# Personalizza HL_DOMAIN dentro al file
sudo sed "s/HL_DOMAIN/hl.tuodominio.com/g" /opt/hyperliquid-bot/deploy/nginx-hyperliquid.conf \
  | sudo tee /etc/nginx/sites-available/hyperliquid >/dev/null

# Abilita il sito
sudo ln -s /etc/nginx/sites-available/hyperliquid /etc/nginx/sites-enabled/hyperliquid
```

> **Importante**: ho usato `sites-available/hyperliquid` (NUOVO file). I tuoi file esistenti in `sites-available/` non vengono toccati né rinominati.

#### A.3 — Basic auth password

```bash
sudo htpasswd -c /etc/nginx/.hl-htpasswd stefano
# Inserisci password 2 volte
sudo chown root:www-data /etc/nginx/.hl-htpasswd
sudo chmod 640 /etc/nginx/.hl-htpasswd
```

#### A.4 — Certificato HTTPS Let's Encrypt

```bash
sudo certbot --nginx -d hl.tuodominio.com
# Segui il wizard, scegli "redirect HTTP→HTTPS"
```

Certbot aggiorna automaticamente il file `/etc/nginx/sites-enabled/hyperliquid` per inserire i path SSL corretti, senza toccare altri file.

#### A.5 — Verifica e reload

```bash
sudo nginx -t                       # syntax check di TUTTA la config (anche files esistenti)
# Se OK:
sudo systemctl reload nginx         # reload, non restart → connessioni esistenti continuano
```

Browser → `https://hl.tuodominio.com/`
1. Basic auth → user `stefano` + password
2. Carica piattaforma Hyperliquid

Smoke test:
```bash
curl -u stefano:LA_TUA_PASSWORD https://hl.tuodominio.com/status
```

### 🅱️ Opzione B — Cloudflare Tunnel (zero touch nginx)

Vedi [`deploy/cloudflare-tunnel.md`](cloudflare-tunnel.md). Workflow in 8 step, ~10 min.
**Vantaggio**: non installi nginx, non apri porte, niente certbot. Cloudflare gestisce tutto.

### 🅲 Opzione C — SSH tunnel solo

Dal tuo PC:
```powershell
ssh -L 7777:127.0.0.1:7777 user@TUO_IP_CONTABO
# Tieni questo terminale aperto
```
Poi browser → `http://127.0.0.1:7777/`
**Nessuna esposizione pubblica**, perfetto per uso strettamente personale.

---

## Verifica finale — trade.fondamentale è intatto

```bash
# Servizi di trade.fondamentale ancora attivi?
sudo ss -tlnp | grep 5173        # deve esserci ancora il suo processo
ps aux | grep "vite\|node" | head # processi di trade.fondamentale ancora running

# nginx config ha entrambi i siti?
sudo nginx -T 2>/dev/null | grep -E "^server_name" 
# Deve mostrare i server_name di trade.fondamentale (immutati) E hl.tuodominio.com (nuovo)

# Health check entrambe le piattaforme:
curl -I https://tuodominio-trade-fondamentale.com    # trade.fondamentale ok
curl -I -u stefano:pwd https://hl.tuodominio.com/    # hyperliquid ok
```

---

## Comandi operativi (solo per hyperliquid-bot)

| Cosa | Comando |
|------|---------|
| Logs live | `cd /opt/hyperliquid-bot && docker compose logs -f` |
| Restart | `docker compose restart` |
| Stop | `docker compose down` |
| Update | `cd /opt/hyperliquid-bot && git pull && docker compose up -d --build` |
| Kill switch | `touch /opt/hyperliquid-bot/.HALT` → flatten + exit entro 1s |
| Resume | `rm /opt/hyperliquid-bot/.HALT && docker compose restart` |
| Stats RAM/CPU | `docker stats hyperliquid-bot --no-stream` |
| Audit log tail | `tail -f /opt/hyperliquid-bot/data/audit/signed-payloads.log` |
| Disabilitare temporaneamente | `sudo rm /etc/nginx/sites-enabled/hyperliquid && sudo systemctl reload nginx` (404 esterno, container resta su) |

`trade.fondamentale` NON viene mai toccato da nessuno di questi comandi.

---

## Disinstallazione clean (se vuoi rimuovere tutto)

```bash
# 1. Stop + rimuovi container
cd /opt/hyperliquid-bot
docker compose down -v          # -v elimina anche volumi
docker rmi hyperliquid-platform:0.2.0

# 2. Rimuovi nginx site (NON tocca altri siti)
sudo rm /etc/nginx/sites-enabled/hyperliquid
sudo rm /etc/nginx/sites-available/hyperliquid
sudo nginx -t && sudo systemctl reload nginx

# 3. Rimuovi cert (opzionale, conserva per riuso)
sudo certbot delete --cert-name hl.tuodominio.com

# 4. Rimuovi cartella progetto
sudo rm -rf /opt/hyperliquid-bot

# 5. Rimuovi basic auth
sudo rm /etc/nginx/.hl-htpasswd

# 6. Rimuovi DNS A record dal tuo registrar (manuale)
```

trade.fondamentale rimane esattamente com'era prima di iniziare.

---

## Troubleshooting

### `502 Bad Gateway` su hl.tuodominio.com
- Container up? `docker compose ps`
- Backend risponde? `curl http://127.0.0.1:7777/status`
- nginx config? `sudo nginx -t`
- Logs nginx: `sudo tail -f /var/log/nginx/hyperliquid-error.log`

### `nginx: [emerg] duplicate "listen 443"` durante test
- Hai inserito il server block sbagliato (dentro a un server esistente?)
- Verifica: deve essere FILE SEPARATO `/etc/nginx/sites-available/hyperliquid`, non incollato dentro al server block di trade.fondamentale.

### certbot fallisce
- DNS propagato? `dig hl.tuodominio.com +short`
- Porta 80 raggiungibile da Internet? `sudo ufw status` (deve permettere `http`)

### Assets non caricano (white page)
- Build con sottodominio (`VITE_BASE=/`) corretto? Verifica:
  ```bash
  docker exec hyperliquid-bot grep -o '"/assets/[^"]*"' /app/web-dist/index.html | head -3
  # Output deve mostrare path che iniziano con "/assets/" (NON "/hyperliquid/assets/")
  ```

---

## Backup giornaliero (solo dati hyperliquid, non tocca altri progetti)

`/etc/cron.daily/hyperliquid-backup`:

```bash
#!/bin/bash
mkdir -p /backup/hyperliquid
tar -czf /backup/hyperliquid/$(date +%F).tar.gz -C /opt hyperliquid-bot/data
find /backup/hyperliquid -name '*.tar.gz' -mtime +30 -delete
```

```bash
sudo chmod +x /etc/cron.daily/hyperliquid-backup
```

---

## Riassunto isolamento garantito

✅ Cartella progetto separata: `/opt/hyperliquid-bot/` (mai mescolata con altre)
✅ Container Docker isolato: filesystem, network, processi separati dal resto
✅ Porta interna `127.0.0.1:7777` invisibile al mondo, raggiungibile solo da nginx/Cloudflare locali
✅ File nginx **separato** (`sites-available/hyperliquid`), tuoi config esistenti **mai modificati**
✅ Sottodominio dedicato `hl.tuodominio.com` con cert SSL proprio
✅ DB + audit log dentro `/opt/hyperliquid-bot/data/` — niente sparso per il sistema
✅ Logs nginx separati: `/var/log/nginx/hyperliquid-{access,error}.log`
✅ Disinstallazione clean: rimuovere il container + il file nginx separato lascia il sistema esattamente come prima
