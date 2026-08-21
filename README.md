# Solco — relay Discogs sul PC di casa, guida completa

Segui i passaggi in ordine. Ogni comando va incollato nel terminale del PC
Ubuntu, a meno che non sia specificato diversamente (router, DuckDNS,
Cloudflare sono pagine web).

---

## Fase 0 — Verifica che la tua rete lo permetta (CGNAT)

Da un browser sul PC di casa:
1. Vai su **whatismyip.com**, segna l'indirizzo che mostra.
2. Entra nel pannello del router (di solito `192.168.1.1`, utente/password sono
   sull'etichetta del router se non li hai mai cambiati) → cerca la voce
   "WAN", "Internet" o "Stato connessione" → segna l'IP mostrato lì.

**Se i due indirizzi coincidono**, procedi pure con questa guida.
**Se sono diversi**, il tuo provider usa il CGNAT: questa strada non
funziona senza soluzioni più complicate (fermati qui e fammelo sapere,
troviamo un'alternativa).

---

## Fase 1 — Port forwarding sul router

Nel pannello del router, cerca "Port Forwarding" o "NAT" (il nome cambia da
marca a marca). Crea UNA sola regola:

- Porta esterna: `8787`
- Porta interna: `8787`
- IP interno: l'indirizzo locale del PC Ubuntu (lo trovi con `hostname -I` nel
  terminale del PC, di solito qualcosa tipo `192.168.1.XX`)
- Protocollo: TCP

**Non aprire nessun'altra porta**, in particolare non la 22 (SSH) — per
amministrare il PC lavori direttamente da lì o dalla rete di casa, non serve
raggiungerlo da internet.

---

## Fase 2 — DNS dinamico (l'IP di casa cambia ogni tanto)

1. Vai su **duckdns.org** → accedi con Google/GitHub (gratis) → crea un
   sottodominio a tua scelta, es. `soclorelay` (diventa
   `soclorelay.duckdns.org`) → punta al tuo IP attuale (te lo propone da
   solo) → Add domain.
2. Segna il **token** che ti mostra in alto nella pagina.
3. Sul PC Ubuntu, crea uno script che aggiorna l'IP ogni 5 minuti:

```bash
mkdir -p ~/duckdns
cat > ~/duckdns/duck.sh << 'EOF'
echo url="https://www.duckdns.org/update?domains=soclorelay&token=IL-TUO-TOKEN&ip=" | curl -k -o ~/duckdns/duck.log -K -
EOF
chmod +x ~/duckdns/duck.sh
```

Sostituisci `soclorelay` e `IL-TUO-TOKEN` con i tuoi valori reali. Poi
programmalo per girare ogni 5 minuti:

```bash
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1") | crontab -
```

Da questo momento, `soclorelay.duckdns.org` punterà sempre al tuo IP di
casa attuale, anche se cambia.

---

## Fase 3 — Firewall del PC (ufw)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.0.0/16 to any port 22 proto tcp
```

(se il tuo router usa un altro schema di rete, tipo `10.x.x.x`, sostituisci
`192.168.0.0/16` di conseguenza — lo vedi nel pannello del router).

Poi, la parte importante — accetta la porta del relay **solo** dagli
indirizzi ufficiali di Cloudflare:

```bash
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do sudo ufw allow from $ip to any port 8787 proto tcp; done
for ip in $(curl -s https://www.cloudflare.com/ips-v6); do sudo ufw allow from $ip to any port 8787 proto tcp; done
sudo ufw enable
sudo ufw status
```

L'ultimo comando deve mostrare `Status: active` con le regole elencate.

---

## Fase 4 — Carica ed avvia il relay

Se hai già i file `relay.py` e `solco-relay.service` (dallo zip
`solco-relay.zip` di prima), copiali nella cartella home del PC, ad esempio
dentro `~/solco-relay/`.

Poi:

```bash
sudo cp ~/solco-relay/solco-relay.service /etc/systemd/system/
sudo nano /etc/systemd/system/solco-relay.service
```

Nel file, cambia **quattro** righe (a differenza di un VPS, qui è il tuo PC
di casa):

- `Environment=DISCOGS_TOKEN=INCOLLA-QUI-IL-TUO-TOKEN-DISCOGS` → il tuo token Discogs
- `Environment=RELAY_SECRET=INCOLLA-QUI-UNA-PASSWORD-A-CASO-LUNGA` → una password lunga a caso (32+ caratteri)
- `ExecStart=/usr/bin/python3 /home/ubuntu/solco-relay/relay.py` → `ExecStart=/usr/bin/python3 /home/TUO-UTENTE/solco-relay/relay.py`
- `User=ubuntu` → `User=TUO-UTENTE`

(il tuo nome utente è quello che vedi nel prompt del terminale, oppure lo
trovi col comando `whoami`)

Salva (Ctrl+O, invio, Ctrl+X), poi avvia:

```bash
sudo systemctl daemon-reload
sudo systemctl enable solco-relay
sudo systemctl start solco-relay
sudo systemctl status solco-relay
```

Deve apparire "active (running)" in verde. Se dà errore:
`sudo journalctl -u solco-relay -n 50`.

---

## Fase 5 — Test locale, prima di collegare Cloudflare

```bash
curl -H "X-Relay-Secret: LA-TUA-PASSWORD" "http://localhost:8787/proxy?path=/database/search&q=test"
```

Deve rispondere con del JSON pieno di risultati Discogs, non un errore.

Poi un test **da fuori casa** (es. dal telefono con il Wi-Fi disattivato,
usando la connessione dati):

```
http://soclorelay.duckdns.org:8787/proxy?path=/database/search&q=test
```

(aperto da browser mostrerà "non autorizzato" — è giusto così, manca
l'header segreto che solo il Worker manderà; l'importante è che risponda
qualcosa e non vada in timeout, altrimenti il port forwarding non è a posto)

---

## Fase 6 — Collega Cloudflare

Cloudflare Dashboard → Workers & Pages → Worker "solco" → Settings →
Variables and Secrets → Add, due volte:

- `RELAY_URL` (variabile normale) → `http://soclorelay.duckdns.org:8787`
- `RELAY_SECRET` (tipo **Secret**) → la stessa password della Fase 4

Deploy per applicare.

Poi carica su GitHub il `worker.js` aggiornato (dallo zip di prima, quello
già pronto per usare il relay) e aspetta il deploy automatico.

---

## Fase 7 — Prova vera

Apri l'app, scansiona un disco. Se trova i risultati Discogs, hai finito.

Se qualcosa non va, dimmi a quale Fase ti sei fermato e cosa vedi sullo
schermo — ripartiamo da lì insieme.
