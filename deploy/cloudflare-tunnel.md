# Cloudflare Tunnel — opzione "zero touch VPS"

Alternativa al deploy nginx: invece di esporre porte sulla VPS, **Cloudflare Tunnel** crea un canale outbound dalla VPS verso Cloudflare, e l'utente accede via dominio Cloudflare.

## Pro

- **Zero porte aperte** sul firewall VPS (niente 80/443 esposti)
- **Zero modifiche a nginx esistente**: il tunnel non passa da nginx
- **HTTPS automatico** (gestito da Cloudflare)
- **Autenticazione gratis** via Cloudflare Access (email OTP, Google login, ecc.)
- DDoS protection inclusa

## Contro

- Devi avere un dominio sul DNS di Cloudflare (anche un sottodominio gratis va bene)
- Dipendenza da Cloudflare per accedere
- Latenza leggermente superiore (passa per CF edge)

---

## Setup (10 minuti)

### 1. Aggiungi dominio a Cloudflare (se non l'hai già)

Se hai `tuodominio.com` registrato altrove, aggiungi il dominio a Cloudflare e cambia i nameserver. Free plan è sufficiente. Lascia che `trade.fondamentale` continui a vivere sul suo IP/dominio attuale: Cloudflare gestisce solo `hl.tuodominio.com`.

### 2. Installa cloudflared sulla VPS Contabo

```bash
# Aggiungi repo Cloudflare
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main' | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt update
sudo apt install -y cloudflared
```

### 3. Login alla tua account Cloudflare

```bash
cloudflared tunnel login
```

Apre un URL nel browser → autorizza il dominio scelto.
Crea `~/.cloudflared/cert.pem`.

### 4. Crea il tunnel

```bash
cloudflared tunnel create hyperliquid-bot
# Output: tunnel ID, salvato in ~/.cloudflared/<UUID>.json
```

### 5. Crea route DNS automatica

```bash
cloudflared tunnel route dns hyperliquid-bot hl.tuodominio.com
```

Questo crea il record DNS CNAME `hl.tuodominio.com` → `<UUID>.cfargotunnel.com`. Automatico.

### 6. Config file del tunnel

Crea `/etc/cloudflared/config.yml`:

```yaml
tunnel: hyperliquid-bot
credentials-file: /root/.cloudflared/<UUID>.json   # path completo dal punto 4

ingress:
  - hostname: hl.tuodominio.com
    service: http://127.0.0.1:7777
  - service: http_status:404
```

### 7. Avvia il tunnel come servizio

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

### 8. Test

Browser → `https://hl.tuodominio.com/`
Carica direttamente la piattaforma (passa per Cloudflare → tunnel → 127.0.0.1:7777).

---

## Aggiungi auth Cloudflare Access (consigliato)

Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**:

1. Application name: `Hyperliquid Platform`
2. Subdomain: `hl`
3. Domain: `tuodominio.com`
4. **Policy**: "Allow only emails ending with @tuamail.com" oppure lista esplicita
5. Save

Da ora chi visita `hl.tuodominio.com` deve autenticarsi via email/Google **prima** di raggiungere il backend. Il backend non vede nemmeno la richiesta se l'utente non è autorizzato.

**Bonus**: Cloudflare ti manda email se qualcuno tenta accesso non autorizzato.

---

## Confronto con nginx server block

| Aspetto | nginx server block | Cloudflare Tunnel |
|---------|---------------------|-------------------|
| Modifiche al sistema esistente | Aggiunge `/etc/nginx/sites-available/hyperliquid` + `htpasswd` | Solo installa `cloudflared` (non tocca nginx) |
| Porte aperte sulla VPS | 80, 443 (probabilmente già aperte) | **Nessuna nuova** |
| HTTPS | Manuale (certbot) | Auto via CF |
| Auth | Basic auth (password in chiaro al browser) | OAuth/email/IP (Zero Trust) |
| DDoS protection | No | Sì |
| Latenza extra | ~0 | ~30-80 ms (passa per edge CF) |
| Dipendenza esterna | Solo Let's Encrypt | Cloudflare |
| Setup time | 15-20 min | 10 min |

**Raccomandazione**: se hai già Cloudflare per altri domini → Tunnel. Altrimenti nginx server block standalone (vedi [`nginx-hyperliquid.conf`](nginx-hyperliquid.conf)).

---

## Disinstallare il tunnel (clean)

```bash
sudo systemctl stop cloudflared
sudo systemctl disable cloudflared
sudo cloudflared service uninstall
cloudflared tunnel delete hyperliquid-bot
sudo apt remove --purge cloudflared
```

`trade.fondamentale` non viene MAI toccato in nessuno step.
