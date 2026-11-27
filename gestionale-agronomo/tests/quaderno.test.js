const test = require('node:test'); const assert = require('node:assert');
const Q = require('../quaderno.js'); const PDFLib = require('../vendor/pdf-lib.min.js');
/* dati inventati: nessun dato reale nel repository */
const d = {
  azienda: { ragione: 'Az. Agr. Prova di Mario Rossi', cuaa: 'RSSMRA80A01A182X', piva: '00000000000', indirizzo: 'Via Prova 1', comune: '15000 - Comune', prov: 'AL', titolare: 'Rossi Mario', nascita: '1980-01-01', nascitaComune: 'Alessandria', macchina: 'POMPA', dataAutocert: '2026-01-02', campagna: 2026 },
  campi: [{ id: 'c1', idc: 'Pesche - 2020', tipologia: 'Fruttifero', coltura: 'Pesco', particelle: 'SSM 21/333, SSM 21/185', ha: 1, prodAttesa: 5, asN: 0.4, asP: 0.22, asK: 0.65 }],
  prodotti: [{ id: 'p1', nome: 'Prodotto A', tipo: 'Fitosanitario', sostanza: 'Sostanza', registrazione: '123', unita: 'l', giacIniz: 2 }, { id: 'p2', nome: 'Seme B', tipo: 'Semente / sovescio', unita: 'kg', giacIniz: 0 }],
  acquisti: [{ id: 'a1', data: '2026-03-01', prodotto: 'Prodotto A', quantita: 10, fattura: '1/1' }, { id: 'a2', data: '2026-10-01', prodotto: 'Seme B', quantita: 25, fattura: '9' }],
  trattamenti: [{ id: 't1', data: '2026-03-05', campo: 'Pesche - 2020', prodotto: 'Prodotto A', avversita: 'Bolla', fase: 'BBCH00', doseHa: 1.2, doseHl: 0.24, volume: 5, quantita: 1.2 }],
  semine: [{ id: 's1', data: '2026-10-18', prodotto: 'Seme B', campi: 'Pesche - 2020', ha: 1, quantita: 25, doseHa: 25 }],
  operazioni: [{ id: 'o1', data: '2026-02-01', operazione: 'Potatura', campi: 'Pesche - 2020' }],
};
test('catasto raggruppa e ordina le particelle', () => assert.strictEqual(Q.catasto('SSM 21/333, SSM 21/185, AL 5/166'), 'San Salvatore M.to – Fg. 21 – Part. 185, 333; Alessandria – Fg. 5 – Part. 166'));
test('bilancio di magazzino', () => { const b = Q.bilancio(d, d.prodotti[0]); assert.strictEqual(b.finale, 10.8); assert.strictEqual(b.utilizzato, 1.2); });
test('nessuna segnalazione con dati completi, segnala i mancanti', () => {
  assert.strictEqual(Q.checks(d).length, 0);
  const x = JSON.parse(JSON.stringify(d)); x.trattamenti[0].fase = ''; x.prodotti[0].registrazione = '';
  assert.deepStrictEqual(Q.checks(x).map((c) => c.t), ['m', 'm']);
});
test('genera un PDF valido', async () => { const b = await Q.build(d, PDFLib); assert.strictEqual(Buffer.from(b.slice(0, 5)).toString(), '%PDF-'); const doc = await PDFLib.PDFDocument.load(b); assert.ok(doc.getPageCount() >= 8); });
