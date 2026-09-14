# FT Giardini · Lavori — come metterla online con i dati condivisi

Servono due cose, che fanno lavori diversi:

| | Cosa fa |
|---|---|
| **Supabase** | Il database: salva i dati di tutti, gestisce accessi e password, invia le modifiche in tempo reale |
| **Netlify** (o Cloudflare Pages / Vercel) | Mette online i file dell'app su un indirizzo https |

Senza Supabase l'app resta in *modalità prova*: ogni telefono ha i suoi dati e non comunica con gli altri.

---

## 1. Crea il progetto Supabase (10 minuti)

1. Vai su **supabase.com** → *Start your project* → accedi (anche con GitHub).
2. **New project**
   - Name: `ft-giardini-lavori`
   - Database password: generane una e **salvala** (non serve all'app, non mandarla a nessuno)
   - Region: **Central EU (Frankfurt)**
3. Aspetta 1-2 minuti che il progetto sia pronto.

## 2. Crea le tabelle

1. Menu a sinistra → **SQL Editor** → **New query**
2. Apri il file `supabase/schema.sql` di questa cartella, copia **tutto** e incollalo
3. Premi **Run**: deve comparire *Success. No rows returned*

## 3. Blocca le iscrizioni libere (importante)

**Authentication** → **Sign In / Providers** (o *Providers*) → **Email** →
disattiva **Allow new users to sign up** → **Save**.

Così nessun estraneo può crearsi un account: gli accessi li create solo voi.

## 4. Crea gli accessi delle 6 persone

**Authentication** → **Users** → **Add user** → **Create new user**, una volta per ognuno:

| Persona | Email da scrivere |
|---|---|
| Nicolas | `nicolas@lavori.ftgiardini.com` |
| Martina | `martina@lavori.ftgiardini.com` |
| Alessandro | `alessandro@lavori.ftgiardini.com` |
| Leonardo | `leonardo@lavori.ftgiardini.com` |
| Manuel | `manuel@lavori.ftgiardini.com` |
| Tomas | `tomas@lavori.ftgiardini.com` |

- **Password: scrivila tutta in MAIUSCOLO**, almeno 6 caratteri (nell'app poi si può scrivere anche in minuscolo).
- Consiglio: **password nuove**, non quelle usate nella versione di prova.
- Spunta **Auto Confirm User**.

Le email non sono caselle vere: servono solo come nome di accesso. Nome, ruolo, colore e "Manuel solo sabato" vengono assegnati in automatico.

## 5. Funzione per gestire le password dall'app (consigliata)

Serve a Nicolas per aggiungere persone, cambiare password o togliere accessi direttamente dall'app.

1. **Edge Functions** → **Deploy a new function** → **Via Editor**
2. Nome: `gestione-utenti` (esattamente così)
3. Cancella il codice di esempio, incolla il contenuto di `supabase/functions/gestione-utenti/index.ts`
4. **Deploy**

## 6. Collega l'app al database

**Project Settings** → **API Keys** (o il pulsante **Connect** in alto) e copia:

- **Project URL** → es. `https://abcdefgh.supabase.co`
- la chiave **publishable** (`sb_publishable_...`) oppure **anon public**

Incollali in `js/config.js`:

```js
export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_...';
```

Questa chiave può stare nell'app: i dati sono protetti dalle regole del database.
**Mai** usare la chiave `service_role` / `secret`.

## 7. Metti online su Netlify

**Metodo semplice (trascina la cartella):**
1. **app.netlify.com** → *Add new site* → **Deploy manually**
2. Trascina **la cartella `APP`** (non tutta la cartella del sito: dentro deve esserci subito `index.html`)
3. Ogni volta che si modifica l'app: *Deploys* → trascina di nuovo la cartella

**Metodo con GitHub (aggiornamenti automatici):**
1. Crea un archivio **privato** su GitHub e carica il contenuto della cartella `APP`
2. Netlify → *Add new site* → *Import an existing project* → GitHub → scegli l'archivio
3. Build command: **vuoto** · Publish directory: **`.`** (o vuoto) → *Deploy*

## 8. Installa sui telefoni

Apri l'indirizzo Netlify (es. `https://ft-lavori.netlify.app`) con **Safari** →
**Condividi** → **Aggiungi alla schermata Home**.

Primo accesso: tocca il tuo nome e scrivi la password.

---

## Da sapere

- **Senza campo in cantiere** l'app funziona lo stesso: le spunte restano sul telefono (in alto compare "Offline") e partono appena torna la connessione. Il **primo** accesso richiede internet.
- **Aggiornamenti in tempo reale**: quando un giardiniere spunta un lavoro, Martina e Nicolas lo vedono in pochi secondi.
- **Permessi controllati dal database**, non solo dall'app:
  - giardiniere: vede tutto, spunta/rimanda/annota solo i lavori assegnati a lui (o senza assegnazione)
  - ufficio (Martina): condomini, contratti, pianificazione, tipi di lavoro
  - titolare (Nicolas): tutto, compresi squadra, password ed eliminazione condomini
- **Piano gratuito Supabase**: il progetto va in pausa dopo 7 giorni senza nessun accesso (con l'uso quotidiano non succede). Non ci sono backup automatici: da **Altro → Scarica backup** una volta a settimana.
- **Password dimenticata**: Nicolas → Squadra → tocca la persona → Nuova password (serve il punto 5). In alternativa da Supabase → Authentication → Users → la persona → *Send password recovery* non funziona (email finte): usa invece i tre puntini → modifica password.
- **Dati della versione di prova** già inseriti su un computer: su quel computer, *prima* di collegare Supabase, Altro → Scarica backup; poi, entrati come Nicolas nella versione online, Altro → Carica backup.
