# Deploy su VPS — guida completa

> **Prerequisito mentale**: questa piattaforma può deployarsi *in convivenza* con un'altra piattaforma già presente sulla VPS, **se rispettiamo tre vincoli**:
> 1. Porta backend dedicata (default 7777, modificabile)
> 2. Bind locale `127.0.0.1` (niente esposizione diretta, accesso solo via reverse proxy o SSH tunnel)
> 3. Path-prefix o sottodominio dedicato sul reverse proxy esistente (`nginx` o `Caddy`)

## Indice

1. [Check pre-deploy: cosa serve sapere della VPS](#check-pre-deploy)
2. [Convivenza: 3 scenari supportati](#convivenza)
3. [Deploy opzione A — Docker Compose](#deploy-docker)
4. [Deploy opzione B — systemd nativo](#deploy-systemd)
5. [Accesso remoto: SSH tunnel vs reverse proxy](#accesso-remoto)
6. [Hardening + secrets management](#hardening)
7. [Monitoring + log rotation](#monitoring)

---

## Check pre-deploy

Prima di muovere un byte, ho bisogno di sapere:

| Domanda | Perché serve |
|---------|--------------|
| **1. Provider + OS** della VPS (Contabo Ubuntu 22? DigitalOcean Debian 12? Hetzner?) | Per scegliere lo stack (apt vs apk vs yum) e check se Node 22+ è disponibile come pacchetto |
| **2. Cosa già gira** sulla VPS? (`trade.fondamentale`? Solo nginx? Docker? Plesk/cPanel?) | Per evitare port conflict e capire se c'è già un reverse proxy da estendere |
| **3. Hostname / dominio** della piattaforma esistente (es. `trading.miosito.com`) | Per decidere: sottodominio nuovo (`hl.miosito.com`) o path-prefix (`trading.miosito.com/hyperliquid/`) |
| **4. Come accedi** alla VPS oggi (SSH + key? Plesk web?) e se hai `sudo` | Per consigliare deploy via Docker (più isolato) o systemd (più nativo) |

Una volta che mi dai questi 4 dati, adatto i file (`docker-compose.yml`, `nginx-hyperliquid.conf`, `install.sh`) ai tuoi valori esatti.

---

## Convivenza

### Scenario 1 — `trade.fondamentale` già su nginx, vuoi `hyperliquid.platform/` come path

```
https://trading.miosito.com/                       → trade.fondamentale (esistente)
https://trading.miosito.com/hyperliquid/           → hyperliquid frontend
https://trading.miosito.com/hyperliquid/api/*      → reverse proxy a 127.0.0.1:7777
```

Snippet pronto: [`nginx-hyperliquid.conf`](nginx-hyperliquid.conf). Da incollare dentro il `server { }` HTTPS esistente.

### Scenario 2 — Sottodominio dedicato (più pulito)

```
https://trading.miosito.com/         → trade.fondamentale
https://hl.miosito.com/              → hyperliquid frontend
https://hl.miosito.com/api/*         → backend
```

Richiede DNS A record per `hl.miosito.com`. Caddy fa HTTPS auto (vedi [`Caddyfile`](Caddyfile)).

### Scenario 3 — VPS solo per te, niente reverse proxy

Tieni backend bind `127.0.0.1:7777`, accedi via **SSH tunnel**:

```powershell
# Dal tuo PC Windows:
ssh -L 7777:127.0.0.1:7777 -L 5174:127.0.0.1:5174 user@vps.ip
# Poi browser: http://127.0.0.1:5174
```

Zero esposizione pubblica. **Più sicuro in assoluto.**

---

## Deploy opzione A — Docker Compose

Pro: isolato, riproducibile, niente conflitti deps.
Contro: serve Docker installato.

```bash
# Su VPS:
cd /opt
git clone <REPO_URL> hyperliquid-bot
cd hyperliquid-bot
cp .env.example .env
nano .env                                    # edita HL_MASTER_ADDRESS, ecc.
docker compose up -d --build
docker compose logs -f                       # verifica boot
curl http://127.0.0.1:7777/status            # smoke test
```

Restart: `docker compose restart`. Stop: `docker compose down`.
Update: `git pull && docker compose up -d --build`.

Volume `./data` persiste DB, audit log, results del backtest.

## Deploy opzione B — systemd nativo

Pro: niente runtime extra, più leggero.
Contro: ti gestisci tu deps e versioni Node.

```bash
# Su VPS (script automatizzato):
sudo REPO_URL=https://github.com/tu/repo.git bash deploy/install.sh
```

Lo script:
1. Installa Node 22 da NodeSource
2. Crea utente `hluser` dedicato (non root)
3. Clone in `/opt/hyperliquid-bot`
4. `npm ci` backend + frontend
5. Build frontend statico (`web/dist`)
6. Installa systemd unit
7. Avvia il service
8. Health check

Logs: `journalctl -u hyperliquid-bot -f`.

---

## Accesso remoto

### A — SSH tunnel (consigliato per uso personale)

```powershell
# Windows PowerShell:
ssh -L 5174:127.0.0.1:5174 -L 7777:127.0.0.1:7777 stefano@vps.ip
```

Poi browser su `http://127.0.0.1:5174` come se fosse locale. **Niente esposizione pubblica.**

In dev mode (Vite): aggiungi `--host 127.0.0.1` (già default).
In prod (frontend statico servito da nginx in `127.0.0.1:5174` interno): possibile, ma più semplice usare reverse proxy.

### B — Reverse proxy con basic auth

Adatto se vuoi accedere da più dispositivi senza SSH ogni volta.

1. Genera password: `sudo htpasswd -c /etc/nginx/.hl-htpasswd stefano`
2. Copia [`nginx-hyperliquid.conf`](nginx-hyperliquid.conf) dentro il tuo `server { }` HTTPS esistente
3. `sudo nginx -t && sudo systemctl reload nginx`
4. Browser su `https://trading.miosito.com/hyperliquid/`

**Nota frontend con path-prefix**: il frontend assume `__API_BASE__='http://127.0.0.1:7777'` di default (dev). Per produzione con prefix, devi rebuildare con:

```bash
VITE_API_BASE=/hyperliquid/api npm --prefix web run build
```

E modificare `web/vite.config.ts` per leggere `process.env.VITE_API_BASE`. Te lo posso fare quando mi confermi lo scenario.

### C — Caddy con HTTPS auto

Più semplice di nginx se non hai già un reverse proxy. Vedi [`Caddyfile`](Caddyfile).
Caddy gestisce certificati Let's Encrypt automaticamente.

---

## Hardening

### Permessi file critici

```bash
sudo chmod 600 /opt/hyperliquid-bot/.env                # solo owner legge
sudo chmod 600 /opt/hyperliquid-bot/data/audit/*.log    # audit log read-only
sudo chmod 700 /opt/hyperliquid-bot/data                # dir privata
```

### Firewall (UFW)

```bash
# Apri SOLO SSH + HTTPS, mai 7777 in chiaro:
sudo ufw allow ssh
sudo ufw allow https
sudo ufw enable
```

Il backend è `127.0.0.1:7777` → non raggiungibile da fuori VPS senza tunnel o proxy. ✓

### Secrets nel .env

**Mai** committare `.env`. Mai mettere la chiave del wallet **master**: usa una **API Wallet** dedicata di Hyperliquid (https://app.hyperliquid.xyz/API) con solo permessi di trading, senza withdraw.

### Kill switch remoto

Anche da remoto puoi attivare HALT:

```bash
ssh stefano@vps.ip "touch /opt/hyperliquid-bot/.HALT"
```

Il bot flatten + exit entro 1 secondo.

---

## Monitoring

### Health check periodico (cron)

```cron
# /etc/cron.d/hyperliquid-health
*/5 * * * * hluser curl -fsS http://127.0.0.1:7777/status >/dev/null || echo "Hyperliquid down" | mail -s "ALERT" admin@miosito.com
```

### Log rotation (logrotate)

```
# /etc/logrotate.d/hyperliquid-bot
/opt/hyperliquid-bot/data/audit/*.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
    create 0600 hluser hluser
}
```

### Metriche Prometheus (futuro)

Sprint 4: aggiungere `/metrics` endpoint con counter ordini, equity gauge, P95 latency.

---

## Upgrade workflow

```bash
# Su VPS:
cd /opt/hyperliquid-bot
sudo -u hluser git pull
sudo -u hluser npm ci
sudo -u hluser npm run web:build
sudo systemctl restart hyperliquid-bot
sudo journalctl -u hyperliquid-bot -f
```

## Rollback rapido

```bash
sudo systemctl stop hyperliquid-bot
sudo -u hluser git -C /opt/hyperliquid-bot reset --hard HEAD~1
sudo systemctl start hyperliquid-bot
```

---

## FAQ deploy

**Q: La VPS ha solo Node 18 dal repo Debian, posso usare quello?**
A: No. `node:sqlite` richiede Node 22.5+. Lo script `install.sh` aggiunge il repo NodeSource e installa Node 22.

**Q: Conviene Docker o systemd?**
A: Docker se vuoi isolamento totale e zero conflitti. Systemd se la VPS è già setup per te e vuoi runtime nativo più leggero. Entrambi supportati.

**Q: Posso girare backend qui e frontend sul mio PC?**
A: Sì. Tieni il backend sulla VPS (bind 0.0.0.0 + auth in front), e fai `npm run web:dev` localmente con `__API_BASE__='https://hl.miosito.com/api'`.

**Q: Conflitto se VPS ha già nginx con `trade.fondamentale`?**
A: Zero conflitto se usi path-prefix o sottodominio. Lo snippet [`nginx-hyperliquid.conf`](nginx-hyperliquid.conf) è un `location` block: lo metti DENTRO il tuo `server` esistente, non rimpiazza nulla.

**Q: La VPS è su Contabo VPS S — 4 vCPU, 8 GB, posso girare entrambe le piattaforme?**
A: Sì, abbondantemente. Hyperliquid bot consuma ~150 MB RAM + <5% CPU steady state. Docker container è limitato a 512 MB / 1 vCPU di default in `docker-compose.yml`.
