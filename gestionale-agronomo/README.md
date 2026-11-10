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

## Backup

`Impostazioni → Esporta backup`. I dati sono in un solo dispositivo: fai il backup ogni tanto, e **prima** di cambiare telefono o browser. Il file si ripristina da `Impostazioni → Ripristina da backup`.

## Struttura

```
index.html  style.css  app.js  lib.js  sw.js  manifest.webmanifest
icons/      tests/lib.test.js    .github/workflows/ci.yml
```

`lib.js` contiene la logica pura (date, ricorrenze, iCalendar) ed è coperta da test. `app.js` descrive tutte le sezioni nell'oggetto `ENT`: per aggiungere un campo o una nuova scheda basta modificare quella definizione.

## Licenza

MIT — vedi `LICENSE`.
