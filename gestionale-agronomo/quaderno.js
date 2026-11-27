/* Quaderno di campagna: controlli e PDF. Funzioni pure (nessun accesso al DOM né ai dati salvati): ricevono un oggetto
   { azienda, campi, prodotti, acquisti, trattamenti, semine, operazioni } e, per il PDF, la libreria pdf-lib. Testabile con Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Quaderno = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const fd = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return +d + ' ' + MESI[+m - 1] + ' ' + y; };
  const fdn = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return d + '/' + m + '/' + y; };
  const nf = {};
  const n = (v, dec = 2) => { const k = dec; nf[k] = nf[k] || new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }); return nf[k].format(+v || 0); };
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  const num = (v) => (has(v) && !isNaN(+v) ? +v : null);
  const r2 = (x) => Math.round((+x || 0) * 100) / 100;
  const COMUNI = { SSM: 'San Salvatore M.to', AL: 'Alessandria' };
  const byDate = (a, b) => String(a.data || '').localeCompare(String(b.data || ''));
  const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });

  /* "SSM 21/185, SSM 21/333" -> "San Salvatore M.to – Fg. 21 – Part. 185, 333" */
  function catasto(txt) {
    const g = {};
    for (const tok of String(txt || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
      const m = tok.match(/^([A-Za-z]+)\s+(\d+)\s*\/\s*(\d+)$/);
      if (!m) { (g['?'] = g['?'] || { txt: tok, p: [] }); continue; }
      const k = m[1].toUpperCase() + '|' + m[2]; (g[k] = g[k] || { c: COMUNI[m[1].toUpperCase()] || m[1], f: m[2], p: [] }).p.push(+m[3]);
    }
    return Object.values(g).map((x) => (x.txt ? x.txt : x.c + ' – Fg. ' + x.f + ' – Part. ' + x.p.sort((a, b) => a - b).join(', '))).join('; ');
  }
  const regTxt = (p) => (has(p.registrazione) ? p.registrazione + (p.regData ? ' del ' + fdn(p.regData) : '') : '');
  const campiDi = (txt) => String(txt || '').split(',').map((x) => x.trim()).filter(Boolean);
  const fito = (d) => (d.prodotti || []).filter((p) => (p.tipo || 'Fitosanitario') === 'Fitosanitario').sort((a, b) => collator.compare(a.nome, b.nome));
  const sem = (d) => (d.prodotti || []).filter((p) => p.tipo && p.tipo !== 'Fitosanitario').sort((a, b) => collator.compare(a.nome, b.nome));
  const acqDi = (d, p) => (d.acquisti || []).filter((a) => a.prodotto === p.nome).sort(byDate);

  /* bilancio di magazzino di un prodotto: giacenza iniziale + acquisti - utilizzi */
  function bilancio(d, p) {
    const acq = acqDi(d, p), acquistato = r2(acq.reduce((t, a) => t + (+a.quantita || 0), 0));
    const isF = (p.tipo || 'Fitosanitario') === 'Fitosanitario';
    const usi = isF ? (d.trattamenti || []).filter((t) => t.prodotto === p.nome) : (d.semine || []).filter((s) => s.prodotto === p.nome);
    const utilizzato = r2(usi.reduce((t, x) => t + (+x.quantita || 0), 0));
    return { acq, acquistato, usi, utilizzato, iniziale: +p.giacIniz || 0, finale: r2((+p.giacIniz || 0) + acquistato - utilizzato) };
  }

  /* voci "da completare" (m) e "da verificare" (v) */
  function checks(d) {
    const out = [], m = (doc, voce, azione) => out.push({ t: 'm', doc, voce, azione }), v = (doc, voce, azione) => out.push({ t: 'v', doc, voce, azione });
    const a = d.azienda || {};
    [['ragione', 'Ragione sociale'], ['cuaa', 'CUAA'], ['piva', 'Partita IVA'], ['indirizzo', 'Indirizzo sede'], ['comune', 'Comune sede'], ['prov', 'Provincia'], ['titolare', 'Cognome e nome del titolare'], ['nascita', 'Data di nascita'], ['nascitaComune', 'Comune di nascita']]
      .forEach(([k, l]) => { if (!has(a[k])) m('Anagrafica', l, 'Compilare in Campagna › Quaderno 2026 › Dati azienda'); });
    if (!has(a.macchina)) m('Autocertificazione', 'Macchina irroratrice', 'Indicare la macchina nei dati azienda');
    const campi = d.campi || [];
    if (!campi.length) m('Campi', 'Nessun campo registrato', 'Importare o inserire i campi');
    for (const c of campi) {
      if (!has(c.particelle)) m('Campi', c.idc + ': foglio e particelle', 'Indicare le particelle catastali');
      if (!(+c.ha > 0)) m('Campi', c.idc + ': superficie', 'Indicare la superficie in ettari');
      if (has(c.verifica)) v('Campi', c.idc, c.verifica);
      else if (c.tipologia === 'Fruttifero' && +c.prodAttesa > 0 && ['asN', 'asP', 'asK'].some((k) => !(+c[k] > 0))) v('Stima asporti', c.idc, 'Asporti unitari N / P2O5 / K2O mancanti');
    }
    for (const p of fito(d)) {
      if (!has(p.registrazione)) m('Magazzino', p.nome + ': numero di registrazione', 'Riportare il numero dall\'etichetta');
      if (!has(p.sostanza)) m('Magazzino', p.nome + ': sostanza attiva', 'Riportare la sostanza attiva');
      const b = bilancio(d, p); if (b.finale < -0.005) v('Magazzino', p.nome, 'Giacenza finale negativa (' + n(b.finale) + ' ' + (p.unita || '') + '): controllare acquisti e giacenza iniziale');
    }
    for (const p of sem(d)) { const b = bilancio(d, p); if (b.finale < -0.005) v('Fertilizzanti', p.nome, 'Giacenza finale negativa (' + n(b.finale) + ' ' + (p.unita || '') + ')'); }
    const nomi = new Set((d.prodotti || []).map((p) => p.nome)), idc = new Set(campi.map((c) => c.idc));
    for (const t of d.trattamenti || []) {
      const w = (t.prodotto || '?') + ' del ' + fdn(t.data) + ' – ' + (t.campo || '?');
      if (!nomi.has(t.prodotto)) m('Trattamenti', w, 'Prodotto non presente in magazzino');
      if (!idc.has(t.campo)) m('Trattamenti', w, 'Campo non presente nell\'elenco campi');
      if (!has(t.avversita)) m('Trattamenti', w, 'Indicare l\'avversità');
      if (!has(t.fase)) m('Trattamenti', w, 'Indicare la fase fenologica');
      if (!(+t.doseHa > 0)) m('Trattamenti', w, 'Indicare la dose per ettaro');
      if (!(+t.quantita > 0)) m('Trattamenti', w, 'Indicare la quantità usata');
      const c = campi.find((x) => x.idc === t.campo), p = (d.prodotti || []).find((x) => x.nome === t.prodotto);
      if (c && p && +p.carenza > 0 && c.racc && t.data) { const gg = Math.round((new Date(c.racc) - new Date(t.data)) / 864e5); if (gg < +p.carenza) v('Trattamenti', w, 'Carenza ' + p.carenza + ' gg: raccolta prevista dopo soli ' + gg + ' giorni'); }
    }
    for (const x of d.acquisti || []) if (!has(x.fattura)) m('Acquisti', (x.prodotto || '?') + ' del ' + fdn(x.data), 'Indicare il numero di fattura');
    for (const s of d.semine || []) if (!(+s.quantita > 0)) m('Semine', (s.prodotto || '?') + ' del ' + fdn(s.data), 'Indicare la quantità seminata');
    return out;
  }

  /* ---------- PDF ---------- */
  async function build(d, PDFLib) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdf = await PDFDocument.create();
    const F = await pdf.embedFont(StandardFonts.Helvetica), FB = await pdf.embedFont(StandardFonts.HelveticaBold), FI = await pdf.embedFont(StandardFonts.HelveticaOblique);
    const G = rgb(0.18, 0.29, 0.23), HEAD = rgb(0.89, 0.93, 0.9), ALT = rgb(0.965, 0.975, 0.968), LINE = rgb(0.78, 0.83, 0.8), YEL = rgb(1, 0.94, 0.5), GREY = rgb(0.4, 0.4, 0.4), TXT = rgb(0.1, 0.1, 0.1);
    const san = (t) => String(t == null ? '' : t).replace(/₂/g, '2').replace(/₅/g, '5').replace(/⚠/g, '(!)').replace(/…/g, '...').replace(/[^\x20-\x7e -ÿ€–—’‘“”]/g, '?');
    const az = d.azienda || {}, anno = az.campagna || d.campagna || 2026, M = 40;
    const testata = (az.ragione ? az.ragione.split(' di ')[0] : 'Azienda agricola') + ' · CUAA ' + (az.cuaa || '—');
    let pg, W, H, y, cur, nPag = 0;
    const tw = (s, f, z) => f.widthOfTextAtSize(san(s), z);
    const T = (s, x, yy, z = 9, f = F, c = TXT) => pg.drawText(san(s), { x, y: yy, size: z, font: f, color: c });
    const TR = (s, xr, yy, z = 9, f = F, c = TXT) => T(s, xr - tw(s, f, z), yy, z, f, c);
    const TC = (s, xc, yy, z = 9, f = F, c = TXT) => T(s, xc - tw(s, f, z) / 2, yy, z, f, c);
    const wrap = (s, f, z, w) => {
      const out = [];
      for (const par of san(s).split('\n')) {
        let line = '';
        for (let word of par.split(/\s+/)) {
          if (!word) continue;
          let cand = line ? line + ' ' + word : word;
          if (f.widthOfTextAtSize(cand, z) <= w) { line = cand; continue; }
          if (line) out.push(line);
          while (f.widthOfTextAtSize(word, z) > w) { let k = word.length - 1; while (k > 1 && f.widthOfTextAtSize(word.slice(0, k), z) > w) k--; out.push(word.slice(0, k)); word = word.slice(k); }
          line = word;
        }
        out.push(line);
      }
      return out;
    };
    function page(land, titolo, foot) {
      W = land ? 842 : 595; H = land ? 595 : 842; pg = pdf.addPage([W, H]); nPag++; cur = { land, titolo, foot };
      pg.drawRectangle({ x: 0, y: H - 11, width: W, height: 11, color: G });
      T(titolo, M, H - 33, 9, FB, G); TR(testata, W - M, H - 33, 8, F, GREY);
      pg.drawLine({ start: { x: M, y: H - 40 }, end: { x: W - M, y: H - 40 }, thickness: 0.6, color: LINE });
      pg.drawLine({ start: { x: M, y: 34 }, end: { x: W - M, y: 34 }, thickness: 0.5, color: LINE });
      T(foot || 'Quaderno di Campagna ' + anno, M, 22, 7.5, F, GREY); TR('Pagina ' + nPag, W - M, 22, 7.5, F, GREY);
      y = H - 66;
    }
    const ensure = (hh) => { if (y - hh < 48) page(cur.land, cur.titolo, cur.foot); };
    const heading = (s) => { ensure(34); y -= 6; pg.drawRectangle({ x: M, y: y - 3, width: 3, height: 13, color: G }); T(s, M + 9, y, 11, FB, G); y -= 20; };
    const title = (s, sub) => { T(s, M, y, 17, FB, G); y -= 18; if (sub) { T(sub, M, y, 9.5, F, GREY); y -= 16; } y -= 4; };

    /* tabella con intestazione ripetuta; celle: stringa o { t, miss } */
    function table(cols, rows, o = {}) {
      const z = o.size || 8.5, pad = 4, LH = z + 2.6;
      const head = () => {
        const lines = cols.map((c) => wrap(c.h, FB, 7.5, c.w - 2 * pad)), hh = Math.max(...lines.map((l) => l.length)) * 9.5 + 8;
        ensure(hh + 2 * LH); pg.drawRectangle({ x: M, y: y - hh + 2, width: cols.reduce((t, c) => t + c.w, 0), height: hh, color: HEAD });
        let x = M; cols.forEach((c, i) => { lines[i].forEach((ln, j) => (c.al === 'r' ? TR : c.al === 'c' ? TC : T)(ln, c.al === 'r' ? x + c.w - pad : c.al === 'c' ? x + c.w / 2 : x + pad, y - 10 - j * 9.5, 7.5, FB, G)); x += c.w; });
        y -= hh;
      };
      head();
      rows.forEach((row, ri) => {
        const cells = row.cells || row, bold = row.bold;
        const prep = cells.map((cell, i) => { const t = cell && typeof cell === 'object' ? cell.t : cell; return { lines: wrap(has(t) ? t : '', bold ? FB : F, z, cols[i].w - 2 * pad), miss: cell && cell.miss }; });
        const rh = Math.max(1, ...prep.map((p) => p.lines.length)) * LH + 6;
        if (y - rh < 48) { page(cur.land, cur.titolo, cur.foot); head(); }
        if (row.total) pg.drawLine({ start: { x: M, y: y + 1 }, end: { x: M + cols.reduce((t, c) => t + c.w, 0), y: y + 1 }, thickness: 0.9, color: G });
        else if (ri % 2) pg.drawRectangle({ x: M, y: y - rh + 2, width: cols.reduce((t, c) => t + c.w, 0), height: rh, color: ALT });
        let x = M;
        prep.forEach((p, i) => {
          if (p.miss) pg.drawRectangle({ x: x + 1, y: y - rh + 3, width: cols[i].w - 2, height: rh - 2, color: YEL });
          p.lines.forEach((ln, j) => (cols[i].al === 'r' ? TR : cols[i].al === 'c' ? TC : T)(ln, cols[i].al === 'r' ? x + cols[i].w - pad : cols[i].al === 'c' ? x + cols[i].w / 2 : x + pad, y - 4 - z - j * LH + 1, z, bold ? FB : F));
          x += cols[i].w;
        });
        y -= rh;
      });
      pg.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + cols.reduce((t, c) => t + c.w, 0), y: y + 2 }, thickness: 0.5, color: LINE });
      y -= 4;
    }
    /* riquadro etichetta/valore (a una o più colonne) */
    function kv(items, o = {}) {
      const per = o.cols || 1, wTot = (W - 2 * M), cw = wTot / per, lw = o.lw || (per > 1 ? 112 : 170), z = 9;
      for (let i = 0; i < items.length; i += per) {
        const rowItems = items.slice(i, i + per);
        const prep = rowItems.map((it) => ({ lab: wrap(it[0], FB, 6.8, lw - 14), val: wrap(has(it[1]) ? it[1] : '—', it[3] ? FB : F, z, cw - lw - 12), miss: it[2] }));
        const rh = Math.max(...prep.map((p) => Math.max(p.lab.length * 8.5, p.val.length * 11.5))) + 12;
        ensure(rh + 4);
        prep.forEach((p, k) => {
          const x = M + k * cw;
          pg.drawRectangle({ x, y: y - rh + 2, width: lw, height: rh, color: HEAD }); pg.drawRectangle({ x: x + lw, y: y - rh + 2, width: cw - lw, height: rh, color: p.miss ? YEL : rgb(1, 1, 1) });
          pg.drawRectangle({ x, y: y - rh + 2, width: cw, height: rh, borderColor: LINE, borderWidth: 0.6 });
          p.lab.forEach((ln, j) => T(ln, x + 7, y - 7 - 5 - j * 8.5 + 3, 6.8, FB, GREY)); p.val.forEach((ln, j) => T(ln, x + lw + 7, y - 7 - 6 - j * 11.5 + 2, z, rowItems[k][3] ? FB : F));
        });
        y -= rh;
      }
      y -= 8;
    }
    const sigline = (label, x, w) => { T(label, x, y, 7.5, FB, GREY); pg.drawLine({ start: { x: x + tw(label, FB, 7.5) + 10, y: y - 2 }, end: { x: x + w, y: y - 2 }, thickness: 0.7, color: TXT }); };

    const campi = (d.campi || []).slice().sort((a, b) => collator.compare(a.idc, b.idc));
    const CH = checks(d), nM = CH.filter((c) => c.t === 'm').length, nV = CH.filter((c) => c.t === 'v').length;

    /* 1 · dati da completare */
    page(false, 'Dati da completare e verificare', 'Quaderno di Campagna ' + anno);
    title('(!) Dati da completare e verificare – Campagna ' + anno);
    wrap(nM + ' dati mancanti · ' + nV + ' da verificare. Nelle stampe gli stessi punti sono evidenziati in giallo. Correggi nel gestionale e rigenera il quaderno: quando questa pagina è vuota il quaderno è completo.', F, 9, W - 2 * M).forEach((ln) => { T(ln, M, y, 9, F, GREY); y -= 12; });
    y -= 8;
    if (!CH.length) { pg.drawRectangle({ x: M, y: y - 30, width: W - 2 * M, height: 34, color: HEAD }); TC('Nessun dato mancante: il quaderno è completo', W / 2, y - 18, 10, FI, G); y -= 40; }
    else table([{ h: 'Documento', w: 95 }, { h: 'Voce', w: 235 }, { h: 'Cosa fare', w: 185 }], CH.map((c) => ({ cells: [c.doc, (c.t === 'v' ? '[verificare] ' : '') + c.voce, c.azione] })), { size: 8 });

    /* 2 · anagrafica */
    page(false, 'Anagrafica', 'Quaderno di Campagna ' + anno);
    title('Registri Aziendali delle Operazioni Colturali e di Magazzino', (az.disciplinare || 'PSR - Produzione Integrata') + ' · Campagna ' + anno);
    heading('Anagrafica'); kv([['Ragione sociale', az.ragione, !has(az.ragione)], ['CUAA', az.cuaa, !has(az.cuaa)], ['Partita IVA', az.piva, !has(az.piva)]]);
    heading('Domicilio o sede legale'); kv([['Indirizzo e n. civico', az.indirizzo, !has(az.indirizzo)], ['Comune', az.comune, !has(az.comune)], ['Provincia', az.prov, !has(az.prov)]]);
    heading('Ubicazione azienda (se diversa dalla sede legale)'); kv([['Indirizzo', az.ubIndirizzo], ['Comune', az.ubComune], ['Provincia', az.ubProv]]);
    heading('Rappresentante legale / titolare'); kv([['Cognome e nome', az.titolare, !has(az.titolare)], ['Data di nascita', fdn(az.nascita), !has(az.nascita)], ['Comune di nascita', az.nascitaComune, !has(az.nascitaComune)]]);

    /* 3 · autocertificazione irroratrice */
    page(false, 'Autocertificazione macchina irroratrice', 'Quaderno di Campagna ' + anno);
    const parti = String(az.ragione || '').split(' di '), citta = String(az.comune || '').replace(/^\d+\s*-\s*/, '');
    [parti[0], parti[1], az.cuaa, az.piva, az.indirizzo, (az.comune || '') + (az.prov ? ' - ' + az.prov : '')].filter(has).forEach((ln, i) => { T(ln, M, y, 10, i < 2 ? FB : F); y -= 14; });
    y -= 22; T('Oggetto: autocertificazione macchina irroratrice – anno ' + anno, M, y, 11, FB); y -= 34;
    const nome = String(az.titolare || '').trim().split(/\s+/); const nomeEsteso = (nome.length > 1 ? nome.slice(1).join(' ') + ' ' + nome[0] : nome[0] || '').toUpperCase();
    const corpo = 'Il sottoscritto ' + (parti[1] ? parti[1].toUpperCase() : nomeEsteso) + ', nato ad ' + String(az.nascitaComune || '').toUpperCase() + ' il ' + fdn(az.nascita) + ', residente a ' + citta.toUpperCase() + ' (' + (az.prov || '') + ') ' + (az.indirizzo || '') + ', con la presente dichiara che gli interventi fitosanitari nella propria azienda vengono eseguiti utilizzando la seguente macchina irroratrice:';
    wrap(corpo, F, 11, W - 2 * M).forEach((ln) => { T(ln, M, y, 11); y -= 17; });
    y -= 22; pg.drawRectangle({ x: M + 40, y: y - 14, width: W - 2 * M - 80, height: 38, color: has(az.macchina) ? HEAD : YEL }); TC(String(az.macchina || '—').toUpperCase(), W / 2, y - 2, 13, FB, G); y -= 70;
    T(citta + ', lì ' + fd(az.dataAutocert), M, y, 11); y -= 60; TR('Il dichiarante', W - M - 40, y, 10, F); pg.drawLine({ start: { x: W - M - 200, y: y - 28 }, end: { x: W - M, y: y - 28 }, thickness: 0.7, color: TXT });

    /* 4 · una pagina per campo */
    for (const c of campi) {
      page(false, 'Identificativo Campi – Colture', 'Quaderno di Campagna ' + anno);
      T('ID CAMPO', M, y, 7, FB, GREY); y -= 24; T(c.idc, M, y, 20, FB, G); y -= 24;
      let x = M; [c.tipologia, c.coltura, 'Campagna ' + anno].filter(has).forEach((s) => { const w = tw(s, FB, 8) + 16; pg.drawRectangle({ x, y: y - 5, width: w, height: 17, color: HEAD }); T(s, x + 8, y, 8, FB, G); x += w + 6; }); y -= 26;
      heading('Dati del campo'); kv([['Tipologia', c.tipologia, !has(c.tipologia)], ['Coltura', c.coltura, !has(c.coltura)], ['Comune – foglio – particella/e', catasto(c.particelle), !has(c.particelle)], ['Superficie', has(c.ha) ? n(c.ha, 4) + ' ha' : '', !(+c.ha > 0)]]);
      heading('Fenologia e raccolta – campagna ' + anno); kv([['Inizio fioritura', fd(c.fio1)], ['Fine fioritura', fd(c.fio2)], ['Data raccolta', fd(c.racc)]]);
      heading('Note'); const nl = wrap(c.note || '', F, 9, W - 2 * M - 16), bh = Math.max(46, nl.length * 12 + 16);
      pg.drawRectangle({ x: M, y: y - bh + 6, width: W - 2 * M, height: bh, borderColor: LINE, borderWidth: 0.6, color: has(c.verifica) ? YEL : rgb(1, 1, 1) });
      nl.forEach((ln, i) => T(ln, M + 8, y - 8 - i * 12, 9)); if (has(c.verifica)) T('(!) ' + c.verifica, M + 8, y - 8 - nl.length * 12, 9, FB);
    }

    /* 5 · magazzino fitosanitari + registro trattamenti (orizzontale) */
    for (const p of fito(d)) {
      const b = bilancio(d, p), u = p.unita || '';
      page(true, 'Registro Magazzino Fitosanitari', 'Registro Fitosanitari ' + anno + ' – Magazzino e Trattamenti');
      title(p.nome);
      kv([['Formulato commerciale', p.nome, false, 0], ['Tipologia', p.categoria, !has(p.categoria)], ['Sostanza attiva', p.sostanza, !has(p.sostanza)], ['N. di registrazione', regTxt(p), !has(p.registrazione)], ['Giacenza iniziale', n(b.iniziale) + ' ' + u], ['Giacenza finale', n(b.finale) + ' ' + u, b.finale < -0.005, 1]], { cols: 2 });
      heading('Acquisti');
      if (!b.acq.length) { pg.drawLine({ start: { x: M, y: y + 10 }, end: { x: W - M, y: y + 10 }, thickness: 0.5, color: LINE }); TC('Nessun acquisto registrato', W / 2, y - 2, 8.5, FI, GREY); y -= 22; }
      else {
        table([{ h: 'Data consegna (DDT)', w: 150 }, { h: 'Quantità', w: 130, al: 'r' }, { h: 'Numero fattura', w: 150, al: 'c' }, { h: 'Data fattura', w: 150, al: 'c' }, { h: 'DDT n.', w: 182, al: 'c' }],
          b.acq.map((a) => [fd(a.data), n(a.quantita) + ' ' + u, { t: a.fattura, miss: !has(a.fattura) }, fd(a.dataFattura), a.ddt || '']).concat([{ cells: ['Totale acquistato', n(b.acquistato) + ' ' + u, '', '', ''], bold: 1, total: 1 }]));
      }
      heading('Registro dei trattamenti');
      const tr = b.usi.slice().sort(byDate);
      table([{ h: 'Data', w: 60 }, { h: 'ID campo', w: 112 }, { h: 'Dose (kg-l/ha)', w: 52, al: 'r' }, { h: 'Fase fenologica', w: 178 }, { h: 'Patogeno', w: 104 }, { h: 'Dose (kg/hl)', w: 52, al: 'r' }, { h: 'Volume miscela (hl)', w: 56, al: 'r' }, { h: 'Quantità tot. (kg-l)', w: 62, al: 'r' }, { h: 'Note', w: 86 }],
        tr.map((t) => [fd(t.data), t.campo, { t: n(t.doseHa), miss: !(+t.doseHa > 0) }, { t: t.fase, miss: !has(t.fase) }, { t: t.avversita, miss: !has(t.avversita) }, n(t.doseHl), n(t.volume), n(t.quantita), t.note || '—']).concat([{ cells: ['', 'Totale utilizzato', '', '', '', '', '', n(b.utilizzato) + ' ' + u, ''], bold: 1, total: 1 }]));
      ensure(40); y -= 14; sigline('DATA', M, 120); sigline('FIRMA DEL TITOLARE', W - M - 270, 270);
    }

    /* 6 · registro fertilizzanti (sovesci) */
    for (const p of sem(d)) {
      const b = bilancio(d, p), u = p.unita || 'kg';
      page(false, 'Registro Fertilizzanti', 'Registro Fertilizzanti ' + anno);
      title(p.nome + ' – sovescio');
      kv([['Campagna', String(anno)], ['Formulato', p.formulato || ''], ['Sostanza attiva', p.sostanza, !has(p.sostanza)], ['Unità di misura', u], ['Giacenza iniziale', n(b.iniziale) + ' ' + u], ['Totale utilizzo', n(b.utilizzato) + ' ' + u], ['Acquistato nell\'anno', n(b.acquistato) + ' ' + u], ['Giacenza finale', n(b.finale) + ' ' + u, b.finale < -0.005, 1]], { cols: 2, lw: 100 });
      heading('Acquisti');
      if (!b.acq.length) { TC('Nessun acquisto registrato', W / 2, y, 8.5, FI, GREY); y -= 20; }
      else table([{ h: 'Data', w: 120 }, { h: 'Quantità', w: 110, al: 'r' }, { h: 'Unità di misura', w: 110, al: 'c' }, { h: 'Fattura', w: 175 }], b.acq.map((a) => [fd(a.data), n(a.quantita), u, { t: (a.fattura || '') + (a.dataFattura ? ' del ' + fd(a.dataFattura) : ''), miss: !has(a.fattura) }]).concat([{ cells: ['Totale', n(b.acquistato), '', ''], bold: 1, total: 1 }]));
      heading('Registro fertilizzazioni');
      const rr = [];
      for (const s of b.usi.slice().sort(byDate)) for (const idc of campiDi(s.campi)) { const c = campi.find((x) => x.idc === idc), ha = c ? +c.ha : 0; rr.push([fd(s.data), idc, n(ha, 4), n(s.doseHa), n(ha * (+s.doseHa || 0))]); }
      table([{ h: 'Data', w: 90 }, { h: 'ID campo', w: 170 }, { h: 'Superficie (ha)', w: 85, al: 'r' }, { h: 'Dose (kg/ha)', w: 80, al: 'r' }, { h: 'Quantità (kg)', w: 90, al: 'r' }], rr);
    }

    /* 7 · registro operazioni colturali */
    page(false, 'Registro Operazioni Colturali', 'Registro Operazioni Colturali ' + anno);
    title('Registro Operazioni Colturali – Campagna ' + anno);
    table([{ h: 'Data', w: 70 }, { h: 'Operazione', w: 105 }, { h: 'ID campo', w: 185 }, { h: 'Note', w: 155 }],
      (d.operazioni || []).slice().sort((a, b) => byDate(a, b) || collator.compare(a.operazione, b.operazione)).map((o) => [fd(o.data), o.operazione, o.campi, o.note || '']));

    /* 8 · registro semine */
    const dSem = (d.semine || []).slice().sort(byDate);
    if (dSem.length) {
      page(true, 'Registro Semine', 'Registro Semine ' + anno);
      title('Registro Semine – Campagna ' + anno);
      const date = [...new Set(dSem.map((s) => s.data))];
      kv([['Campagna', String(anno)], ['Data/e di semina', date.map(fd).join(', ')]], { cols: 2 });
      heading('Identificativo dei campi e delle colture');
      table([{ h: 'ID campo', w: 300 }, { h: 'Coltura', w: 150 }], [...new Set(dSem.flatMap((s) => campiDi(s.campi)))].sort(collator.compare).map((i) => [i, (campi.find((c) => c.idc === i) || {}).coltura || '']));
      heading('Sementi');
      const tot = {}; dSem.forEach((s) => { tot[s.prodotto] = r2((tot[s.prodotto] || 0) + (+s.quantita || 0)); });
      const cs = Object.entries(tot).sort((a, b) => collator.compare(a[0], b[0]));
      table([{ h: 'Descrizione', w: 380 }, { h: 'Quantità (kg)', w: 150, al: 'r' }], cs.map(([k, q]) => [k, n(q) + ' kg']).concat([{ cells: ['Totale', n(cs.reduce((t, x) => t + x[1], 0)) + ' kg'], bold: 1, total: 1 }]));
      ensure(40); y -= 14; sigline('DATA', M, 120); sigline('FIRMA DEL TITOLARE', W - M - 270, 270);
    }

    /* 9 · stima asporti (una pagina per coltura, solo se i coefficienti sono noti) */
    const colt = [...new Set(campi.filter((c) => c.tipologia === 'Fruttifero' && ['asN', 'asP', 'asK'].every((k) => +c[k] > 0)).map((c) => c.coltura))].sort(collator.compare);
    for (const col of colt) {
      page(true, 'Stima Asporti', 'Stima asporti ' + anno);
      title('Stima asporti – ' + col); kv([['Campagna', String(anno)], ['Tipologia di produzione', col]], { cols: 2 });
      const list = campi.filter((c) => c.coltura === col && c.tipologia === 'Fruttifero' && ['asN', 'asP', 'asK'].every((k) => +c[k] > 0));
      const tt = { ha: 0, N: 0, P: 0, K: 0 };
      const rws = list.map((c) => { const pr = +c.prodAttesa || 0, ha = +c.ha || 0, aN = pr * c.asN, aP = pr * c.asP, aK = pr * c.asK; tt.ha += ha; tt.N += aN * ha; tt.P += aP * ha; tt.K += aK * ha; return [c.idc, n(ha, 4), { t: n(pr), miss: !(pr > 0) }, n(c.asN), n(c.asP), n(c.asK), n(aN), n(aP), n(aK), n(aN * ha), n(aP * ha), n(aK * ha)]; });
      rws.push({ cells: ['Totale coltura', n(tt.ha, 4), '', '', '', '', '', '', '', n(tt.N), n(tt.P), n(tt.K)], bold: 1, total: 1 });
      const w = 57; table([{ h: 'ID campo', w: 130 }, { h: 'Superficie (ha)', w, al: 'r' }, { h: 'Produzione attesa (q/ha)', w, al: 'r' }, { h: 'N unitario (kg/q)', w, al: 'r' }, { h: 'P2O5 unitario (kg/q)', w, al: 'r' }, { h: 'K2O unitario (kg/q)', w, al: 'r' }, { h: 'N asporto (kg/ha)', w, al: 'r' }, { h: 'P2O5 asporto (kg/ha)', w, al: 'r' }, { h: 'K2O asporto (kg/ha)', w, al: 'r' }, { h: 'N totale (kg)', w, al: 'r' }, { h: 'P2O5 totale (kg)', w, al: 'r' }, { h: 'K2O totale (kg)', w, al: 'r' }], rws, { size: 8 });
      T('Asporto (kg/ha) = produzione attesa (q/ha) × asporto unitario (kg/q); totale (kg) = asporto (kg/ha) × superficie (ha).'.replace('×', 'x'), M, y - 4, 7.5, FI, GREY);
    }
    return pdf.save();
  }

  return { checks, build, catasto, bilancio, fd, n };
});
