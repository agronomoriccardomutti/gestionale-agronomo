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

  return { iso, parse, today, addDays, addMonths, diffDays, nextDate, fmtDate, eur, num, buildICS, remindersText, esc, fold };
});
