# OPZIONE C — SSH Tunnel deploy (zero esposizione)

Setup massimo isolamento. Backend gira sulla VPS Contabo, raggiungibile **solo dal tuo PC** via SSH port-forward. Niente dominio pubblico, niente HTTPS pubblico, niente porte aperte.

## Architettura

```
┌──────────────────────┐                    ┌──────────────────────────────┐
│  PC Windows          │                    │  VPS Contabo                  │
│                      │                    │                              │
│  Browser             │                    │  trade.fondamentale          │
│   ↓                  │                    │   ↳ resta com'e' oggi        │
│  127.0.0.1:7777      │                    │   ↳ MAI toccato              │
│   ↓                  │      SSH tunnel    │                              │
│  ssh -L 7777 ──────────────────────────▶  │  Docker container             │
│                      │                    │   bind 127.0.0.1:7777        │
└──────────────────────┘                    │   (invisibile da internet)   │
                                            └──────────────────────────────┘
```

L'unica connessione esterna è quella SSH (porta 22). Il container backend è **completamente invisibile** dal mondo.

---

## Cosa serve

| Sul tuo PC Windows | Sulla VPS Contabo |
|-------------------|---------------------|
| OpenSSH client (Windows 10/11 ce l'ha già) | Ubuntu 22.04/24.04 |
| Cartella `C:\Users\Stefano\.claude\hyperliquid.bot` | Accesso SSH (root o utente con sudo) |
| `tar` (Windows 10/11 ce l'ha già) | Non serve nient'altro: lo script installa Docker |

---

## Setup completo in 4 step (≈15 minuti)

### Step 1 — Trasferisci sorgenti (Windows → VPS)

Doppio click su **[`scp-to-vps.bat`](../scp-to-vps.bat)** nella cartella `hyperliquid.bot`.

Al primo lancio chiede:
- **IP della VPS** (es. `123.45.67.89`)
- **Utente SSH** (es. `root` o il tuo username)

Salva la config in `vps-config.txt` per le volte successive.

Lo script:
1. Crea archivio tar.gz (esclude `node_modules`, `data`, log)
2. Upload via `scp` su `/tmp/`
3. Estrae lato VPS in `/opt/hyperliquid-bot/`
4. Stampa il comando per il prossimo step

### Step 2 — Deploy lato VPS

Connettiti via SSH alla VPS:

```bash
ssh user@TUO_IP_VPS
cd /opt/hyperliquid-bot
sudo bash deploy/auto-deploy-c.sh
```

Lo script `auto-deploy-c.sh`:
1. Installa Docker (se manca)
2. Crea `.env` da template (con permessi 600)
3. **Verifica esplicitamente** che il bind sia `127.0.0.1` (no esposizione)
4. **Verifica esplicitamente** che ufw non abbia la porta 7777 aperta esternamente
5. `docker compose build` + `up -d`
6. Health check con retry
7. **Verifica isolamento** post-deploy via `ss -tlnp`

Se uno qualsiasi dei check di sicurezza fallisce, **lo script aborta** e non avvia il container.

### Step 3 — Apri il tunnel SSH (dal PC Windows)

Doppio click su **[`tunnel-to-vps.bat`](../tunnel-to-vps.bat)**.

Riusa la config di scp-to-vps. Apre:
```
ssh -N -L 7777:127.0.0.1:7777 user@VPS_IP
```

Vedrai prompt password (o usa key auth, vedi sotto). Tieni la finestra aperta.

### Step 4 — Accedi alla piattaforma

Apri il browser su **http://127.0.0.1:7777/**

La piattaforma è raggiungibile **solo** finché il tunnel è aperto. Chiudi il tunnel → niente accesso.

**Shortcut**: doppio click su **[`open-platform.bat`](../open-platform.bat)** — apre tunnel + browser in un colpo.

---

## Auth SSH con chiave (no password ogni volta)

Genera chiave dedicata sul PC Windows:

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\hyperliquid-vps -C "hyperliquid-vps"
# Premi Enter per niente passphrase, oppure metti una passphrase
```

Copia la pubblica sulla VPS:

```powershell
# Windows 10/11 ha ssh-copy-id? Spesso no. Alternativa:
type $env:USERPROFILE\.ssh\hyperliquid-vps.pub | ssh user@VPS_IP "cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Edita `vps-config.txt` aggiungendo:
```
VPS_KEY=C:\Users\Stefano\.ssh\hyperliquid-vps
```

Da ora `tunnel-to-vps.bat` userà la chiave senza chiedere password.

---

## Workflow giornaliero

Quando vuoi usare la piattaforma:

1. Doppio click su `open-platform.bat`
2. Lavora nella web UI: Dashboard, Auto-Trader, Backtest, Strategies
3. Quando hai finito, chiudi la finestra "Hyperliquid SSH Tunnel"

Il container backend **continua a girare sulla VPS** anche con tunnel chiuso: scarica candele, genera segnali, scrive in DB, fa dry-run. Quando riapri il tunnel rivedi tutto lo storico.

---

## Comandi operativi sulla VPS

Connessione SSH normale:

```bash
ssh user@VPS_IP
cd /opt/hyperliquid-bot

# Status container
docker compose ps
docker compose logs --tail=50

# Logs live
docker compose logs -f

# Restart
docker compose restart

# Stop completo
docker compose down

# Kill switch (flatten + exit)
touch .HALT

# Resume
rm .HALT && docker compose restart

# Update (dopo aver fatto scp-to-vps di nuovo)
docker compose up -d --build
```

---

## Sicurezza — quello che hai garantito

✅ **Backend mai esposto**: `127.0.0.1:7777` interno alla VPS, non raggiungibile da internet
✅ **Auto-deploy verifica bind**: lo script aborta se docker-compose ha `0.0.0.0`
✅ **Auto-deploy verifica firewall**: rimuove la porta 7777 da ufw se per sbaglio era aperta
✅ **Auto-deploy verifica post-boot**: `ss -tlnp` deve mostrare `127.0.0.1:7777` (non `0.0.0.0`)
✅ **Audit log immutable**: `/opt/hyperliquid-bot/data/audit/signed-payloads.log` append-only
✅ **`.env` chmod 600**: solo owner legge le chiavi API
✅ **Container non-root**: processo Node gira come `node` user dentro container
✅ **trade.fondamentale MAI toccato**: zero modifiche a nginx, certificati, DNS, processi esistenti

---

## Disinstallazione clean

Sulla VPS:

```bash
cd /opt/hyperliquid-bot
docker compose down -v
sudo rm -rf /opt/hyperliquid-bot
docker rmi hyperliquid-platform:0.2.0 2>/dev/null || true
```

Sul PC Windows:

```cmd
del vps-config.txt
```

Sistema VPS torna esattamente com'era prima. `trade.fondamentale` non si accorge di nulla.

---

## Troubleshooting

### `ssh: connection refused`
- VPS accesa? `ping VPS_IP`
- Porta SSH 22 aperta? `nmap -p 22 VPS_IP` da terminale Linux/WSL

### `Permission denied (publickey)`
- Hai messo la chiave pubblica in `~/.ssh/authorized_keys` sulla VPS?
- Permessi `~/.ssh` su VPS: `chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`

### Tunnel si apre ma browser dà `ERR_CONNECTION_REFUSED`
- Container è up? `ssh VPS_IP "docker compose -f /opt/hyperliquid-bot/docker-compose.yml ps"`
- Backend risponde localmente? `ssh VPS_IP "curl -s http://127.0.0.1:7777/status"`

### `bind: Address already in use` quando lancio tunnel
- Hai già un tunnel aperto sulla porta 7777 (probabilmente in un'altra finestra)
- Chiudi tutti i cmd con "Hyperliquid SSH Tunnel" nel titolo
- Oppure: `netstat -ano | findstr :7777` per trovare il PID e killarlo

### Backend si avvia ma il browser dà 502 / blank page
- Verifica che il build del frontend sia stato fatto: `ssh VPS_IP "docker exec hyperliquid-bot ls /app/web-dist/index.html"`
- Se manca → rebuild: `docker compose build --no-cache && docker compose up -d`

### Vedo solo `{"ok":true,...}` su 127.0.0.1:7777 (no UI)
- Stai accedendo a `/status` direttamente. Apri `http://127.0.0.1:7777/` (slash finale)
- O `http://127.0.0.1:7777/index.html`

---

## File del progetto coinvolti

| File | Cosa fa |
|------|---------|
| [`scp-to-vps.bat`](../scp-to-vps.bat) | Trasferisce sorgenti Windows → VPS |
| [`tunnel-to-vps.bat`](../tunnel-to-vps.bat) | Apre tunnel SSH dal PC |
| [`open-platform.bat`](../open-platform.bat) | Tunnel + browser in un click |
| [`deploy/auto-deploy-c.sh`](auto-deploy-c.sh) | Setup completo lato VPS |
| [`vps-config.txt`](../vps-config.txt) | Config persistente IP/utente/chiave (creato al primo uso) |
| `Dockerfile` / `docker-compose.yml` | Build + run container |

---

## Backup giornaliero (sulla VPS)

```bash
sudo nano /etc/cron.daily/hyperliquid-backup
```

Contenuto:
```bash
#!/bin/bash
mkdir -p /backup/hyperliquid
tar -czf /backup/hyperliquid/$(date +%F).tar.gz -C /opt hyperliquid-bot/data
find /backup/hyperliquid -name '*.tar.gz' -mtime +30 -delete
```

```bash
sudo chmod +x /etc/cron.daily/hyperliquid-backup
```

Backup persistente in `/backup/hyperliquid/`, rotato a 30 giorni.
