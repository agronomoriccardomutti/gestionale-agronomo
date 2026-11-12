# Gestionale Agronomo

Web app personale (PWA) per tenere in un solo posto tutto il lavoro: **campagna**, **casa e cascina**, **ispezioni biologiche**, **libera professione** e **scuola**. Funziona nel browser, si installa su telefono e computer, funziona anche **offline** in campagna.

- Nessun server, nessun account, nessuna dipendenza: HTML + CSS + JavaScript.
- **I dati restano solo sul tuo dispositivo** (archivio del browser). Su GitHub va soltanto il codice.
- Scadenze esportabili nel **Calendario Apple** (con avvisi) e in **Promemoria**.

## Cosa contiene

| Sezione | Contenuto |
|---|---|
| **Oggi** | Scadute / oggi / 7 giorni / 30 giorni da tutte le sezioni, esportazione in Calendario, promemoria rapido |
| **Campagna** | Quaderno di campagna: trattamenti (con fine carenza calcolata), concimazioni, raccolte, parcelle, magazzino prodotti con scadenze |
| **Casa e cascina** | Manutenzioni con ricorrenza (mensile … annuale): “Fatto” sposta la scadenza al ciclo successivo |
| **Ispezioni** | Aziende e ispezioni (programmata → eseguita → verbale → chiusa), scadenza verbale, km e compensi dell'anno |
| **Professione** | Clienti, pratiche (PAC, PSR, catasto, estimo, PAN, verde, sicurezza…), fatture con controllo della soglia del regime forfettario (per cassa) |
| **Scuola** | Classi e impegni (consigli, scrutini, collegi, verifiche) con orario |
| **Promemoria** | Cose da ricordare con data, ora e priorità |
| **Impostazioni** | Anticipo degli avvisi, backup/ripristino JSON, dati di esempio |

## Calendario e Promemoria Apple

Un sito statico non può scrivere direttamente nelle app Apple, quindi si usa lo standard iCalendar:

1. **Calendario**: `Oggi → Esporta in Calendario` (o il pulsante `📅` su ogni scheda) genera un file `.ics`. Su iPhone/Mac si apre e propone di aggiungere gli eventi, **con avviso** (giorni e ora impostabili). Ogni evento ha un identificativo stabile: reimportandolo dopo una modifica viene aggiornato, non duplicato.
2. **Promemoria**: `Oggi → Elenco per Promemoria` mostra un testo con una scadenza per riga da copiare e incollare nell'app Promemoria (di norma crea una voce per riga). L'importazione diretta di `.ics` in Promemoria non è affidabile, per questo si passa dal testo.

Limite onesto: la sincronizzazione è a comando (esporti quando vuoi), non automatica in background.

## Provarla in locale

```bash
python3 -m http.server 8080     # oppure: npm start
# apri http://localhost:8080
npm test                        # test della libreria date/iCalendar (Node ≥ 18)
```

## Pubblicare su GitHub Pages

1. Crea un repository su GitHub (con piano gratuito deve essere **pubblico**: va bene, i tuoi dati non sono nel repository).
2. Dalla cartella del progetto:
   ```bash
   git init && git add . && git commit -m "Primo commit"
   git branch -M main
   git remote add origin https://github.com/TUO-UTENTE/gestionale-agronomo.git
   git push -u origin main
   ```
3. Su GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)`**.
4. Dopo circa un minuto l'app è su `https://TUO-UTENTE.github.io/gestionale-agronomo/`.
5. Su iPhone: Safari → Condividi → **Aggiungi a Home**. Installata così, iOS non cancella i dati dopo qualche giorno di inattività, come invece può fare per i normali siti.

Quando pubblichi una modifica ai file, cambia il numero in `CACHE` dentro `sw.js` (es. `gestionale-v2`) per forzare l'aggiornamento sui dispositivi.

## Sincronizzazione tra dispositivi (facoltativa)

Con un progetto gratuito [Supabase](https://supabase.com) i dati si allineano da soli tra Mac e iPhone. L'app resta usabile offline: le modifiche partono appena torna la rete.

1. Crea un progetto Supabase (regione europea) e, nel **SQL Editor**, esegui il contenuto di `supabase/setup.sql`.
2. In **Authentication → Users** aggiungi il tuo utente (email + password, “Auto confirm”). Poi in **Authentication → Sign In / Providers** disattiva le nuove registrazioni, così solo tu puoi entrare.
3. In **Project Settings → API** copia *Project URL* e la chiave *anon / publishable* dentro `config.js`.
4. Nell'app: **Impostazioni → Sincronizzazione → Accedi**. Poi l'icona ☁️ in alto mostra lo stato.

Regole: vince la modifica più recente; le cancellazioni si propagano. Le schede elencate in `localOnly` (di default **le fatture**) non vengono mai inviate online. L'indirizzo e la chiave `anon` sono pubblici per progetto: i dati sono protetti dall'accesso con password e dalle regole di sicurezza della tabella.

## Backup

`Impostazioni → Esporta backup`. I dati sono in un solo dispositivo: fai il backup ogni tanto, e **prima** di cambiare telefono o browser. Il file si ripristina da `Impostazioni → Ripristina da backup`.

## Struttura

```
index.html  style.css  app.js  lib.js  sw.js  manifest.webmanifest
config.js   supabase/setup.sql
icons/      tests/lib.test.js    .github/workflows/ci.yml
```

`lib.js` contiene la logica pura (date, ricorrenze, iCalendar) ed è coperta da test. `app.js` descrive tutte le sezioni nell'oggetto `ENT`: per aggiungere un campo o una nuova scheda basta modificare quella definizione.

## Licenza

MIT — vedi `LICENSE`.

## Scuola: classi, verifiche e voti

- **Classi** → pulsante *Studenti e voti*: incolla l'elenco (uno per riga), segna H/DSA, vedi la tabella voti e la media.
- **Verifiche**: crea una verifica per classe con le parti e i punti massimi e l'intervallo dei voti (default 3–9).
- **Correggi**: inserisci i punti per parte; voto ipotetico = voto min + punti ÷ totale × (voto max − voto min). Il voto finale facoltativo prevale. Presente/assente con data di recupero, statistiche e *Copia risultati* (TSV).
- Studenti e valutazioni restano **solo sul dispositivo** (`localOnly` in `config.js`); per spostarli usa il backup in Impostazioni.

## Ispezioni: importa il Modello 22 (EcoGruppo)

In **Ispezioni** premi *Importa Modello 22* e scegli uno o più file `.xlsx` (versioni e integrazioni dello stesso trimestre). L'app unisce gli operatori per codice, crea i clienti nuovi (codice e tipologia compresi) e un'ispezione *Programmata* per ciascuno. Il tipo viene ricavato dalle note: "Non annunciata" → A sorpresa, "Aggiuntiva" → Supplementare, altrimenti Annuale. Prima di confermare puoi togliere la spunta a chi non vuoi importare. Rilanciando l'importazione non si creano doppioni (stessa azienda e stesso trimestre).

### Piano trimestre

*Importa Modello 22* ora carica le aziende nel **Piano trimestre** (Ispezioni → Piano trimestre) senza creare ispezioni. Lì spunti le aziende da ispezionare: la spunta crea l'ispezione *Programmata*, togliendola la elimina (se non è già stata eseguita). Puoi cambiare tipo e data per ciascuna, usare *Spunta tutte / Togli tutte* e aggiungere a mano un'azienda già in archivio con *+ Azienda*.

### Nota spese ispettori

In **Ispezioni → Nota spese** scegli il periodo: compaiono le ispezioni eseguite con partenza, destinazione, km, km extra, altre spese e complessità (il compenso si calcola: Basso 80 · Medio 90 · Alto 110 · Altro combinato 40 · Altro singolo 70; km a 0,30 €). *Scarica Excel* compila il modello EcoGruppo (`nota-template.js`, vuoto) con le formule originali. Il luogo di partenza predefinito si cambia in Impostazioni.

## Calendario e Promemoria Apple

**Calendario (automatico).** Una sola volta, in Supabase → SQL Editor, incolla ed esegui `supabase/calendario.sql`. Poi in app: Impostazioni → *Calendario Apple* → *Attiva abbonamento* → *Abbonati in Calendario*. L'app pubblica a ogni sincronizzazione un file `.ics` con le scadenze aperte (esclusi i dati solo locali, come le fatture) e Calendario lo rilegge da solo.
Il link contiene il tuo id utente (impossibile da indovinare) ma è leggibile da chi lo conosce: non condividerlo.

**Promemoria.** iOS non permette a una pagina web di scrivere direttamente nei Promemoria. Il pulsante *Invia a Promemoria* (Oggi) passa l'elenco a un Comando Rapido "Scadenze in Promemoria" che crea un promemoria per ogni riga (istruzioni nella finestra, un minuto una sola volta). In alternativa *Condividi* o *Copia*.


## Ispezioni: periodi, Modello 22, schede azienda

- **Periodi**: tabella dei trimestri con Totale, Totale ispezioni, Totale rimborso e 20%. Clic su una riga per aprire il periodo.
- **Importa Modello 22**: carica uno o più .xlsx, sceglie/crea il periodo e porta le aziende nel periodo (nuovi clienti creati in automatico). Le ispezioni nascono solo quando si spunta l'azienda.
- **Pagina periodo**: spunta le aziende da ispezionare; per ognuna Organizzazione (Programmata/Svolta/Verbale da consegnare/Chiusa), Data, Pagamento, Km, Autostrada, Complessità e Importo. Sotto: 20% del Totale, EPAP 4% (se attivato), Da accantonare (= somma rimborso km). Scarica la Nota spese Excel con le ispezioni non più "Programmata".
- **Scheda azienda**: dati, ispezioni collegate e Modello 44.
