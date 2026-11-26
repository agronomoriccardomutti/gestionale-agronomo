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
- Tutto si sincronizza (`localOnly` in `config.js` è vuoto): scrivi lì il nome di una scheda per tenerla solo sul dispositivo.

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

## Scuola: più classi, periodi e Obsidian

- **Classi**: pulsante «Crea classi 3°A … 5°B» (crea solo quelle che mancano, con ITAS Leardi / Genio Rurale). Le chip in cima passano da una classe all'altra.
- **Verifiche**: campo Periodo (Trimestre/Pentamestre; se vuoto si deduce dalla data: da settembre a dicembre Trimestre). Nella pagina classe si filtra per periodo.
- **Correzione**: H/DSA per studente, voto finale a menu (es. 6+, 6½, 6/7), «Scrivi su Obsidian» (vault VaultdiRic, cartella wiki/scuola) e «Nota .md».

## Importa verifica

In Scuola → Verifiche (o nella pagina di una classe) il pulsante «📥 Importa verifica» crea una verifica da un blocco di testo: righe `Classe:`, `Verifica:`, `Data:` (AAAA-MM-GG o GG/MM/AAAA), `Periodo:` (Trimestre/Pentamestre), `Voto: 3-9` e una riga per ogni parte con i punti massimi (es. `Vero o falso: 8`).

## Più materie per classe

Le classi 3°A e 3°B hanno Genio Rurale e Industrie agrarie. Ogni verifica ha il campo **Materia** (nel blocco di importazione: riga `Materia: Industrie` o `Materia: Genio Rurale`). Nella pagina classe le chip «Tutte le materie / Genio Rurale / Industrie agrarie» filtrano verifiche e medie; il nome della verifica mostra la materia.

## Scheda operatore: contatti e appunti

Nella scheda azienda (Ispezioni → Aziende) ci sono Email, Telefono fisso e Cellulare (toccando si chiama o si scrive). Il pulsante «📞 Crea appunto da contattare» crea un promemoria con contatto e «ispezione prevista il gg/mm/aaaa» (la data si propone dalla prossima ispezione dell'azienda); gli appunti compaiono nella scheda e in Promemoria.


## Verbali (consiglio di classe e dipartimento)

Scuola → *Docenti* (formato “Cognome Nome”, spunta “Dipartimento Scienze Agrarie” per chi ne fa parte) → *Consigli di classe* (classe + materia + docente: se cambia un docente basta cambiare il nome) → *Verbali*. Nella tua classe spunta “Sono il coordinatore” per avere il pulsante “+ Verbale CdC …”. Nel verbale: presenti/assenti con un tocco, ordine del giorno da modello o incollato, testo per punto, “copia i testi dal verbale precedente” e **Scarica Word (.docx)** con intestazione, elenco docenti, firme. I verbali restano solo sul dispositivo (contengono dati sugli studenti).

## Spese personali

Sezione **Spese**: periodo dal 23 al 22, stipendio, budget settimanale (con quota delle ricorrenti e risparmio da accantonare), spese ricorrenti con tasto “Pagata”, movimenti, categorie. Importa i dati del vecchio “Gestione Spese” da *Importa* (file JSON). Movimenti e ricorrenti restano solo sul dispositivo.

### Previsioni spese
Nella pagina Spese, card «Previsione di fine periodo»: stima di quanto resterà (o mancherà) al 22, uscite variabili attese per categoria (ritmo del periodo + media degli ultimi 3 periodi), ricorrenti in scadenza, stima del periodo successivo e piccoli consigli. Calcolata sul dispositivo: nessun dato finanziario esce dal telefono. Più storico inserisci, più è precisa.

### Mail dei clienti (Gmail)
Opzionale. In Impostazioni › «Mail dei clienti» si incolla l'ID client OAuth Google (istruzioni nella pagina) e si preme «Collega Gmail». Sulle schede dei clienti con email compaiono il pulsante «📬 Mail» (ultime conversazioni) e il numero di mail non lette. Permesso di sola lettura (`gmail.readonly`); il token resta nella sessione del browser (circa 1 ora), le mail non vengono salvate né sincronizzate.

### Scheda pratica
Toccando una pratica si apre la sua scheda: compenso, spese da rimborsare, incassato e residuo; **pagamenti** (acconti, parziali, saldo), **spese** (da rimborsare o a tuo carico), **preventivi** (con «Usa come compenso» sull'accettato), **documenti e cartelle cloud** (link a Drive/iCloud/Dropbox/OneDrive) e «Crea fattura» con il residuo. Lo stato è un menu colorato direttamente sulla lista. Importi di pagamenti, spese e preventivi restano solo sul dispositivo (`localOnly`), come le fatture.

## Fatturazione note spese (Ispezioni → Fatturazione)
Vista come il foglio «Conteggio Note Spese»: nota spese → fattura emessa → 60 giorni → pagamento, con EPAP 4% e bollo. Mostra «SOLLECITARE» dopo 60 giorni e i giorni trascorsi dalle note non ancora fatturate. I dati restano solo sul dispositivo (`noteSpese` in `localOnly`). «Importa dal foglio Excel» legge il file .xlsx con le stesse colonne.

## Versamenti (Professione → Versamenti)
Registro dei pagamenti per tasse e spese professionali (EPAP, assicurazione professionale, imposta sostitutiva, ecc.) con totali per anno, per gruppo (Contributi / Imposte / Altre spese) e per categoria, export CSV e archivio della ricevuta PDF. I dati e i PDF restano solo sul dispositivo (`versamenti` in `localOnly`; i PDF stanno in IndexedDB e non sono nel backup JSON).

«🖨️ PDF unico per il commercialista» (in Versamenti) genera un solo PDF: indice dei versamenti dell'anno scelto con numero di pagina + tutte le ricevute allegate in sequenza (PDF o foto). Usa la libreria MIT [pdf-lib](https://pdf-lib.js.org/) inclusa in `vendor/` (funziona offline).
