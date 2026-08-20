# Solco — setup

Segue esattamente i passi del tutorial Cloudflare Workers + D1 che avevi. Qui solo le
aggiunte specifiche di questo progetto.

## 1. Passi 1–4 del tutorial

Repository GitHub, database D1 (chiamalo `solco-db` o come preferisci), struttura cartelle:
tutti i file di questo pacchetto vanno alla radice del repository, `assets/` incluso.

## 2. `wrangler.toml`

Già pronto in questo pacchetto. Devi solo incollare il `database_id` del tuo database D1
al posto di `INCOLLA-QUI-IL-TUO-DATABASE-ID`.

## 3. Schema database

Incolla tutto `schema.sql` nella Console D1 ed eseguilo. Contiene sia le tabelle di
autenticazione sia quelle di Solco (`album`, `wishlist`, `invites`).

## 4. Deploy automatico da GitHub

Come da tutorial: Workers & Pages → Create → Connect to Git → comando build
`npx wrangler deploy`.

## 5. Primo account

Apri il sito da telefono (va aggiunto alla Home, vedi sotto), vai su `/register.html`:
il primo account creato diventa Amministratore in automatico. Da lì, in **Utenti e
inviti** (icona ☰ nella libreria) puoi generare un codice per far entrare le altre
persone — lo aprono su `/register.html?invite=CODICE`.

## 6. Se avevi già installato Solco prima d'ora — migrazione

Questa versione aggiunge profilo (foto e bio) e la vista "Amici" con le collezioni
personali. Serve una colonna in più che `schema.sql` da sola non aggiunge a un database
già esistente (perché `CREATE TABLE IF NOT EXISTS` non tocca le tabelle già create).

Vai su D1 → il tuo database → Console → esegui **solo** questa riga, una volta sola:

```sql
ALTER TABLE users ADD COLUMN bio TEXT;
```

Se per sbaglio la esegui due volte, l'unico effetto è un errore "duplicate column
name" — innocuo, la colonna c'è già.

Da questa versione in poi, ogni persona vede solo i dischi che ha aggiunto lei: la
sezione "Amici" (nuova voce nella barra in basso) mostra gli altri account con la loro
collezione, in sola lettura.

## 7. Discogs (riconoscimento automatico) — facoltativo

Senza questo passaggio l'app funziona comunque: dopo la scansione del codice a barre,
se non trova nulla ti propone di compilare la scheda a mano.

Per attivare il riconoscimento automatico:

1. Crea un account su [discogs.com](https://www.discogs.com) se non ce l'hai già.
2. Vai su **Impostazioni → Sviluppo** e genera un **Personal Access Token**.
3. Da terminale, nella cartella del progetto:
   ```
   npx wrangler secret put DISCOGS_TOKEN
   ```
   e incolla il token quando richiesto.

Due cose da sapere:
- Il **numero di matrice** (quello inciso vicino all'etichetta) non è cercabile in modo
  affidabile via API: nell'app lo inserisci a mano, il codice a barre invece viene letto
  dalla fotocamera in automatico (libreria ZXing, caricata da CDN).
- Il **valore di mercato suggerito** (`/api/valore`) usa l'endpoint dei "price suggestions"
  di Discogs: è pensato per chi vende sul loro marketplace e in alcuni casi può non
  restituire dati. Quando manca, inseriscilo a mano — il campo è sempre modificabile.

## 8. Installazione sul telefono

L'app è pensata *solo* per essere aperta dall'icona sulla schermata Home, non dal
browser. La prima volta:

1. Apri l'indirizzo del tuo Worker da Safari (iPhone) o Chrome (Android).
2. Vedrai una schermata con le istruzioni per installarla — anche `install.html`, se
   qualcuno prova ad aprirla da desktop, oppure da telefono senza averla ancora
   installata.
3. Da lì in poi si apre sempre dall'icona, a schermo intero.

## Cose ereditate dal tutorial, valide anche qui

Le note in fondo al tutorial originale (icone che si cachano, permessi fotocamera su
iPhone che non si ricordano tra un'apertura e l'altra della PWA installata, migrazioni
SQL sempre manuali) si applicano anche a Solco.

## Semplificazioni di questa prima versione (MVP)

Per restare essenziali, alcune cose sono ridotte all'osso e possono essere estese in
seguito, chiedendo alla chat di lavorarci sopra:
- Le copertine sono blocchi di colore, non immagini reali (come nel concept originale).
- Nessun caricamento foto della copertina/etichetta.
- Il grafico "valore nel tempo" è calcolato dalla data di aggiunta alla libreria, non da
  uno storico di rivalutazioni.
- La foto profilo viene ridimensionata a 320×320 nel telefono prima dell'invio e salvata
  come immagine incorporata nel database (non c'è uno storage file separato tipo R2):
  va benissimo per un piccolo gruppo di amici, meno per foto ad alta risoluzione.
- "Amici" mostra tutti gli account con un profilo pubblico all'interno del gruppo — non
  c'è un sistema di richieste di amicizia: chi ha un account può vedere le collezioni
  di tutti gli altri, coerente con l'idea di un'app privata già ristretta a poche persone.
