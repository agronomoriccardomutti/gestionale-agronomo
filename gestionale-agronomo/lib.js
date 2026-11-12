/* Libreria pura (date, ricorrenze, export iCalendar). Nessuna dipendenza dal DOM, testabile con Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => iso(new Date());

  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function addMonths(s, n) {
    const d = parse(s); const day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return iso(d);
  }
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

  const RECUR = { Mensile: 1, Trimestrale: 3, Semestrale: 6, Annuale: 12 };
  function nextDate(s, rec) { const m = RECUR[rec]; return s && m ? addMonths(s, m) : null; }

  function fmtDate(s) { if (!s) return ''; const [y, m, d] = s.split('-'); return d + '/' + m + '/' + y; }
  function eur(n) { return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(+n || 0); }
  function num(n) { return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(+n || 0); }

  /* ---------- iCalendar ---------- */
  function esc(t) {
    return String(t == null ? '' : t).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  }
  function fold(line) {
    const enc = new TextEncoder(); const out = []; let cur = '', len = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (len + b > 75) { out.push(cur); cur = ' '; len = 1; }
      cur += ch; len += b;
    }
    out.push(cur);
    return out.join('\r\n');
  }
  const compact = (date) => date.replace(/-/g, '');
  function local(d) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
  }
  function stamp() {
    const d = new Date();
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  // Trigger come durata in minuti: positivo = prima dell'inizio
  function trigger(mins) { return mins > 0 ? '-PT' + mins + 'M' : 'PT' + Math.abs(mins) + 'M'; }

  /* events: [{uid,date:'YYYY-MM-DD',time?:'HH:MM',durationMin?,title,description?,location?}] */
  function buildICS(events, opts) {
    opts = opts || {};
    const alarmDays = opts.alarmDays == null ? 1 : +opts.alarmDays;
    const alarmTime = opts.alarmTime || '09:00';
    const defDur = +opts.durationMin || 60;
    const [ah, am] = alarmTime.split(':').map(Number);
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gestionale Agronomo//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + esc(opts.name || 'Gestionale Agronomo')];
    const ds = stamp();
    for (const e of events) {
      L.push('BEGIN:VEVENT', 'UID:' + e.uid, 'DTSTAMP:' + ds);
      let mins;
      if (e.time) {
        const st = parse(e.date); const [h, m] = e.time.split(':').map(Number); st.setHours(h, m, 0, 0);
        const en = new Date(st.getTime() + (e.durationMin || defDur) * 60000);
        L.push('DTSTART:' + local(st), 'DTEND:' + local(en));
        mins = alarmDays > 0 ? alarmDays * 1440 : 30;
      } else {
        L.push('DTSTART;VALUE=DATE:' + compact(e.date), 'DTEND;VALUE=DATE:' + compact(addDays(e.date, 1)));
        mins = alarmDays * 1440 - (ah * 60 + am); // avviso alle alarmTime, alarmDays giorni prima
      }
      L.push('SUMMARY:' + esc(e.title));
      if (e.description) L.push('DESCRIPTION:' + esc(e.description));
      if (e.location) L.push('LOCATION:' + esc(e.location));
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.title), 'TRIGGER:' + trigger(mins), 'END:VALARM', 'END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  /* Elenco testuale, una voce per riga, da incollare in Promemoria */
  function remindersText(events) {
    return events.map((e) => e.title + ' — ' + fmtDate(e.date) + (e.time ? ' ' + e.time : '')).join('\n');
  }


  /* ---------- Lettura .xlsx (senza librerie) e Modello 22 EcoGruppo ---------- */
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function unzip(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('File non valido (non è un .xlsx)');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const out = {}; const dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (!/^xl\/(sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const raw = b.subarray(start, start + csize);
      out[name] = dec.decode(method === 0 ? raw : await inflateRaw(raw));
    }
    return out;
  }
  const unxml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, d) => String.fromCodePoint(parseInt(d, 16))).replace(/&amp;/g, '&');
  const textOf = (xml) => { let o = ''; xml.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, t) => { o += t; return m; }); return unxml(o); };
  /* -> { 'B8': 'testo', 'A8': 1, ... } */
  async function xlsxCells(buf) {
    const files = await unzip(buf);
    const sheetName = files['xl/worksheets/sheet1.xml'] ? 'xl/worksheets/sheet1.xml' : Object.keys(files).filter((k) => k.indexOf('worksheets/') > 0).sort()[0];
    if (!sheetName) throw new Error('Foglio non trovato nel file');
    const ss = []; (files['xl/sharedStrings.xml'] || '').replace(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g, (m, x) => { ss.push(textOf(x)); return m; });
    const cells = {};
    files[sheetName].replace(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (m, attrs, inner) => {
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs); if (!ref || !inner) return m;
      const t = (/\bt="(\w+)"/.exec(attrs) || [])[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      let val = null;
      if (t === 'inlineStr') val = textOf(inner);
      else if (v && t === 's') val = ss[+v[1]];
      else if (v && t === 'str') val = unxml(v[1]);
      else if (v) val = isNaN(+v[1]) ? unxml(v[1]) : +v[1];
      if (val !== null && val !== '') cells[ref[1]] = val;
      return m;
    });
    return cells;
  }
  const titleCase = (s) => (s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s.'(\-])([a-zà-ú])/g, (m, a, c) => a + c.toUpperCase()) : s);
  function splitOperatore(raw) {
    const t = String(raw).replace(/\s+/g, ' ').trim();
    const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(t);
    return m ? { ragione: titleCase(m[1].trim()), comune: m[2].trim() } : { ragione: titleCase(t), comune: '' };
  }
  const clean = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
  /* Estrae operatori e intestazione dal Modello 22 (MD 022) di EcoGruppo. */
  function parseModello22(cells) {
    const keys = Object.keys(cells), rowOf = (k) => +k.replace(/\D/g, ''), col = (k) => k.replace(/\d/g, '');
    const hdr = keys.find((k) => col(k) === 'C' && /Cod\.?\s*Op/i.test(clean(cells[k])) && clean(cells['B' + rowOf(k)]) === 'Operatori');
    if (!hdr) throw new Error('Non sembra un Modello 22 (manca la tabella Operatori)');
    const h0 = rowOf(hdr), out = { trimestre: '', quarter: null, controllore: '', consegna: '', operatori: [] };
    const intest = clean(cells.C5);
    const q = /(\d)\s*['’´`°]?\s*-\s*(\d{2})\b/.exec(intest);
    if (q) { out.quarter = { n: +q[1], y: 2000 + +q[2] }; out.trimestre = q[1] + '° trim. ' + (2000 + +q[2]); }
    out.controllore = clean(cells.H5);
    if (!out.quarter) { const q2 = quarterFromText(intest, 0); if (q2) { out.quarter = q2.y ? q2 : null; out.mesi = true; } }
    for (let r = h0 + 1; r < h0 + 60; r++) {
      const nome = clean(cells['B' + r]), cod = clean(cells['C' + r]);
      if (!nome) { if (clean(cells['A' + r]).indexOf('Tabella 2') === 0) break; continue; }
      if (!cod) continue;
      const sp = splitOperatore(nome);
      out.operatori.push(Object.assign(sp, { codice: cod, tipologia: clean(cells['D' + r]), campionamento: [clean(cells['E' + r]), clean(cells['F' + r])].filter(Boolean).join(' – '), note: clean(cells['G' + r]) }));
    }
    for (const k of keys) { const m = /Luogo e data:\s*\S+\s+(\d{1,2})[_\-\/.](\d{1,2})[_\-\/.](\d{4})/.exec(clean(cells[k])); if (m && !out.consegna) out.consegna = m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]); }
    if (out.mesi && !out.trimestre) { const q3 = quarterFromText(intest, out.consegna ? +out.consegna.slice(0, 4) : 0); if (q3) { out.quarter = q3; out.trimestre = q3.n + '° trim. ' + q3.y; } }
    return out;
  }
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  /* "Ottobre - Dicembre", "ott-dic 2026", "4° trimestre 2026" -> { n, y } (y = anno di riserva se non indicato) */
  function quarterFromText(t, yearHint) {
    t = String(t || '').toLowerCase();
    const y = (/\b(20\d{2})\b/.exec(t) || [])[1];
    let n = null; const mi = MESI.findIndex((m) => t.indexOf(m) >= 0 || new RegExp('\\b' + m.slice(0, 3) + '\\b').test(t));
    if (mi >= 0) n = Math.floor(mi / 3) + 1;
    else { const q = /\b([1-4])\s*[°º^]?\s*(?:trim|tr\b)/.exec(t); if (q) n = +q[1]; }
    return n ? { n, y: y ? +y : (yearHint || new Date().getFullYear()) } : null;
  }
  const quarterStart = (q) => (q ? iso(new Date(q.y, (q.n - 1) * 3, 1)) : '');
  const quarterEnd = (q) => (q ? iso(new Date(q.y, q.n * 3, 0)) : '');
  function tipoDaNote(note) {
    if (/non\s+annunciat/i.test(note)) return 'A sorpresa';
    if (/aggiuntiv/i.test(note)) return 'Supplementare';
    return 'Annuale';
  }
  /* Unisce più Modelli 22 (stesso trimestre, versioni/integrazioni) per codice operatore. */
  function mergeModelli(list) {
    const by = new Map(), res = { trimestre: '', quarter: null, operatori: [] };
    list.forEach((m, i) => {
      if (!res.trimestre && m.trimestre) { res.trimestre = m.trimestre; res.quarter = m.quarter; }
      for (const o of m.operatori) {
        const cur = by.get(o.codice.toUpperCase());
        if (!cur) { const c = Object.assign({}, o, { files: [i + 1] }); by.set(o.codice.toUpperCase(), c); res.operatori.push(c); continue; }
        cur.files.push(i + 1);
        if (o.note && cur.note.indexOf(o.note) < 0) cur.note = (cur.note ? cur.note + ' | ' : '') + o.note;
        if (o.campionamento && !cur.campionamento) cur.campionamento = o.campionamento;
        if (!cur.comune && o.comune) cur.comune = o.comune;
      }
    });
    return res;
  }
  const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9à-ú]/g, '');


  /* ---------- Nota spese ispettori (EcoGruppo): compilazione del modello .xlsx ---------- */
  const TARIFFE = { Basso: 80, Medio: 90, Alto: 110, 'Altro combinato': 40, 'Altro singolo': 70 };
  const KM_EURO = 0.3;
  const r2 = (x) => Math.round(x * 100) / 100;
  function notaCalc(r) {
    const kmTot = (+r.km || 0) + (+r.kmExtra || 0), speseKm = r2(kmTot * KM_EURO), altre = +r.altre || 0;
    const hasImp = r.importo !== undefined && r.importo !== null && r.importo !== '' && isFinite(+r.importo);
    const compenso = hasImp ? +r.importo : (TARIFFE[r.complessita] == null ? null : TARIFFE[r.complessita]);
    return { kmTot, speseKm, altre, compenso, totale: compenso == null ? null : r2(speseKm + altre + compenso) };
  }
  function periodoLabel(dal, al) {
    const M = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
    const a = parse(dal), b = parse(al);
    if (a.getFullYear() === b.getFullYear()) return a.getMonth() === b.getMonth() ? M[a.getMonth()] + ' ' + a.getFullYear() : M[a.getMonth()] + '-' + M[b.getMonth()] + ' ' + a.getFullYear();
    return M[a.getMonth()] + ' ' + a.getFullYear() + '-' + M[b.getMonth()] + ' ' + b.getFullYear();
  }
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  async function unzipAll(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = -1; for (let i = b.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Modello non valido');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = [], dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = b.subarray(start, start + csize);
      out.push({ name, data: method === 0 ? raw.slice() : await inflateRaw(raw) });
    }
    return out;
  }
  function zipStore(files) {
    const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), crc = crc32(f.data), lh = new Uint8Array(30), cv = new DataView(lh.buffer);
      cv.setUint32(0, 0x04034b50, true); cv.setUint16(4, 20, true); cv.setUint32(14, crc, true); cv.setUint32(18, f.data.length, true); cv.setUint32(22, f.data.length, true); cv.setUint16(26, nm.length, true);
      const ch = new Uint8Array(46), dv = new DataView(ch.buffer);
      dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint32(16, crc, true); dv.setUint32(20, f.data.length, true); dv.setUint32(24, f.data.length, true); dv.setUint16(28, nm.length, true); dv.setUint32(42, off, true);
      parts.push(lh, nm, f.data); cd.push(ch, nm); off += 30 + nm.length + f.data.length;
    }
    const cdLen = cd.reduce((a, x) => a + x.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, off, true);
    const all = [...parts, ...cd, end], res = new Uint8Array(all.reduce((a, x) => a + x.length, 0)); let q = 0; for (const x of all) { res.set(x, q); q += x.length; }
    return res;
  }
  const xesc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const serial = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
  /* Compila il modello: data = { periodo, righe: [{ operatore, codice, data, partenza, destinazione, km, kmExtra, altre, complessita }] } (max 22) */
  async function buildNotaSpese(template, data) {
    const files = await unzipAll(template), dec = new TextDecoder(), enc = new TextEncoder();
    const sh = files.find((f) => f.name === 'xl/worksheets/sheet1.xml'); let x = dec.decode(sh.data);
    const righe = (data.righe || []).slice(0, 22);
    const num = (v) => '<v>' + String(+(+v).toFixed(6)) + '</v>';
    const sty = {}; // stili dalla riga 5 (riga compilata)
    const row5 = /<row r="5"[\s\S]*?<\/row>/.exec(x)[0]; row5.replace(/<c r="([A-Z]+)5"(?: s="(\d+)")?/g, (m, c, st) => { sty[c] = st; return m; });
    let tKm = 0, tSp = 0, tAl = 0, tCo = 0, tTo = 0;
    for (let i = 0; i < 22; i++) {
      const r = 5 + i, d = righe[i], has = !!d;
      x = x.replace(new RegExp('<row r="' + r + '"[\\s\\S]*?</row>'), (row) => row.replace(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (m, col, attrs, inner) => {
        const own = (/\ss="(\d+)"/.exec(attrs) || [])[1], s = has && sty[col] ? sty[col] : own, S = s ? ' s="' + s + '"' : '', ref = col + r;
        const txt = (v) => (v === '' || v == null ? '<c r="' + ref + '"' + S + '/>' : '<c r="' + ref + '"' + S + ' t="inlineStr"><is><t xml:space="preserve">' + xesc(v) + '</t></is></c>');
        const nn = (v) => (v === '' || v == null ? '<c r="' + ref + '"' + S + '/>' : '<c r="' + ref + '"' + S + '>' + num(v) + '</c>');
        const f = (/<f[^>]*?(?:\/>|>[\s\S]*?<\/f>)/.exec(inner || '') || [''])[0];
        const c = has ? notaCalc(d) : null;
        switch (col) {
          case 'A': return nn(has ? i + 1 : '');
          case 'B': return txt(has ? d.operatore : '');
          case 'C': return txt(has ? d.codice : '');
          case 'D': return has && d.data ? '<c r="' + ref + '"' + S + '>' + '<v>' + serial(d.data) + '</v></c>' : '<c r="' + ref + '"' + S + '/>';
          case 'E': return txt(has ? d.partenza : '');
          case 'F': return txt(has ? d.destinazione : '');
          case 'G': return has ? nn(+d.km || 0) : nn('');
          case 'H': return has ? nn(+d.kmExtra || 0) : nn('');
          case 'K': return has ? nn(+d.altre || 0) : nn('');
          case 'L': return txt(has ? d.complessita : '');
          case 'I': return '<c r="' + ref + '"' + S + '>' + f + num(has ? c.kmTot : 0) + '</c>';
          case 'J': return '<c r="' + ref + '"' + S + '>' + f + num(has ? c.speseKm : 0) + '</c>';
          case 'M': { const fixed = has && c.compenso != null && TARIFFE[d.complessita] !== c.compenso; // importo diverso dalla tariffa: valore fisso al posto della formula
            return has && c.compenso != null ? '<c r="' + ref + '"' + S + '>' + (fixed ? '' : f) + num(c.compenso) + '</c>' : '<c r="' + ref + '"' + S + ' t="str">' + f + '<v xml:space="preserve"> </v></c>'; }
          case 'N': { const fixed = has && c.totale != null && TARIFFE[d.complessita] !== c.compenso;
            return has && c.totale != null ? '<c r="' + ref + '"' + S + '>' + (fixed ? '' : f) + num(c.totale) + '</c>' : '<c r="' + ref + '"' + S + ' t="str">' + f + '<v></v></c>'; }
          default: return m;
        }
      }));
      if (has) { const c = notaCalc(d); tKm += c.kmTot; tSp += c.speseKm; tAl += c.altre; tCo += c.compenso || 0; tTo += c.totale || 0; }
    }
    const setTot = (col, v) => { x = x.replace(new RegExp('(<c r="' + col + '27"[^>]*>(?:<f>[^<]*</f>))<v>[^<]*</v>'), '$1' + num(v)); };
    setTot('I', tKm); setTot('J', tSp); setTot('K', tAl); setTot('M', tCo); setTot('N', tTo);
    // periodo (I2): stringa inline nello stile della cella
    x = x.replace(/<c r="I2"([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/, (m, a) => '<c r="I2"' + a.replace(/\s+t="\w+"/, '').replace(/\/$/, '') + ' t="inlineStr"><is><t xml:space="preserve">' + xesc(data.periodo || '') + '</t></is></c>');
    sh.data = enc.encode(x);
    const wb = files.find((f) => f.name === 'xl/workbook.xml');
    wb.data = enc.encode(dec.decode(wb.data).replace(/<calcPr[^>]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>'));
    return zipStore(files);
  }

  return { quarterStart, TARIFFE, KM_EURO, notaCalc, periodoLabel, unzipAll, zipStore, buildNotaSpese, quarterFromText, xlsxCells, parseModello22, mergeModelli, quarterEnd, tipoDaNote, splitOperatore, normName, iso, parse, today, addDays, addMonths, diffDays, nextDate, fmtDate, eur, num, buildICS, remindersText, esc, fold };
});
