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

  return { quarterFromText, xlsxCells, parseModello22, mergeModelli, quarterEnd, tipoDaNote, splitOperatore, normName, iso, parse, today, addDays, addMonths, diffDays, nextDate, fmtDate, eur, num, buildICS, remindersText, esc, fold };
});
