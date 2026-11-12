const test = require('node:test'); const assert = require('node:assert');
const zlib = require('node:zlib'); const L = require('../lib.js');

/* mini-zip (deflate) per costruire un .xlsx finto con nomi inventati */
function crc32(b) { let c, crc = ~0; for (const x of b) { c = (crc ^ x) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function zip(files) {
  const parts = [], cd = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), def = zlib.deflateRawSync(raw), nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(raw), 14);
    lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(raw), 16);
    ch.writeUInt32LE(def.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, def); cd.push(ch, nm); off += 30 + nm.length + def.length;
  }
  const cdb = Buffer.concat(cd), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(cd.length / 2, 8); end.writeUInt16LE(cd.length / 2, 10);
  end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cdb, end]));
}
function xlsx(strings, cells) {
  const ss = '<sst>' + strings.map((t) => '<si><t xml:space="preserve">' + t.replace(/&/g, '&amp;') + '</t></si>').join('') + '</sst>';
  const sh = '<worksheet><sheetData>' + cells.map(([r, v]) => typeof v === 'number' ? `<c r="${r}"><v>${v}</v></c>` : `<c r="${r}" t="s"><v>${strings.indexOf(v)}</v></c>`).join('') + '</sheetData></worksheet>';
  return zip({ 'xl/sharedStrings.xml': ss, 'xl/worksheets/sheet1.xml': sh });
}
const S = ["RICCARDO ROSSI  2'-26", 'EC9A', 'N.ro', 'Operatori', 'Cod. Op.', 'Rossi Mario (Alba)', 'AAA1', 'AB', 'Non Annunciata', 'BIANCHI LUISA', 'BBB2',
  'Tabella 2 - Non conformità Grave/Critica', 'Luogo e data: Torino 23_03-2026', 'si', 'Terreno', 'Rossi & Figli (Asti)'];
const cells = [['C5', S[0]], ['H5', S[1]], ['A7', S[2]], ['B7', S[3]], ['C7', S[4]], ['A8', 1], ['B8', S[5]], ['C8', S[6]], ['D8', S[7]], ['G8', S[8]],
  ['A9', 2], ['B9', S[9]], ['C9', S[10]], ['D9', S[7]], ['E9', S[13]], ['F9', S[14]], ['A10', 3], ['B10', S[15]], ['C10', 'CCC3'.length && S[6]], ['A12', S[11]], ['A14', S[12]]];

test('xlsxCells legge celle e stringhe condivise', async () => {
  const c = await L.xlsxCells(xlsx(S, cells));
  assert.strictEqual(c.B8, 'Rossi Mario (Alba)'); assert.strictEqual(c.A8, 1);
});
test('parseModello22: trimestre, operatori, tipo ispezione, nomi', async () => {
  const m = L.parseModello22(await L.xlsxCells(xlsx(S, cells)));
  assert.strictEqual(m.trimestre, '2° trim. 2026'); assert.deepStrictEqual(m.quarter, { n: 2, y: 2026 });
  assert.strictEqual(m.controllore, 'EC9A'); assert.strictEqual(m.consegna, '2026-03-23');
  assert.strictEqual(m.operatori.length, 3);
  assert.deepStrictEqual([m.operatori[0].ragione, m.operatori[0].comune, m.operatori[0].codice], ['Rossi Mario', 'Alba', 'AAA1']);
  assert.strictEqual(L.tipoDaNote(m.operatori[0].note), 'A sorpresa');
  assert.strictEqual(m.operatori[1].ragione, 'Bianchi Luisa'); assert.strictEqual(m.operatori[1].campionamento, 'si – Terreno');
  assert.strictEqual(m.operatori[2].ragione, 'Rossi & Figli');
});
test('mergeModelli unisce per codice e quarterEnd', () => {
  const a = { trimestre: 'T', quarter: { n: 2, y: 2026 }, operatori: [{ codice: 'X1', ragione: 'A', comune: '', note: 'uno', campionamento: '' }] };
  const b = { trimestre: 'T', quarter: { n: 2, y: 2026 }, operatori: [{ codice: 'x1', ragione: 'A', comune: 'Asti', note: 'due', campionamento: 'si' }, { codice: 'Y2', ragione: 'B', comune: '', note: '', campionamento: '' }] };
  const r = L.mergeModelli([a, b]);
  assert.strictEqual(r.operatori.length, 2); assert.strictEqual(r.operatori[0].note, 'uno | due'); assert.strictEqual(r.operatori[0].comune, 'Asti');
  assert.strictEqual(L.quarterEnd({ n: 2, y: 2026 }), '2026-06-30'); assert.strictEqual(L.quarterEnd({ n: 4, y: 2026 }), '2026-12-31');
});
test('file non valido', async () => { await assert.rejects(() => L.xlsxCells(new Uint8Array(50)), /xlsx/); });

test('intestazione con mesi ("Ottobre - Dicembre") invece di 4\'-26', async () => {
  const S2 = S.slice(); S2[0] = 'RICCARDO ROSSI  Ottobre - Dicembre';
  const c2 = cells.map(([r, v]) => [r, v === S[0] ? S2[0] : v]);
  const m = L.parseModello22(await L.xlsxCells(xlsx(S2, c2)));
  assert.strictEqual(m.quarter.n, 4); assert.strictEqual(m.trimestre, '4° trim. 2026');
  assert.strictEqual(L.quarterEnd(m.quarter), '2026-12-31');
});
