# Appunti pubblicati sul sito

Ogni set di appunti è una pagina HTML statica in questa cartella, elencata in `index.json`.
La scheda **Scuola → Appunti** del gestionale legge `index.json` e mostra le pagine (con il tag 🌐) insieme agli appunti inseriti a mano.

Per aggiungere una pagina: copia il file HTML in `appunti/`, aggiungi una voce a `index.json`
(`titolo, classe, materia, argomento, tipo, data, link`) e aumenta la versione della cache in `sw.js`.
