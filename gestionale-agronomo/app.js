/* Gestionale Agronomo — PWA senza dipendenze. Dati solo nel dispositivo (localStorage). */
(() => {
  'use strict';
  const L = window.Lib;
  const KEY = 'gestionale-agronomo:v1';
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  // Configurazione sincronizzazione (config.js). Le schede in localOnly non lasciano mai il dispositivo.
  const cfg = Object.assign({ supabaseUrl: '', supabaseKey: '', localOnly: ['fatture', 'studenti', 'valutazioni', 'verbali', 'movimenti', 'ricorrenti', 'pagamenti', 'spesePratica', 'preventivi', 'denunce', 'noteSpese', 'versamenti', 'diario', 'figlie'] }, window.GESTIONALE_CONFIG);
  cfg.supabaseUrl = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  cfg.on = !!(cfg.supabaseUrl && cfg.supabaseKey);
  const synced = (ek) => !cfg.localOnly.includes(ek);

  /* ---------- DOM helper (nessun innerHTML: i dati utente sono sempre testo) ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const btn = (label, fn, cls) => h('button', { type: 'button', class: cls || 'sm', onclick: (e) => { e.stopPropagation(); fn(e); } }, label);
  let toastT;
  function toast(msg) {
    const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
  }

  /* ---------- Definizione dati ---------- */
  const VERS_CAT = ['EPAP – contributi previdenziali', 'Assicurazione professionale', 'Imposta sostitutiva (acconto / saldo)', 'Ordine / albo', 'Commercialista', 'Formazione e aggiornamento', 'Software e abbonamenti', 'Telefono e internet', 'Attrezzature e cancelleria', 'Auto e carburante', 'Altro'];
  const TIPI_PRATICA = ['PAC / domanda unica', 'Anagrafe Apistica', 'PSR', 'Catasto', 'Estimo', 'Piano fitosanitario (PAN)', 'Progetto verde / giardino', 'Coordinamento sicurezza', 'Formazione', 'Consulenza', 'Altro'];
  /* «Anagrafe apistica» e «Anagrafe Apistica» sono lo stesso tipo: si unifica la grafia (prima voce dell'elenco, altrimenti la più usata) */
  const normTipi = () => {
    const fixA = (a) => Array.isArray(a) ? a.map((t) => String(t).trim().toLowerCase() === 'anagrafe apistica' ? 'Anagrafe Apistica' : t) : a;
    if (db.settings) { if (db.settings.tipiPratica) db.settings.tipiPratica = fixA(db.settings.tipiPratica); if (db.settings.learned && db.settings.learned['pratiche.tipo']) db.settings.learned['pratiche.tipo'] = fixA(db.settings.learned['pratiche.tipo']); }
    const base = (db.settings && Array.isArray(db.settings.tipiPratica) && db.settings.tipiPratica.length ? db.settings.tipiPratica : TIPI_PRATICA).concat(learnedOf('pratiche', 'tipo'));
    const canon = new Map(); base.forEach((t) => { const k = String(t).trim().toLowerCase(); if (k && !canon.has(k)) canon.set(k, String(t).trim()); });
    const cnt = {}; rows('pratiche').forEach((r) => { const t = (r.tipo || '').trim(); if (t) { const k = t.toLowerCase(); (cnt[k] = cnt[k] || {})[t] = ((cnt[k] || {})[t] || 0) + 1; } });
    let ch = false;
    rows('pratiche').forEach((r) => { const t = (r.tipo || '').trim(); if (!t) return; const k = t.toLowerCase(); const c = canon.get(k) || Object.entries(cnt[k]).sort((a, b) => b[1] - a[1])[0][0]; if (r.tipo !== c) { r.tipo = c; r.updated = NOW(); ch = true; } });
    if (ch) save();
  };
  const tipiPratica = () => { return uniqCI(_tipiPratica()); };
  const uniqCI = (a) => { const s = new Set(); return a.filter((x) => { const k = String(x).trim().toLowerCase(); if (!k || s.has(k)) return false; s.add(k); return true; }); };
  const _tipiPratica = () => { const base = db.settings && Array.isArray(db.settings.tipiPratica) && db.settings.tipiPratica.length ? db.settings.tipiPratica : TIPI_PRATICA; return [...new Set([...base, ...learnedOf('pratiche', 'tipo'), ...rows('pratiche').map((r) => (r.tipo || '').trim()).filter(Boolean)])]; };
  /* campi che «imparano»: un valore nuovo scritto a mano viene ricordato e proposto la volta dopo */
  const learnedOf = (ek, k) => { const l = db.settings && db.settings.learned && db.settings.learned[ek + '.' + k]; return Array.isArray(l) ? l : []; };
  const learn = (ek, k, v) => { const f = fieldOf(ENT[ek], k), known = new Set([...(f.list || (f.listFn && f.listFn()) || []), ...learnedOf(ek, k)].map((x) => String(x).toLowerCase())); if (known.has(String(v).toLowerCase())) return; db.settings.learned = db.settings.learned || {}; db.settings.learned[ek + '.' + k] = [...learnedOf(ek, k), v]; };
  /* duplica una pratica (anche chiusa): stessi dati di base, stato «Da avviare», senza scadenza né pagamenti/spese/denunce */
  const duplicaPratica = (p) => {
    const c = Object.assign({}, p, { id: uid(), stato: 'Da avviare', scadenza: '', updated: NOW() });
    delete c.apDenominazione; delete c.apCodice; rows('pratiche').push(c); save(); toast('Pratica duplicata'); location.hash = '#/professione/pratica/' + c.id;
  };
  /* fatture: se non indicata, la scadenza di pagamento è data fattura + 60 giorni (modificabile da Impostazioni → giorniPag) */
  const GG_PAG = () => +(db.settings && db.settings.giorniPag) || 60;
  const scadFatt = (r) => r.scadPag || (r.data ? L.addDays(r.data, GG_PAG()) : '');
  const fattStato = (r) => { if (r.incassata) return null; const sc = scadFatt(r); if (!sc) return null; const d = L.diffDays(L.today(), sc); return { sc, d, late: d < 0 }; };
  /* Fatturazione note spese EcoGruppo (come il foglio «Conteggio Note Spese») */
  const nsCalc = (r) => {
    const rimb = r2((+r.rimborsoKm || 0) + (+r.autostrada || 0)), tot = r2(rimb + (+r.ispezioni || 0));
    const epap = r.noEpap ? 0 : r2(tot * 0.04), bollo = !(tot > 0) ? 0 : r.bollo === undefined || r.bollo === '' || r.bollo === null ? 2 : +r.bollo || 0;
    return { rimb, tot, epap, bollo, totFatt: r2(tot + epap + bollo) };
  };
  const nsStato = (r) => {
    const T = L.today();
    if (r.pagamentoData) return { k: 'ok', t: 'Pagata' };
    if (r.fatturaData) { const d = L.diffDays(r.fatturaData, T); return d > 60 ? { k: 'late', t: 'SOLLECITARE (passati ' + d + ' gg)' } : { k: 'wait', t: d + ' giorni trascorsi · scade tra ' + (60 - d) }; }
    if (r.dataNota) return { k: 'todo', t: 'Da fatturare · ' + L.diffDays(r.dataNota, T) + ' giorni dalla nota' };
    return { k: 'wait', t: '' };
  };
  /* ---- Versamenti (EPAP, assicurazione, imposte…) con archivio PDF sul dispositivo ---- */
  const FILES = (() => {
    const op = () => new Promise((res, rej) => { const q = indexedDB.open('gestionale-files', 1); q.onupgradeneeded = () => q.result.createObjectStore('f'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const run = async (mode, fn) => { const d = await op(); return new Promise((res, rej) => { const t = d.transaction('f', mode), rq = fn(t.objectStore('f')); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
    return { put: (k, b) => run('readwrite', (s) => s.put(b, k)), get: (k) => run('readonly', (s) => s.get(k)), del: (k) => run('readwrite', (s) => s.delete(k)).catch(() => {}) };
  })();
  async function openDoc(key, meta) {
    const w = window.open('', '_blank');
    try {
      const b = await FILES.get(key); if (!b) { if (w) w.close(); return toast('File non trovato su questo dispositivo'); }
      const url = URL.createObjectURL(b);
      if (w) w.location.href = url; else { const a = h('a', { href: url, download: (meta && meta.name) || 'documento' }); document.body.append(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { if (w) w.close(); toast('Impossibile aprire il file: ' + e.message); }
  }
  const vsGruppo = (c) => (/epap|inps|contribut|previdenz|cassa/i.test(c || '') ? 'Contributi' : /imposta|irpef|f24|\biva\b|tasse|acconto fiscale|sostitutiva/i.test(c || '') ? 'Imposte' : 'Spese');
  const vsAnno = (r) => String(r.anno || (r.data || '').slice(0, 4) || '');
  const PRAT_FIGLI = ['pagamenti', 'spesePratica', 'preventivi', 'documenti', 'denunce'];
  const pratEco = (p) => {
    const sum = (ek, f) => rows(ek).filter((x) => x.pratica === p.id && (!f || f(x))).reduce((t, x) => t + (+x.importo || 0), 0);
    const compenso = +p.compenso || 0, speseR = sum('spesePratica', (x) => x.rimborsabile), speseC = sum('spesePratica', (x) => !x.rimborsabile), incassato = sum('pagamenti');
    const dovuto = r2(compenso + speseR);
    return { compenso, speseR: r2(speseR), speseC: r2(speseC), dovuto, incassato: r2(incassato), residuo: r2(dovuto - incassato) };
  };
  const linkOf = (u) => { u = String(u || '').trim(); return !u ? '' : /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u; };
  const provider = (u) => { u = String(u || '').toLowerCase(); return /drive\.google|docs\.google/.test(u) ? 'Google Drive' : /icloud/.test(u) ? 'iCloud' : /dropbox/.test(u) ? 'Dropbox' : /onedrive|sharepoint|1drv/.test(u) ? 'OneDrive' : /^https?:|^[a-z0-9.-]+\.[a-z]{2,}/.test(u) ? 'Link' : ''; };
  const STATI_PRATICA = ['Da avviare', 'In corso', 'In attesa', 'Consegnata', 'Chiusa'];
  const lab = (ek, id) => { const r = id && rows(ek).find((x) => x.id === id); return r ? ENT[ek].title(r) : ''; };
  const prodottiMagazzino = () => rows('magazzino').map((r) => r.prodotto).filter(Boolean);

  const defParts = () => [{ id: 'p1', name: 'Vero o falso', max: 6 }, { id: 'p2', name: 'Risposta multipla', max: 6 },
    { id: 'p3', name: 'Aperta 1', max: 8 }, { id: 'p4', name: 'Aperta 2', max: 8 }, { id: 'p5', name: 'Aperta 3', max: 8 }];
  const maxTot = (v) => (v.parti || []).reduce((a, p) => a + (+p.max || 0), 0);
  const fmt1 = (n) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

  const gmailSearch = (q) => 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(q);
  const gmailCompose = (to, subj) => 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to) + (subj ? '&su=' + encodeURIComponent(subj) : '');
  const gmailActions = [{ label: '✉️ Scrivi (Gmail)', show: (r) => !!r.email, href: (r) => gmailCompose(r.email) }, { label: '🔍 Mail in Gmail', show: (r) => !!(r.email || r.nome || r.cognome || r.ragione), href: (r) => gmailSearch(r.email ? 'from:' + r.email + ' OR to:' + r.email : '"' + ([r.cognome, r.nome].filter(Boolean).join(' ') || r.ragione) + '"') }];
  const SP_CAT = ['Spesa alimentare','Carburante','Manutenzione veicoli','Assicurazione/Bollo','Casa/Utenze','Telefono/Internet','Farmacia','Salute','Abbigliamento','Bar','Ristoranti/Svago','Regali','Libri/Cultura','Amazon','Figlie','Abbonamenti','Rate/Finanziamenti','Tasse/Imposte','Altro'];
  const SP_CAT_ALL = SP_CAT.concat(['Stipendio', 'Consulenze agronomo', 'Rimborsi', 'Regali ricevuti', 'Altre entrate', 'Prelievo contanti']);
  const SP_VEI = ['Nissan', 'Jeep Compass', 'Africa Twin', 'Trattore Landini'];
  const ENT = {
    parcelle: {
      label: 'Parcelle', one: 'parcella', order: { k: 'nome', dir: 1 },
      fields: [
        { k: 'nome', l: 'Nome parcella', t: 'text', req: 1 },
        { k: 'coltura', l: 'Coltura', t: 'text', list: ['Pesco', 'Albicocco', 'Nocciolo', 'Altro'] },
        { k: 'ettari', l: 'Superficie (ha)', t: 'number', step: '0.01' },
        { k: 'catasto', l: 'Foglio / particella', t: 'text' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => r.nome, cols: ['coltura', 'ettari', 'catasto'],
    },
    trattamenti: {
      label: 'Trattamenti', one: 'trattamento', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'data', l: 'Data', t: 'date', req: 1, def: 'today' },
        { k: 'parcella', l: 'Parcella', t: 'ref', to: 'parcelle' },
        { k: 'avversita', l: 'Avversità / motivo', t: 'text' },
        { k: 'prodotto', l: 'Prodotto', t: 'text', req: 1, listFn: prodottiMagazzino },
        { k: 'dose', l: 'Dose (per hl / per ha)', t: 'text' },
        { k: 'quantita', l: 'Quantità usata', t: 'text' },
        { k: 'carenza', l: 'Tempo di carenza (giorni)', t: 'number', step: '1' },
        { k: 'operatore', l: 'Operatore', t: 'text' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => (r.prodotto || 'Trattamento') + (r.parcella ? ' – ' + lab('parcelle', r.parcella) : ''),
      cols: ['data', 'avversita', 'dose'],
      extra: (r) => (+r.carenza > 0 && r.data ? ['Raccolta consentita dal ' + L.fmtDate(L.addDays(r.data, +r.carenza))] : []),
      events: (r) => (+r.carenza > 0 && r.data ? [{ date: L.addDays(r.data, +r.carenza), info: 1,
        title: 'Fine carenza ' + r.prodotto + (r.parcella ? ' – ' + lab('parcelle', r.parcella) : ''),
        description: 'Trattamento del ' + L.fmtDate(r.data) + ', carenza ' + r.carenza + ' giorni.' }] : []),
    },
    concimazioni: {
      label: 'Concimazioni', one: 'concimazione', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'data', l: 'Data', t: 'date', req: 1, def: 'today' },
        { k: 'parcella', l: 'Parcella', t: 'ref', to: 'parcelle' },
        { k: 'prodotto', l: 'Concime', t: 'text', req: 1, listFn: prodottiMagazzino },
        { k: 'dose', l: 'Dose (kg/ha)', t: 'number', step: 'any' },
        { k: 'quantita', l: 'Quantità totale (kg)', t: 'number', step: 'any' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => (r.prodotto || 'Concimazione') + (r.parcella ? ' – ' + lab('parcelle', r.parcella) : ''),
      cols: ['data', 'dose', 'quantita'],
    },
    raccolte: {
      label: 'Raccolte', one: 'raccolta', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'data', l: 'Data', t: 'date', req: 1, def: 'today' },
        { k: 'parcella', l: 'Parcella', t: 'ref', to: 'parcelle' },
        { k: 'prodotto', l: 'Prodotto', t: 'text', req: 1, list: ['Pesche', 'Albicocche', 'Nocciole'] },
        { k: 'kg', l: 'Quantità (kg)', t: 'number', step: 'any' },
        { k: 'prezzo', l: 'Prezzo (€/kg)', t: 'number', step: '0.01' },
        { k: 'acquirente', l: 'Destinazione / acquirente', t: 'text' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => (r.prodotto || 'Raccolta') + (r.parcella ? ' – ' + lab('parcelle', r.parcella) : ''),
      cols: ['data', 'kg', 'acquirente'],
      extra: (r) => (+r.kg && +r.prezzo ? ['Ricavo ' + L.eur(r.kg * r.prezzo)] : []),
    },
    magazzino: {
      label: 'Magazzino', one: 'prodotto', order: { k: 'prodotto', dir: 1 },
      fields: [
        { k: 'prodotto', l: 'Prodotto', t: 'text', req: 1 },
        { k: 'tipo', l: 'Tipo', t: 'select', opts: ['Fitofarmaco', 'Concime', 'Altro'] },
        { k: 'registrazione', l: 'N. registrazione', t: 'text' },
        { k: 'quantita', l: 'Giacenza', t: 'number', step: 'any' },
        { k: 'unita', l: 'Unità', t: 'select', opts: ['kg', 'l', 'g', 'ml', 'pz'] },
        { k: 'scadenza', l: 'Scadenza prodotto', t: 'date' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => r.prodotto, cols: ['tipo', 'quantita', 'unita', 'scadenza'],
      events: (r) => (r.scadenza ? [{ date: r.scadenza, info: 1, title: 'Scade prodotto: ' + r.prodotto }] : []),
    },
    manutenzioni: {
      label: 'Manutenzioni', one: 'manutenzione', order: { k: 'scadenza', dir: 1 },
      fields: [
        { k: 'titolo', l: 'Cosa', t: 'text', req: 1 },
        { k: 'luogo', l: 'Dove', t: 'select', opts: ['Casa', 'Cascina', 'Magazzino', 'Trattore / macchine', 'Impianti', 'Terreno', 'Altro'] },
        { k: 'scadenza', l: 'Scadenza', t: 'date' },
        { k: 'ricorrenza', l: 'Si ripete', t: 'select', opts: ['Nessuna', 'Mensile', 'Trimestrale', 'Semestrale', 'Annuale'], def: 'Nessuna', req: 1 },
        { k: 'stato', l: 'Stato', t: 'select', opts: ['Da fare', 'In corso', 'Fatto'], def: 'Da fare', req: 1 },
        { k: 'costo', l: 'Costo (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'fornitore', l: 'Fornitore / ditta', t: 'text' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => r.titolo, cols: ['luogo', 'scadenza', 'ricorrenza', 'stato'],
      isDone: (r) => r.stato === 'Fatto',
      events: (r) => (r.scadenza ? [{ date: r.scadenza, title: r.titolo + (r.luogo ? ' (' + r.luogo + ')' : ''), description: r.note }] : []),
      actions: [{
        label: '✓ Fatto', show: (r) => r.stato !== 'Fatto',
        run: (r) => {
          const n = L.nextDate(r.scadenza, r.ricorrenza);
          if (n) { r.scadenza = n; r.stato = 'Da fare'; toast('Prossima scadenza: ' + L.fmtDate(n)); } else r.stato = 'Fatto';
        },
      }],
    },
    aziende: {
      label: 'Aziende', one: 'azienda', order: { k: 'ragione', dir: 1 },
      fields: [
        { k: 'ragione', l: 'Operatore', t: 'text', req: 1 },
        { k: 'codice', l: 'Codice operatore', t: 'text' },
        { k: 'importo', l: 'Importo ispezione (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'email', l: 'Email', t: 'email' },
        { k: 'fisso', l: 'Telefono fisso', t: 'tel' },
        { k: 'telefono', l: 'Cellulare', t: 'tel' },
        { k: 'ubicazione', l: 'Ubicazione', t: 'text' },
        { k: 'comune', l: 'Comune', t: 'text' },
        { k: 'provincia', l: 'Provincia', t: 'text' },
        { k: 'tecnico', l: 'Tecnico', t: 'text' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => r.ragione, cols: ['codice', 'comune', 'telefono'],
      detail: (r) => '#/ispezioni/azienda/' + r.id,
      onDelete: (r) => { dropWhere('piano', (x) => x.azienda === r.id); dropWhere('modello44', (x) => x.azienda === r.id); dropWhere('promemoria', (x) => x.azienda === r.id); },
    },
    modello44: {
      label: 'Modello 44', one: 'Modello 44', order: { k: 'numero', dir: 1 },
      fields: [
        { k: 'azienda', l: 'Azienda', t: 'ref', to: 'aziende', req: 1 },
        { k: 'numero', l: 'Numero', t: 'text' },
        { k: 'ncChiuse', l: 'Le NC precedenti sono state chiuse?', t: 'select', opts: ['Sì', 'No', 'Nessuna NC'] },
        { k: 'esito', l: 'Esito controllo', t: 'text', list: ['Positivo', 'Negativo', 'Con NC'] },
        { k: 'variazione', l: 'Variazione nello status di conversione dell\'azienda?', t: 'select', opts: ['Sì', 'No'] },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => 'Modello 44 ' + (r.numero || '') + (r.azienda ? ' – ' + lab('aziende', r.azienda) : ''), cols: ['ncChiuse', 'esito'],
    },
    periodi: {
      label: 'Periodi', one: 'periodo', order: { k: 'avvio', dir: -1 },
      fields: [
        { k: 'anno', l: 'Anno lavorativo', t: 'number', step: '1', req: 1 },
        { k: 'avvio', l: 'Avvio trimestre', t: 'date', req: 1 },
        { k: 'chiusura', l: 'Chiusura trimestre', t: 'date', req: 1 },
        { k: 'epap', l: 'Applica EPAP 4% sugli importi delle ispezioni', t: 'checkbox' }],
      title: (r) => (r.anno || '') + ' · ' + L.fmtDate(r.avvio) + ' – ' + L.fmtDate(r.chiusura), cols: ['anno', 'avvio', 'chiusura'],
      onDelete: (r) => { dropWhere('piano', (x) => x.periodo === r.id); dropWhere('ispezioni', (x) => x.periodo === r.id); },
    },
    versamenti: {
      label: 'Versamenti', one: 'versamento', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'data', l: 'Data pagamento', t: 'date', req: true, def: 'today' },
        { k: 'categoria', l: 'Categoria', t: 'text', req: true, list: VERS_CAT, learn: 1, hint: 'Scegli o scrivi: se è nuova, la categoria viene ricordata.' },
        { k: 'descrizione', l: 'Descrizione', t: 'text', hint: 'Es. «EPAP 2° acconto», «Polizza RC professionale 2026».' },
        { k: 'importo', l: 'Importo (€)', t: 'number', step: '0.01', req: true, fmt: 'eur' },
        { k: 'anno', l: 'Anno di competenza', t: 'number', step: '1', hint: 'Solo se diverso dall’anno del pagamento (es. saldo pagato a giugno per l’anno prima).' },
        { k: 'pdf', l: 'Ricevuta / PDF', t: 'doc' },
        { k: 'link', l: 'Link al file su cloud', t: 'url', hint: 'Facoltativo: cartella o file su Drive/iCloud/Dropbox.' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      dlg: { name: () => 'versamento', wide: true, focus: 'categoria', rows: [['data', 'importo'], ['categoria', 'descrizione'], ['anno', 'link']], sections: { data: 'Pagamento', pdf: 'Documento', note: 'Note' } },
      title: (r) => (r.categoria || 'Versamento') + (r.descrizione ? ' – ' + r.descrizione : ''), cols: ['data', 'importo'],
      onDelete: (r) => { FILES.del(r.id + ':pdf'); },
    },
    noteSpese: {
      label: 'Fatturazione', one: 'nota spese', order: { k: 'dataNota', dir: 1 },
      fields: [
        { k: 'numero', l: 'N. nota spese', t: 'text' },
        { k: 'dataNota', l: 'Data nota spese', t: 'date', def: 'today' },
        { k: 'rimborsoKm', l: 'Rimborso km (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'autostrada', l: 'Autostrada (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'ispezioni', l: 'Ispezioni (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'fatturaData', l: 'Fattura emessa il', t: 'date', hint: 'Lasciala vuota finché non emetti la fattura.' },
        { k: 'pagamentoData', l: 'Data pagamento', t: 'date', hint: 'Compila quando vieni pagato.' },
        { k: 'noEpap', l: 'Senza EPAP 4%', t: 'checkbox' },
        { k: 'bollo', l: 'Bollo (€)', t: 'number', step: '0.01', hint: 'Se vuoto: 2,00 €.' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => 'Nota spese ' + (r.numero || ''), cols: ['dataNota'],
      events: (r) => (r.fatturaData && !r.pagamentoData ? [{ date: L.addDays(r.fatturaData, 60), title: 'Incasso nota spese ' + (r.numero || '') + ' (' + L.eur(nsCalc(r).totFatt) + ') – da sollecitare' }] : []),
    },
    piano: { label: 'Piano', one: 'voce del piano', order: { k: 'updated', dir: -1 }, fields: [], title: (r) => lab('aziende', r.azienda), cols: [] },
    ispezioni: {
      label: 'Tutte le ispezioni', one: 'ispezione', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'data', l: 'Data ispezione', t: 'date', hint: 'Lasciala vuota finché non è fissata: l’ispezione resta “da fissare” entro la fine del periodo.' },
        { k: 'ora', l: 'Ora', t: 'time' },
        { k: 'azienda', l: 'Azienda', t: 'ref', to: 'aziende' },
        { k: 'tipo', l: 'Tipo', t: 'select', opts: ['Annuale', 'Supplementare', 'A sorpresa', 'Controllo documentale'] },
        { k: 'norma', l: 'Norma / schema', t: 'select', opts: ['Reg. UE 848/2018', 'SQNPI', 'Altro'] },
        { k: 'stato', l: 'Organizzazione', t: 'select', opts: ['Programmata', 'Svolta', 'Verbale da consegnare', 'Chiusa'], def: 'Programmata', req: 1 },
        { k: 'periodo', l: 'Periodo', t: 'ref', to: 'periodi' },
        { k: 'pagamento', l: 'Pagamento', t: 'select', opts: ['Da registrare', 'Registrato', 'Pagato'], def: 'Da registrare' },
        { k: 'dataCarico', l: 'Data carico gestionale', t: 'date' },
        { k: 'campionamento', l: 'Campionamento', t: 'text' },
        { k: 'scadVerbale', l: 'Scadenza consegna verbale', t: 'date' },
        { k: 'km', l: 'Km percorsi (ordinari)', t: 'number', step: '1' },
        { k: 'kmExtra', l: 'Km extra', t: 'number', step: '1' },
        { k: 'altreSpese', l: 'Altre spese (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'complessita', l: 'Complessità controllo', t: 'select', opts: Object.keys(L.TARIFFE) },
        { k: 'destinazione', l: 'Destinazione (nota spese)', t: 'text' },
        { k: 'partenza', l: 'Luogo di partenza (se diverso)', t: 'text' },
        { k: 'compenso', l: 'Compenso (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => (r.azienda ? lab('aziende', r.azienda) : 'Ispezione'),
      cols: ['data', 'stato', 'pagamento'],
      dlg: { name: () => 'ispezione', skip: ['tipo', 'norma'], wide: true, chips: ['stato', 'pagamento'], rows: [['data', 'ora'], ['stato', 'pagamento'], ['periodo', 'dataCarico'], ['scadVerbale', 'campionamento'], ['km', 'kmExtra'], ['altreSpese', 'compenso'], ['destinazione', 'partenza']], sections: { data: 'Data e azienda', stato: 'Stato e pagamento', periodo: 'Gestionale e verbale', km: 'Spostamenti e compenso', note: 'Note' } },
      isDone: (r) => r.stato === 'Chiusa',
      events: (r) => {
        const az = r.azienda ? lab('aziende', r.azienda) : '';
        const comune = r.azienda ? ((rows('aziende').find((x) => x.id === r.azienda) || {}).comune || '') : '';
        const out = [];
        if (r.stato === 'Programmata' && r.data && !daFissare(r)) out.push({ date: r.data, time: r.ora, durationMin: 180, title: 'Ispezione ' + az, location: comune, description: [r.tipo, r.norma].filter(Boolean).join(' – ') });
        if (r.stato !== 'Chiusa' && r.scadVerbale) out.push({ date: r.scadVerbale, title: 'Consegna verbale ' + az });
        return out;
      },
      actions: [
        { label: '✓ Eseguita', show: (r) => r.stato === 'Programmata', run: (r) => { r.stato = 'Verbale da consegnare'; } },
        { label: '✓ Chiusa', show: (r) => r.stato !== 'Chiusa' && r.stato !== 'Programmata', run: (r) => { r.stato = 'Chiusa'; } },
      ],
    },
    clienti: {
      label: 'Clienti', one: 'cliente', order: { k: 'nome', dir: 1 },
      fields: [
        { k: 'titolo', l: 'Titolo', t: 'text', learn: 1, list: ['Sig.', 'Sig.ra', 'Dott.', 'Dott.ssa', 'Dott. Agr.', 'Ing.', 'Arch.', 'Geom.', 'Avv.', 'Prof.', 'Prof.ssa', 'Spett.le'] },
        { k: 'cognome', l: 'Cognome', t: 'text' },
        { k: 'nome', l: 'Nome / ragione sociale', t: 'text' },
        { k: 'telefono', l: 'Telefono', t: 'tel' },
        { k: 'email', l: 'Email', t: 'email' },
        { k: 'cfpiva', l: 'C.F. / P.IVA', t: 'text' },
        { k: 'codApistico', l: 'Codice apistico', t: 'text', hint: 'Anagrafe apistica: è del cliente, vale per tutte le sue pratiche.' },
        { k: 'indirizzo', l: 'Indirizzo', t: 'text' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => [r.titolo, r.cognome, r.nome].filter(Boolean).join(' '), sortKey: (r) => r.cognome ? r.cognome + ' ' + (r.nome || '') : (r.nome || ''), cols: ['telefono', 'email'], actions: [{ label: '➕ Crea pratica', show: () => true, fn: (r) => openForm('pratiche', null, { cliente: r.id }) }, { label: '📬 Mail', show: (r) => !!r.email, fn: (r) => openMailCliente(r) }].concat(gmailActions),
    },
    pratiche: {
      label: 'Pratiche', one: 'pratica', order: { k: 'scadenza', dir: 1 },
      fields: [
        { k: 'cliente', l: 'Cliente', t: 'ref', to: 'clienti' },
        { k: 'tipo', l: 'Tipo pratica', t: 'text', listFn: () => tipiPratica(), learn: 1 },
        { k: 'descrizione', l: 'Descrizione', t: 'text' },
        { k: 'scadenza', l: 'Scadenza', t: 'date' },
        { k: 'stato', l: 'Stato', t: 'select', opts: STATI_PRATICA, def: 'Da avviare', req: 1 },
        { k: 'compenso', l: 'Compenso (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => (r.tipo || 'Pratica') + (r.cliente ? ' – ' + lab('clienti', r.cliente) : ''),
      cols: ['descrizione', 'scadenza', 'compenso'], statoPill: { k: 'stato', opts: STATI_PRATICA },
      isDone: (r) => r.stato === 'Consegnata' || r.stato === 'Chiusa',
      events: (r) => (r.scadenza ? [{ date: r.scadenza, title: 'Pratica ' + r.tipo + (r.cliente ? ' – ' + lab('clienti', r.cliente) : ''), description: r.descrizione }] : []),
      doneLabel: 'Chiuse',
      detail: (r) => '#/professione/pratica/' + r.id,
      extra: (r) => { const e = pratEco(r); return e.dovuto > 0 ? ['Incassato ' + L.eur(e.incassato) + ' su ' + L.eur(e.dovuto)] : []; },
      deleteWarn: 'Eliminare la pratica con pagamenti, spese, preventivi e documenti collegati?',
      onDelete: (r) => { for (const k of PRAT_FIGLI) { rows(k).filter((x) => x.pratica === r.id).forEach((x) => tombstone(k, x.id)); db.data[k] = rows(k).filter((x) => x.pratica !== r.id); } },
      actions: [{ label: '✓ Consegnata', show: (r) => !['Consegnata', 'Chiusa'].includes(r.stato), run: (r) => { r.stato = 'Consegnata'; } }, { label: '↩ Riapri', show: (r) => ['Consegnata', 'Chiusa'].includes(r.stato), run: (r) => { r.stato = 'In corso'; } }, { label: '⧉ Duplica', show: () => true, fn: (r) => duplicaPratica(r) }],
    },
    pagamenti: {
      label: 'Pagamenti pratica', one: 'pagamento', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'pratica', l: 'Pratica', t: 'ref', to: 'pratiche' },
        { k: 'data', l: 'Data', t: 'date', def: 'today' },
        { k: 'tipo', l: 'Tipo', t: 'select', opts: ['Acconto', 'Pagamento parziale', 'Saldo', 'Rimborso spese'], def: 'Acconto' },
        { k: 'importo', l: 'Importo (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'metodo', l: 'Metodo', t: 'select', opts: ['Bonifico', 'Contanti', 'Carta', 'Assegno'] },
        { k: 'nota', l: 'Nota', t: 'text' }],
      title: (r) => (r.tipo || 'Pagamento') + ' – ' + lab('pratiche', r.pratica), cols: ['data', 'importo'],
      dlg: { name: (r) => (r.tipo || 'pagamento').toLowerCase(), hide: ['pratica'], chips: ['tipo', 'metodo'], rows: [['importo', 'data']], focus: 'importo' },
    },
    spesePratica: {
      label: 'Spese pratica', one: 'spesa della pratica', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'pratica', l: 'Pratica', t: 'ref', to: 'pratiche' },
        { k: 'data', l: 'Data', t: 'date', def: 'today' },
        { k: 'descrizione', l: 'Descrizione (es. marche da bollo, visure, trasferta)', t: 'text' },
        { k: 'importo', l: 'Importo (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'rimborsabile', l: 'Da rimborsare dal cliente', t: 'checkbox', def: true },
        { k: 'nota', l: 'Nota', t: 'text' }],
      title: (r) => (r.descrizione || 'Spesa') + ' – ' + lab('pratiche', r.pratica), cols: ['data', 'importo'],
      dlg: { name: () => 'spesa', hide: ['pratica'], rows: [['importo', 'data']], focus: 'descrizione' },
    },
    preventivi: {
      label: 'Preventivi', one: 'preventivo', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'pratica', l: 'Pratica', t: 'ref', to: 'pratiche' },
        { k: 'numero', l: 'Numero / titolo', t: 'text' },
        { k: 'data', l: 'Data', t: 'date', def: 'today' },
        { k: 'importo', l: 'Importo (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'stato', l: 'Stato', t: 'select', opts: ['Bozza', 'Inviato', 'Accettato', 'Rifiutato'], def: 'Bozza' },
        { k: 'url', l: 'Link al file (cloud)', t: 'text' },
        { k: 'nota', l: 'Nota', t: 'textarea' }],
      title: (r) => 'Preventivo ' + (r.numero || '') + ' – ' + lab('pratiche', r.pratica), cols: ['data', 'importo', 'stato'],
      dlg: { name: () => 'preventivo', hide: ['pratica'], chips: ['stato'], rows: [['numero', 'data'], ['importo', 'stato']], focus: 'numero' },
    },
    documenti: {
      label: 'Documenti e cartelle', one: 'documento / cartella', order: { k: 'titolo', dir: 1 },
      fields: [
        { k: 'pratica', l: 'Pratica', t: 'ref', to: 'pratiche' },
        { k: 'titolo', l: 'Titolo', t: 'text' },
        { k: 'tipo', l: 'Tipo', t: 'select', opts: ['Cartella cloud', 'Incarico / contratto', 'Documento', 'Fattura', 'Altro'], def: 'Cartella cloud' },
        { k: 'url', l: 'Link (Drive, iCloud, Dropbox, OneDrive…)', t: 'text' },
        { k: 'nota', l: 'Nota', t: 'text' }],
      title: (r) => (r.titolo || 'Documento') + ' – ' + lab('pratiche', r.pratica), cols: ['tipo', 'url'],
      dlg: { name: (r) => (r.tipo === 'Cartella cloud' ? 'cartella cloud' : 'documento'), hide: ['pratica'], chips: ['tipo'], focus: 'titolo' },
    },
    denunce: {
      label: 'Denunce apistiche', one: 'denuncia', order: { k: 'anno', dir: 1 },
      fields: [
        { k: 'pratica', l: 'Pratica', t: 'ref', to: 'pratiche' },
        { k: 'anno', l: 'Anno', t: 'number', step: '1' },
        { k: 'importo', l: 'Importo (€)', t: 'number', step: '0.01', fmt: 'eur', def: 40 },
        { k: 'pagato', l: 'Pagato', t: 'checkbox' },
        { k: 'dataAgg', l: 'Data aggiornamento', t: 'date', hint: 'Facoltativa: puoi inserirla in un secondo momento.' },
        { k: 'nota', l: 'Note pagamento', t: 'text' }],
      title: (r) => 'Denuncia ' + (r.anno || '') + ' – ' + lab('pratiche', r.pratica), cols: ['anno', 'importo'],
      dlg: { name: () => 'denuncia', hide: ['pratica'], rows: [['anno', 'importo'], ['dataAgg', 'pagato']], focus: 'anno' },
    },
    fatture: {
      label: 'Fatture', one: 'fattura', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'numero', l: 'Numero', t: 'text', req: 1 },
        { k: 'data', l: 'Data fattura', t: 'date', req: 1, def: 'today' },
        { k: 'cliente', l: 'Cliente', t: 'ref', to: 'clienti' },
        { k: 'importo', l: 'Importo (€)', t: 'number', step: '0.01', req: 1, fmt: 'eur' },
        { k: 'scadPag', l: 'Scadenza pagamento', t: 'date', hint: 'Facoltativa: se vuota, è 60 giorni dopo la data della fattura.' },
        { k: 'incassata', l: 'Incassata', t: 'checkbox' },
        { k: 'dataIncasso', l: 'Data incasso', t: 'date' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => 'Fattura ' + (r.numero || '') + (r.cliente ? ' – ' + lab('clienti', r.cliente) : ''),
      cols: ['data', 'importo', 'incassata'],
      extra: (r) => { const st = fattStato(r); return st ? [(st.late ? '⚠️ scaduta da ' + (-st.d) + (st.d === -1 ? ' giorno' : ' giorni') : st.d === 0 ? '⏰ scade oggi' : 'scade tra ' + st.d + (st.d === 1 ? ' giorno' : ' giorni')) + ' (' + L.fmtDate(st.sc) + ')'] : []; },
      isDone: (r) => !!r.incassata,
      events: (r) => (!r.incassata && scadFatt(r) ? [{ date: scadFatt(r), title: 'Incasso fattura ' + r.numero + ' (' + L.eur(r.importo) + ')' + (r.cliente ? ' – ' + lab('clienti', r.cliente) : '') }] : []),
      actions: [{ label: '€ Incassata', show: (r) => !r.incassata, run: (r) => { r.incassata = true; r.dataIncasso = L.today(); } }],
    },
    classi: {
      label: 'Classi', one: 'classe', order: { k: 'nome', dir: 1 },
      fields: [
        { k: 'nome', l: 'Classe', t: 'text', req: 1 },
        { k: 'scuola', l: 'Scuola', t: 'text' },
        { k: 'materia', l: 'Materie (separate da virgola)', t: 'text', list: ['Genio Rurale', 'Industrie agrarie', 'Genio Rurale, Industrie agrarie'] },
        { k: 'ore', l: 'Ore settimanali', t: 'number', step: '1' },
        { k: 'coordinatore', l: 'Sono il coordinatore', t: 'checkbox' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => r.nome + (r.scuola ? ' – ' + r.scuola : ''), cols: ['materia', 'ore', 'coordinatore'],
      extra: (r) => { const n = rows('studenti').filter((x) => x.classe === r.id).length; return n ? [n + ' studenti'] : []; },
      actions: [{ label: '👥 Studenti e voti', show: () => true, go: (r) => '#/scuola/classe/' + r.id }],
      deleteWarn: 'Eliminare la classe, i suoi studenti, le verifiche e tutte le valutazioni?',
      onDelete: (r) => {
        const sids = new Set(rows('studenti').filter((x) => x.classe === r.id).map((x) => x.id));
        const vids = new Set(rows('verifiche').filter((x) => x.classe === r.id).map((x) => x.id));
        dropWhere('valutazioni', (x) => sids.has(x.studente) || vids.has(x.verifica));
        dropWhere('studenti', (x) => x.classe === r.id); dropWhere('verifiche', (x) => x.classe === r.id);
      },
    },
    attivita: {
      label: 'Contatti registrati', one: 'contatto', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'azienda', l: 'Azienda', t: 'ref', to: 'aziende', req: 1 },
        { k: 'tipo', l: 'Tipo', t: 'select', opts: ['Contattata', 'Ispezione fissata', 'Chiamata', 'Email', 'Messaggio', 'Visita', 'Nota'], req: 1 },
        { k: 'data', l: 'Data', t: 'date', def: 'today' },
        { k: 'testo', l: 'Cosa ci siamo detti', t: 'textarea' }],
      title: (r) => (r.tipo || 'Contatto') + ' – ' + lab('aziende', r.azienda), cols: ['azienda', 'tipo', 'data'],
    },
    movimenti: {
      label: 'Movimenti', one: 'movimento', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'tipo', l: 'Tipo', t: 'select', opts: ['Uscita', 'Entrata', 'Prelievo'], req: 1 },
        { k: 'data', l: 'Data', t: 'date', req: 1, def: 'today' },
        { k: 'importo', l: 'Importo (€)', t: 'number', step: '0.01', req: 1, fmt: 'eur' },
        { k: 'descrizione', l: 'Descrizione', t: 'text', req: 1 },
        { k: 'categoria', l: 'Categoria', t: 'text', list: SP_CAT_ALL },
        { k: 'metodo', l: 'Pagamento', t: 'select', opts: ['Contanti', 'Carta', 'Bonifico'] },
        { k: 'veicolo', l: 'Veicolo', t: 'select', opts: SP_VEI }],
      title: (r) => (r.tipo === 'Entrata' ? '+' : r.tipo === 'Uscita' ? '−' : '') + L.eur(+r.importo || 0) + ' · ' + (r.descrizione || ''), cols: ['data', 'categoria', 'metodo'],
    },
    ricorrenti: {
      label: 'Spese ricorrenti', one: 'spesa ricorrente', order: { k: 'prossima', dir: 1 },
      fields: [
        { k: 'descrizione', l: 'Descrizione', t: 'text', req: 1 },
        { k: 'importo', l: 'Importo (€)', t: 'number', step: '0.01', req: 1, fmt: 'eur' },
        { k: 'mesi', l: 'Ogni quanti mesi', t: 'select', opts: ['1', '2', '3', '4', '6', '12'], req: 1 },
        { k: 'prossima', l: 'Prossima scadenza', t: 'date', req: 1, def: 'today' },
        { k: 'categoria', l: 'Categoria', t: 'text', list: SP_CAT },
        { k: 'metodo', l: 'Pagamento', t: 'select', opts: ['Carta', 'Bonifico', 'Contanti'] },
        { k: 'veicolo', l: 'Veicolo', t: 'select', opts: SP_VEI }],
      title: (r) => (r.descrizione || '') + ' – ' + L.eur(+r.importo || 0), cols: ['prossima', 'mesi', 'categoria'],
      events: (r) => (r.prossima ? [{ date: r.prossima, title: 'Scadenza: ' + r.descrizione + ' (' + L.eur(+r.importo || 0) + ')' }] : []),
    },
    docenti: {
      label: 'Docenti', one: 'docente', order: { k: 'nome', dir: 1 },
      fields: [
        { k: 'nome', l: 'Cognome e nome (es. Mutti Riccardo)', t: 'text', req: 1 },
        { k: 'titolo', l: 'Titolo', t: 'select', opts: ['Prof.', 'Prof.ssa'], req: 1 },
        { k: 'sdA', l: 'Dipartimento Scienze Agrarie', t: 'checkbox' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => r.nome, cols: ['titolo', 'sdA'],
      extra: (r) => { const n = rows('cattedre').filter((x) => x.docente === r.id).length; return n ? [n + (n === 1 ? ' cattedra' : ' cattedre')] : []; },
      deleteWarn: 'Eliminare il docente e le sue cattedre?',
      onDelete: (r) => dropWhere('cattedre', (x) => x.docente === r.id),
    },
    cattedre: {
      label: 'Consigli di classe', one: 'cattedra', order: { k: 'materia', dir: 1 },
      fields: [
        { k: 'classe', l: 'Classe', t: 'ref', to: 'classi', req: 1 },
        { k: 'materia', l: 'Materia', t: 'text', req: 1, listFn: () => rows('cattedre').map((x) => x.materia).filter(Boolean) },
        { k: 'docente', l: 'Docente', t: 'ref', to: 'docenti', req: 1 }],
      title: (r) => lab('classi', r.classe) + ' – ' + r.materia + (r.docente ? ' (' + lab('docenti', r.docente) + ')' : ''), cols: ['classe', 'materia', 'docente'],
    },
    verbali: {
      label: 'Verbali', one: 'verbale', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'tipo', l: 'Tipo', t: 'select', opts: ['Consiglio di classe', 'Dipartimento Scienze Agrarie'], req: 1 },
        { k: 'classe', l: 'Classe (solo per il consiglio di classe)', t: 'ref', to: 'classi' },
        { k: 'numero', l: 'Verbale n.', t: 'number', step: '1' },
        { k: 'data', l: 'Data', t: 'date', def: 'today' },
        { k: 'ora', l: 'Ora di inizio', t: 'time' },
        { k: 'oraFine', l: 'Ora di chiusura', t: 'time' },
        { k: 'luogo', l: 'Luogo', t: 'text', def: "nell'aula-informatica" },
        { k: 'segretario', l: 'Segretario', t: 'ref', to: 'docenti' },
        { k: 'coordinatore', l: 'Coordinatore', t: 'ref', to: 'docenti' },
        { k: 'presidente', l: 'Presidente (Dirigente o delegato)', t: 'text' },
        { k: 'intest1', l: 'Intestazione (riga 1)', t: 'text', def: 'ITAS "VINCENZO LUPARIA"' },
        { k: 'intest2', l: 'Intestazione (riga 2)', t: 'text', def: 'Via Luparia, 14 - ROSIGNANO M.TO (AL) - FRAZ. SAN MARTINO' },
        { k: 'istituto', l: 'Istituto (nel testo)', t: 'text', def: 'Istituto Superiore “V. LUPARIA”' },
        { k: 'citta', l: 'Città', t: 'text', def: 'SAN MARTINO DI ROSIGNANO' }],
      title: (r) => (r.tipo === 'Dipartimento Scienze Agrarie' ? 'Dipartimento Sc. Agrarie' : 'CdC ' + (lab('classi', r.classe) || '')) + ' – verbale n. ' + (r.numero || '?'),
      cols: ['tipo', 'data'], detail: (r) => '#/scuola/verbale/' + r.id,
    },
    figlie: {
      label: 'Figlie', one: 'figlia', order: { k: 'nome', dir: 1 },
      fields: [
        { k: 'nome', l: 'Nome', t: 'text', req: 1 },
        { k: 'nascita', l: 'Data di nascita', t: 'date' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => r.nome || 'Figlia', cols: ['nascita'],
      onDelete: (r) => { for (const d of rows('diario')) if (d.figlia === r.id) { d.figlia = ''; d.updated = NOW(); } },
    },
    diario: {
      label: 'Diario', one: 'annotazione', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'data', l: 'Data', t: 'date', def: 'today', req: 1 },
        { k: 'figlia', l: 'Figlia', t: 'ref', to: 'figlie', hint: 'Vuoto = riguarda tutte.' },
        { k: 'categoria', l: 'Categoria', t: 'text', list: ['Salute', 'Scuola', 'Crescita', 'Sport e attività', 'Momenti', 'Documenti', 'Spese', 'Altro'], learn: 1 },
        { k: 'titolo', l: 'Titolo', t: 'text' },
        { k: 'testo', l: 'Annotazione', t: 'textarea' }],
      dlg: { name: () => 'annotazione', wide: true, focus: 'testo', rows: [['data', 'figlia'], ['categoria', 'titolo']], sections: { data: 'Quando e chi', testo: 'Cosa è successo' } },
      title: (r) => r.titolo || r.categoria || 'Annotazione', cols: ['data', 'figlia', 'categoria'],
    },
    riunioni: {
      label: 'Dipartimento', one: 'riunione di dipartimento', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'data', l: 'Data', t: 'date', def: 'today', req: 1 },
        { k: 'ora', l: 'Ora', t: 'time' },
        { k: 'luogo', l: 'Luogo', t: 'text', list: ["Aula informatica", "Aula magna", "Online"], learn: 1 },
        { k: 'stato', l: 'Stato', t: 'select', opts: ['Programmata', 'Svolta'], def: 'Programmata' },
        { k: 'odg', l: 'Ordine del giorno', t: 'textarea', hint: 'Un punto per riga.' },
        { k: 'decisioni', l: 'Decisioni / compiti', t: 'textarea' },
        { k: 'link', l: 'Link a documenti (facoltativo)', t: 'url' },
        { k: 'verbale', l: 'Verbale collegato', t: 'ref', to: 'verbali' }],
      dlg: { name: () => 'riunione di dipartimento', wide: true, focus: 'data', skip: ['verbale'], rows: [['data', 'ora'], ['luogo', 'stato']], sections: { data: 'Riunione', odg: 'Contenuto', link: 'Documenti' } },
      title: (r) => 'Dipartimento Sc. Agrarie – ' + (r.data ? L.fmtDate(r.data) : ''), cols: ['data', 'stato', 'luogo'],
    },
    appunti: {
      label: 'Appunti', one: 'pagina di appunti', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'titolo', l: 'Titolo', t: 'text', hint: 'Es. «Appunti 3ª – A1 Gli angoli e la loro misura».' },
        { k: 'link', l: 'Link alla pagina', t: 'url', hint: 'Incolla l’indirizzo del documento (Claude, Drive, Notion…).' },
        { k: 'classe', l: 'Classe', t: 'ref', to: 'classi' },
        { k: 'materia', l: 'Materia', t: 'text', list: ['Genio Rurale', 'Industrie agrarie'], learn: 1 },
        { k: 'argomento', l: 'Unità / argomento', t: 'text', hint: 'Es. «A1 – Gli angoli».' },
        { k: 'tipo', l: 'Tipo', t: 'text', list: ['Appunti', 'Esercizi', 'Verifica', 'Scheda', 'Slide', 'Laboratorio'], learn: 1 },
        { k: 'data', l: 'Data', t: 'date', def: 'today' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      dlg: { name: () => 'pagina di appunti', wide: true, focus: 'titolo', rows: [['classe', 'materia'], ['argomento', 'tipo']], sections: { titolo: 'Pagina', classe: 'Classificazione', note: 'Note' } },
      title: (r) => r.titolo || r.argomento || 'Appunti', cols: ['classe', 'materia', 'tipo', 'data'],
      actions: [{ label: '📖 Apri', show: (r) => !!r.link, fn: (r) => window.open(r.link, '_blank', 'noopener') }],
    },
    studenti: {
      label: 'Studenti', one: 'studente', order: { k: 'nome', dir: 1 },
      fields: [
        { k: 'classe', l: 'Classe', t: 'ref', to: 'classi', req: 1 },
        { k: 'nome', l: 'Cognome e nome', t: 'text', req: 1 },
        { k: 'tag', l: 'H / DSA', t: 'select', opts: ['H', 'DSA'] }],
      title: (r) => r.nome, cols: ['classe', 'tag'],
    },
    verifiche: {
      label: 'Verifiche', one: 'verifica', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'classe', l: 'Classe', t: 'ref', to: 'classi', req: 1 },
        { k: 'titolo', l: 'Verifica (es. V01T)', t: 'text', req: 1 },
        { k: 'data', l: 'Data', t: 'date', def: 'today' },
        { k: 'materia', l: 'Materia', t: 'select', opts: ['Genio Rurale', 'Industrie agrarie'] },
        { k: 'periodo', l: 'Periodo', t: 'select', opts: ['Trimestre', 'Pentamestre'] },
        { k: 'parti', l: 'Parti e punti massimi', t: 'parts' },
        { k: 'vmin', l: 'Voto minimo (con 0 punti)', t: 'number', step: '0.5', def: 3 },
        { k: 'vmax', l: 'Voto massimo (con tutti i punti)', t: 'number', step: '0.5', def: 9 },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => (r.titolo || 'Verifica') + (r.classe ? ' – ' + lab('classi', r.classe) : '') + ' · ' + matShort(matOf(r)),
      cols: ['data', 'materia', 'periodo'],
      extra: (r) => ['Totale ' + L.num(maxTot(r)) + ' punti · voto ' + fmt1(rng(r).min) + '–' + fmt1(rng(r).max)],
      actions: [{ label: '✏️ Correggi', show: () => true, go: (r) => '#/scuola/correggi/' + r.id }],
      onDelete: (r) => dropWhere('valutazioni', (x) => x.verifica === r.id),
    },
    valutazioni: { label: 'Valutazioni', one: 'valutazione', order: { k: 'updated', dir: -1 }, fields: [], title: () => 'Valutazione', cols: [] },
    impegni: {
      label: 'Impegni', one: 'impegno', order: { k: 'data', dir: 1 },
      fields: [
        { k: 'titolo', l: 'Titolo', t: 'text', req: 1 },
        { k: 'tipo', l: 'Tipo', t: 'text', list: ['Consiglio di classe', 'Scrutinio', 'Collegio docenti', 'Programmazione', 'Verifica', 'Colloqui', 'Uscita didattica', 'Altro'] },
        { k: 'classe', l: 'Classe', t: 'ref', to: 'classi' },
        { k: 'data', l: 'Data', t: 'date', req: 1, def: 'today' },
        { k: 'ora', l: 'Ora', t: 'time' },
        { k: 'luogo', l: 'Luogo', t: 'text' },
        { k: 'stato', l: 'Stato', t: 'select', opts: ['Da fare', 'Fatto'], def: 'Da fare', req: 1 },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => r.titolo, cols: ['tipo', 'classe', 'data', 'ora'],
      isDone: (r) => r.stato === 'Fatto',
      events: (r) => (r.data ? [{ date: r.data, time: r.ora, title: r.titolo + (r.classe ? ' – ' + lab('classi', r.classe) : ''), location: r.luogo, description: r.note }] : []),
      actions: [{ label: '✓ Fatto', show: (r) => r.stato !== 'Fatto', run: (r) => { r.stato = 'Fatto'; } }],
    },
    promemoria: {
      label: 'Promemoria', one: 'promemoria', order: { k: 'data', dir: 1 },
      fields: [
        { k: 'titolo', l: 'Cosa ricordare', t: 'text', req: 1 },
        { k: 'area', l: 'Area', t: 'select', opts: ['Personale', 'Campagna', 'Casa e cascina', 'Ispezioni', 'Professione', 'Scuola'] },
        { k: 'data', l: 'Data', t: 'date' },
        { k: 'ora', l: 'Ora', t: 'time' },
        { k: 'priorita', l: 'Priorità', t: 'select', opts: ['Normale', 'Alta'], def: 'Normale', req: 1 },
        { k: 'stato', l: 'Stato', t: 'select', opts: ['Da fare', 'Fatto'], def: 'Da fare', req: 1 },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => (r.priorita === 'Alta' ? '❗ ' : '') + r.titolo, cols: ['area', 'data', 'ora'],
      isDone: (r) => r.stato === 'Fatto',
      events: (r) => (r.data ? [{ date: r.data, time: r.ora, title: r.titolo, description: r.note }] : []),
      actions: [{ label: '✓ Fatto', show: (r) => r.stato !== 'Fatto', run: (r) => { r.stato = 'Fatto'; } }],
    },
  };

  const MODS = [
    { id: 'oggi', label: 'Oggi', icon: '📅' },
    { id: 'campagna', label: 'Campagna', icon: '🌱', ents: ['trattamenti', 'concimazioni', 'raccolte', 'parcelle', 'magazzino'] },
    { id: 'casa', label: 'Casa e cascina', icon: '🏠', ents: ['manutenzioni'] },
    { id: 'ispezioni', label: 'Ispezioni', icon: '📋', ents: ['periodi', 'aziende', 'ispezioni', 'noteSpese'] },
    { id: 'professione', label: 'Professione', icon: '💼', ents: ['pratiche', 'clienti', 'fatture', 'versamenti'] },
    { id: 'scuola', label: 'Scuola', icon: '🎓', ents: ['impegni', 'classi', 'appunti', 'riunioni', 'verifiche', 'verbali', 'docenti', 'cattedre'] },
    { id: 'figlie', label: 'Figlie', icon: '👧', ents: ['diario', 'figlie'] },
    { id: 'spese', label: 'Spese', icon: '💶', ents: ['movimenti', 'ricorrenti'] },
    { id: 'promemoria', label: 'Promemoria', icon: '🔔', ents: ['promemoria'] },
    { id: 'impostazioni', label: 'Impostazioni', icon: '⚙️' },
  ];

  /* ---------- Stato e persistenza ---------- */
  function normalize(o) {
    o = o && typeof o === 'object' ? o : {};
    o.version = 1;
    o.settings = Object.assign({ alarmDays: 1, alarmTime: '09:00', durationMin: 60, soglia: 85000, calFeed: false, partenza: 'San Salvatore Monferrato' }, o.settings);
    o.data = o.data && typeof o.data === 'object' ? o.data : {};
    for (const c of (o.data.classi || [])) if (/^3[AB]$/.test(String(c.nome || '').toUpperCase().replace(/[^0-9A-Z]/g, '')) && /^\s*genio rurale\s*$/i.test(c.materia || '')) { c.materia = 'Genio Rurale, Industrie agrarie'; c.updated = new Date().toISOString(); }
    o.meta = Object.assign({ lastPull: '', lastPush: '', lastSync: '', feedHash: '', feedAt: '', deleted: [] }, o.meta);
    if (!Array.isArray(o.meta.deleted)) o.meta.deleted = [];
    const now = new Date().toISOString();
    for (const k of Object.keys(ENT)) {
      o.data[k] = Array.isArray(o.data[k]) ? o.data[k] : [];
      for (const r of o.data[k]) if (!r.updated) r.updated = now;
    }
    // migrazione: trimestre (testo) -> periodo; stato "Eseguita" -> "Svolta"
    const byTri = {};
    for (const ek of ['piano', 'ispezioni']) for (const r of o.data[ek]) {
      if (r.periodo || !r.trimestre) continue;
      let pid = byTri[r.trimestre];
      if (!pid) {
        const q = L.quarterFromText(r.trimestre, 0), av = L.quarterStart(q), ch = L.quarterEnd(q);
        const ex = q && o.data.periodi.find((x) => x.avvio === av && x.chiusura === ch);
        if (ex) pid = ex.id; else { pid = uid(); o.data.periodi.push({ id: pid, anno: q ? q.y : new Date().getFullYear(), avvio: av, chiusura: ch, updated: now }); }
        byTri[r.trimestre] = pid;
      }
      r.periodo = pid; r.updated = now;
    }
    for (const r of o.data.ispezioni) if (r.stato === 'Eseguita') { r.stato = 'Svolta'; r.updated = now; }
    return o;
  }
  let db;
  try { db = normalize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { db = normalize({}); }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Salvataggio non riuscito (spazio pieno?). Esporta un backup.'); } }
  function save() { persist(); scheduleSync(); }
  function tombstone(ek, id) { if (synced(ek)) db.meta.deleted.push({ id, entity: ek, updated: new Date().toISOString() }); }
  const rows = (ek) => db.data[ek];
  const byId = (ek, id) => rows(ek).find((r) => r.id === id);
  const sum = (list, k) => list.reduce((a, r) => a + (+r[k] || 0), 0);
  const fieldOf = (ent, k) => ent.fields.find((f) => f.k === k);
  const year = () => String(new Date().getFullYear());

  /* ---------- Eventi (scadenze) ---------- */
  function eventsOf(ek, r) {
    const ent = ENT[ek]; if (!ent.events) return [];
    return ent.events(r).filter((e) => e.date).map((e, i) => Object.assign({}, e, {
      uid: ek + '-' + r.id + '-' + i + '@gestionale-agronomo', entKey: ek, id: r.id, done: !!(ent.isDone && ent.isDone(r)),
    }));
  }
  function allEvents() { return Object.keys(ENT).flatMap((ek) => rows(ek).flatMap((r) => eventsOf(ek, r))); }
  const cmpEv = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
  const icsOpts = () => ({ alarmDays: db.settings.alarmDays, alarmTime: db.settings.alarmTime, durationMin: db.settings.durationMin });

  async function deliver(text, name, mime) {
    const file = new File([text], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const exportICS = (events, name) => {
    if (!events.length) return toast('Nessuna scadenza da esportare');
    deliver(L.buildICS(events, icsOpts()), name, 'text/calendar');
  };

  /* ---------- Visualizzazione valori ---------- */
  function disp(f, v) {
    if (v == null || v === '') return '';
    if (f.t === 'date') return L.fmtDate(v);
    if (f.t === 'ref') return lab(f.to, v);
    if (f.t === 'checkbox') return v ? 'Sì' : '';
    if (f.t === 'parts') return Array.isArray(v) ? v.map((p) => p.name + ' ' + p.max).join(', ') : '';
    if (f.t === 'number') return f.fmt === 'eur' ? L.eur(v) : L.num(v);
    return String(v);
  }
  function relBadge(date) {
    const d = L.diffDays(L.today(), date);
    if (d < 0) return h('span', { class: 'badge late' }, 'Scaduto da ' + -d + ' gg');
    if (d === 0) return h('span', { class: 'badge late' }, 'Oggi');
    return h('span', { class: 'badge' }, d === 1 ? 'Domani' : 'Tra ' + d + ' gg');
  }

  /* ---------- Form ---------- */
  function openForm(ek, rec, preset) {
    const ent = ENT[ek]; const isNew = !rec;
    const r = rec ? Object.assign({}, rec) : Object.assign({ id: uid() }, preset);
    if (ek === 'ispezioni' && rec && daFissare(rec)) r.data = ''; // 31/12 = solo termine del periodo, non una data fissata
    if (isNew) for (const f of ent.fields) if (r[f.k] == null && f.def != null) r[f.k] = f.def === 'today' ? L.today() : f.def;
    const dlg = document.getElementById('dlg'); dlg.replaceChildren();
    const inputs = {};
    const D = ent.dlg || null, wrap = {};
    const form = h('form', { class: 'dlg-in' + (D ? ' dlg-c' : ''), method: 'dialog' }, h('h2', {}, D ? (isNew ? 'Nuovo ' : 'Modifica ') + D.name(r) : (isNew ? 'Nuovo: ' : 'Modifica: ') + ent.one),
      D && r.pratica && byId('pratiche', r.pratica) ? h('p', { class: 'dlg-ctx' }, '📁 ' + ENT.pratiche.title(byId('pratiche', r.pratica))) : null);
    for (const f of ent.fields) {
      let el;
      const val = r[f.k];
      if (f.t === 'textarea') { el = h('textarea', { name: f.k }); el.value = val || ''; }
      else if (f.t === 'select') {
        el = h('select', { name: f.k }, !f.req && h('option', { value: '' }, '—'), f.opts.map((o) => h('option', { value: o }, o)));
        el.value = val != null ? val : (f.req ? f.opts[0] : '');
      } else if (f.t === 'ref') {
        const opts = rows(f.to).slice().sort((a, b) => ENT[f.to].title(a).localeCompare(ENT[f.to].title(b), 'it'));
        el = h('select', { name: f.k }, h('option', { value: '' }, opts.length ? '—' : '(prima crea: ' + ENT[f.to].label.toLowerCase() + ')'),
          opts.map((o) => h('option', { value: o.id }, ENT[f.to].title(o))));
        el.value = val || '';
      } else if (f.t === 'parts') {
        const parts = (Array.isArray(val) && val.length ? val : defParts()).map((p) => Object.assign({}, p));
        el = h('div', { class: 'parts' }); el.partsData = parts;
        const draw = () => el.replaceChildren(...parts.map((p, i) => h('div', { class: 'part' },
          h('input', { type: 'text', value: p.name, 'aria-label': 'Nome parte', oninput: (e) => { p.name = e.target.value; } }),
          h('input', { type: 'number', step: '0.25', min: '0', value: p.max, 'aria-label': 'Punti massimi', oninput: (e) => { p.max = parseFloat(e.target.value.replace(',', '.')) || 0; } }),
          btn('✕', () => { if (parts.length > 1) { parts.splice(i, 1); draw(); } }))),
        btn('+ Aggiungi parte', () => { parts.push({ id: uid(), name: 'Parte ' + (parts.length + 1), max: 5 }); draw(); }));
        draw();
      } else if (f.t === 'doc') {
        el = h('div', { class: 'docf' }); const st = el.docState = { meta: val && val.name ? val : '', file: null };
        const inp = h('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true, onchange: () => { const fl = inp.files[0]; if (!fl) return; if (fl.size > 15 * 1024 * 1024) { inp.value = ''; return toast('File troppo grande (max 15 MB)'); } st.file = fl; st.meta = { name: fl.name, size: fl.size, type: fl.type }; drawD(); } });
        const drawD = () => el.replaceChildren(inp, st.meta ? h('div', { class: 'docf-i' }, h('span', { class: 't' }, '📎 ' + st.meta.name, h('small', {}, ' ' + Math.max(1, Math.round((st.meta.size || 0) / 1024)) + ' KB')),
          !st.file ? btn('Apri', () => openDoc(r.id + ':' + f.k, st.meta), '') : null, btn('Sostituisci', () => inp.click(), ''), btn('✕', () => { st.meta = ''; st.file = null; st.del = true; drawD(); }, '')) : h('div', { class: 'docf-i' }, btn('📎 Allega PDF o foto', () => inp.click(), ''), h('small', {}, 'Resta salvato su questo dispositivo')));
        drawD();
      } else if (f.t === 'checkbox') { el = h('input', { type: 'checkbox', name: f.k }); el.checked = !!val; }
      else {
        el = h('input', { type: f.t === 'number' ? 'number' : f.t, name: f.k, step: f.step, inputmode: f.t === 'number' ? 'decimal' : null, autocomplete: 'off' });
        el.value = val != null ? val : '';
        let list = f.list || (f.listFn && f.listFn());
        if (f.learn) list = [...(list || []), ...learnedOf(ek, f.k), ...rows(ek).map((x) => (x[f.k] || '').trim()).filter(Boolean)];
        if (list && list.length) {
          const id = 'dl-' + f.k; el.setAttribute('list', id);
          form.append(h('datalist', { id }, [...new Set(list)].map((o) => h('option', { value: o }))));
        }
      }
      inputs[f.k] = el;
      if (D && D.skip && D.skip.includes(f.k)) { el.hidden = true; form.append(el); continue; }
      if (D && D.hide && D.hide.includes(f.k) && r[f.k]) { el.hidden = true; form.append(el); continue; }
      let ctl = el;
      if (D && D.chips && D.chips.includes(f.k) && f.t === 'select') {
        el.hidden = true; const box = h('div', { class: 'chips dlg-chips' }), drawC = () => box.replaceChildren(...f.opts.map((o) => h('button', { type: 'button', class: 'chip' + (el.value === o ? ' on' : ''), onclick: () => { el.value = el.value === o && !f.req ? '' : o; drawC(); } }, o)));
        drawC(); ctl = h('div', {}, el, box);
      } else if (f.fmt === 'eur') ctl = h('div', { class: 'money' }, h('span', {}, '€'), el);
      else if (f.t === 'checkbox') ctl = h('label', { class: 'api-sw' }, el, h('span', {}, f.l));
      const fl = h('div', { class: 'fld' + (f.t === 'checkbox' ? ' chk' : '') }, f.t === 'checkbox' ? null : h('label', { for: 'f-' + f.k }, f.l + (f.req ? ' *' : '')), (el.id = 'f-' + f.k, ctl), f.hint ? h('small', {}, f.hint) : null);
      wrap[f.k] = fl; form.append(fl);
    }
    if (D && D.rows) for (const pair of D.rows) { const ws = pair.map((k) => wrap[k]).filter(Boolean); if (ws.length === 2) { const row = h('div', { class: 'fld-row' }); ws[0].before(row); row.append(...ws); } }
    if (D && D.sections) for (const k of Object.keys(D.sections)) { const w = wrap[k]; if (!w) continue; const t = w.parentElement && w.parentElement.classList.contains('fld-row') ? w.parentElement : w; t.before(h('h4', { class: 'dlg-sec' }, D.sections[k])); }
    dlg.classList.toggle('wide', !!(D && D.wide));
    const close = () => dlg.close();
    form.append(h('div', { class: 'dlg-btns' },
      !isNew && h('button', { type: 'button', class: 'del', onclick: () => {
        if (!confirm(ent.deleteWarn || 'Eliminare questo elemento?')) return;
        if (ent.onDelete) ent.onDelete(r); tombstone(ek, r.id); db.data[ek] = rows(ek).filter((x) => x.id !== r.id); save(); close(); route(); toast('Eliminato');
      } }, 'Elimina'),
      h('button', { type: 'button', onclick: close }, 'Annulla'),
      h('button', { type: 'submit', class: 'pri' }, 'Salva')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      for (const f of ent.fields) {
        const el = inputs[f.k];
        if (f.t === 'doc') { r[f.k] = el.docState.meta || ''; continue; }
        let v = f.t === 'checkbox' ? el.checked : f.t === 'parts' ? el.partsData.map((p) => ({ id: p.id, name: String(p.name).trim() || 'Parte', max: Number(p.max) || 0 })) : el.value.trim();
        if (f.t === 'number') v = v === '' ? '' : Number(v);
        if (f.req && (v === '' || v == null)) { el.focus(); return toast('Compila: ' + f.l); }
        r[f.k] = v; if (f.learn && v) learn(ek, f.k, v);
      }
      r.updated = new Date().toISOString();
      const i = rows(ek).findIndex((x) => x.id === r.id);
      if (i >= 0) rows(ek)[i] = r; else rows(ek).push(r);
      save(); close(); route(); toast('Salvato');
      for (const f of ent.fields) if (f.t === 'doc') {
        const st = inputs[f.k].docState, key = r.id + ':' + f.k;
        if (st.file) { FILES.put(key, st.file).then(() => { try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* niente */ } }).catch(() => toast('Non sono riuscito ad archiviare il file su questo dispositivo')); }
        else if (st.del) FILES.del(key);
      }
    });
    dlg.append(form); dlg.showModal();
    if (D && D.focus && inputs[D.focus] && isNew) setTimeout(() => { try { inputs[D.focus].focus(); } catch (e) { /* niente */ } }, 30);
  }

  function showText(title, text, note) {
    const dlg = document.getElementById('dlg'); dlg.replaceChildren();
    const ta = h('textarea', { readonly: true, style: 'min-height:220px' }); ta.value = text;
    dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, title), ta,
      h('p', { class: 'note' }, note || 'Incolla nell\'app Promemoria: di norma crea una voce per ogni riga.'),
      h('div', { class: 'dlg-btns' },
        h('button', { type: 'button', onclick: () => dlg.close() }, 'Chiudi'),
        h('button', { type: 'button', class: 'pri', onclick: async () => {
          try { await navigator.clipboard.writeText(text); toast('Copiato'); } catch (e) { ta.select(); toast('Seleziona e copia'); }
        } }, 'Copia'))));
    dlg.showModal();
  }

  /* ---------- Ispezioni: Modello 22, periodi e schede azienda ---------- */
  const r2 = (x) => Math.round(x * 100) / 100;
  const azOf = (id) => byId('aziende', id) || {};
  const curQuarter = () => { const d = new Date(); return { n: Math.floor(d.getMonth() / 3) + 1, y: d.getFullYear() }; };
  function importoOf(i) {
    const c = parseFloat(i.compenso); if (isFinite(c)) return c;
    if (L.TARIFFE[i.complessita] != null) return L.TARIFFE[i.complessita];
    const a = parseFloat(azOf(i.azienda).importo); return isFinite(a) ? a : 0;
  }
  function ispCalc(i) {
    const kmT = (+i.km || 0) + (+i.kmExtra || 0), rimb = r2(kmT * L.KM_EURO), aut = +i.altreSpese || 0, somma = r2(rimb + aut), imp = importoOf(i);
    return { kmT, rimb, aut, somma, imp, tot: r2(somma + imp) };
  }
  // un'ispezione Chiusa con data fuori dal periodo non appartiene a quel periodo
  const inPer = (i, p) => i.periodo === p.id && !(i.stato === 'Chiusa' && i.data && p.avvio && p.chiusura && (i.data < p.avvio || i.data > p.chiusura));
  function periodoStats(p) {
    const list = rows('ispezioni').filter((i) => inPer(i, p)); const st = { n: list.length, tot: 0, imp: 0, somma: 0, rimb: 0, aut: 0 };
    for (const i of list) { const c = ispCalc(i); st.tot += c.tot; st.imp += c.imp; st.somma += c.somma; st.rimb += c.rimb; st.aut += c.aut; }
    for (const k of ['tot', 'imp', 'somma', 'rimb', 'aut']) st[k] = r2(st[k]);
    st.p20 = r2(st.tot * 0.2); st.epap = p.epap ? r2(st.imp * 0.04) : 0; st.accant = st.rimb;
    return st;
  }
  const CL = { 'In corso': 'info', 'In attesa': 'warn', Consegnata: 'ok', Programmata: 'info', Svolta: 'ok', 'Verbale da consegnare': 'warn', Chiusa: 'ok', 'Da registrare': 'info', Registrato: 'warn', Pagato: 'ok' };
  const pillSel = (opts, val, onch, label) => {
    const el = h('select', { class: 'pill', 'aria-label': label, onchange: (e) => { el.dataset.c = CL[e.target.value] || ''; onch(e.target.value); } }, opts.map((o) => h('option', { value: o }, o)));
    el.value = val; el.dataset.c = CL[val] || ''; return el;
  };
  const fieldOpts = (ek, k) => fieldOf(ENT[ek], k).opts;

  function openImport22(pid) {
    const dlg = document.getElementById('dlg'); dlg.replaceChildren();
    const status = h('p', { class: 'note' }, 'Scegli uno o più file .xlsx del Modello 22 (anche le integrazioni dello stesso trimestre).');
    const fileIn = h('input', { type: 'file', accept: '.xlsx', multiple: true });
    const prev = h('div'); const btns = h('div', { class: 'dlg-btns' });
    let state = null;
    const close = () => dlg.close();
    const fail = (m) => { status.textContent = m; status.style.color = 'var(--warn, #c0392b)'; };
    const findAz = (o) => rows('aziende').find((a) => (a.codice && a.codice.toUpperCase() === o.codice.toUpperCase()) || L.normName(a.ragione) === L.normName(o.ragione));
    const draw = () => {
      const q = state.q, av = L.quarterStart(q), ch = L.quarterEnd(q);
      const match = rows('periodi').find((x) => x.avvio === av && x.chiusura === ch);
      const per = h('select', { 'aria-label': 'Periodo' }, rows('periodi').slice().sort((a, b) => (b.avvio || '').localeCompare(a.avvio || '')).map((x) => h('option', { value: x.id }, ENT.periodi.title(x))),
        h('option', { value: '__new' }, 'Nuovo periodo: ' + q.n + '° trim. ' + q.y + ' (' + L.fmtDate(av) + ' – ' + L.fmtDate(ch) + ')'));
      per.value = pid || (match ? match.id : '__new');
      const inPeriodo = () => (per.value === '__new' ? null : per.value);
      const checks = [];
      const trs = state.ops.map((o) => {
        const az = findAz(o);
        const dup = az && per.value !== '__new' && (rows('piano').some((i) => i.azienda === az.id && i.periodo === per.value) || rows('ispezioni').some((i) => i.azienda === az.id && i.periodo === per.value));
        const cb = h('input', { type: 'checkbox', 'aria-label': 'Importa ' + o.ragione }); cb.checked = !dup; cb.disabled = !!dup; checks.push([cb, o]);
        return h('tr', {}, h('td', {}, cb), h('td', { class: 'nm' }, o.ragione, h('div', { class: 'note' }, [o.comune, o.codice].filter(Boolean).join(' · '))),
          h('td', {}, L.tipoDaNote(o.note)), h('td', { class: 'note' }, dup ? 'già nel periodo' : az ? 'cliente esistente' : 'NUOVO cliente'));
      });
      const nuovi = state.ops.filter((o) => !findAz(o)).length;
      status.style.color = '';
      status.textContent = state.ops.length + ' operatori da ' + state.nfile + ' file · ' + nuovi + ' nuovi clienti. Togli la spunta a chi non vuoi caricare.';
      per.onchange = draw;
      prev.replaceChildren(h('div', { class: 'fld' }, h('label', {}, 'Periodo'), per),
        h('div', { class: 'scroll', style: 'max-height:40vh' }, h('table', { class: 'g', style: 'min-width:0' }, h('tbody', {}, trs))));
      btns.replaceChildren(h('button', { type: 'button', onclick: close }, 'Annulla'),
        h('button', { type: 'button', class: 'pri', onclick: () => {
          const sel = checks.filter(([cb]) => cb.checked).map(([, o]) => o);
          if (!sel.length) return fail('Nessun operatore selezionato: metti almeno una spunta.');
          const now = NOW(); let pId = inPeriodo();
          if (!pId) { pId = uid(); rows('periodi').push({ id: pId, anno: q.y, avvio: av, chiusura: ch, updated: now }); }
          let na = 0, ni = 0;
          for (const o of sel) {
            let az = findAz(o);
            if (!az) { az = { id: uid(), ragione: o.ragione, comune: o.comune, codice: o.codice, updated: now }; rows('aziende').push(az); na++; }
            else { if (!az.codice) az.codice = o.codice; if (!az.comune && o.comune) az.comune = o.comune; az.updated = now; }
            if (rows('piano').some((i) => i.azienda === az.id && i.periodo === pId)) continue;
            rows('piano').push({ id: uid(), azienda: az.id, periodo: pId, tipo: L.tipoDaNote(o.note), campionamento: o.campionamento, note: o.note, updated: now }); ni++;
          }
          save(); close(); location.hash = '#/ispezioni/periodo/' + pId; route(); toast(ni + ' aziende nel periodo, ' + na + ' nuove');
        } }, 'Carica nel periodo'));
    };
    fileIn.addEventListener('change', async () => {
      try {
        if (typeof DecompressionStream === 'undefined') throw new Error('Browser troppo vecchio: aggiorna iOS/Safari');
        const ms = [];
        for (const f of fileIn.files) ms.push(L.parseModello22(await L.xlsxCells(await f.arrayBuffer())));
        if (!ms.length) return;
        const m = L.mergeModelli(ms);
        state = { ops: m.operatori, q: m.quarter || L.quarterFromText(m.trimestre, 0) || curQuarter(), nfile: ms.length };
        draw();
      } catch (e) { fail('Errore: ' + e.message); prev.replaceChildren(); btns.replaceChildren(h('button', { type: 'button', onclick: close }, 'Chiudi')); }
    });
    btns.append(h('button', { type: 'button', onclick: close }, 'Annulla'));
    dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, '📥 Importa Modello 22'), fileIn, status, prev, btns));
    dlg.showModal();
  }

  /* ---------- Viste ---------- */
  const ui = { azf: '', com: '', q: '', dst: 'aperte', per: '', mat: '' };
  const tile = (l, v, bad) => h('div', { class: 'tile' + (bad ? ' bad' : '') }, h('b', {}, v), h('span', {}, l));
  const tiles = (arr) => h('div', { class: 'tiles' }, arr.map(([l, v, b]) => tile(l, v, b)));

  const SUMMARY = {
    campagna: () => {
      const y = year(); const inY = (ek) => rows(ek).filter((r) => (r.data || '').startsWith(y));
      return [['Superficie', L.num(sum(rows('parcelle'), 'ettari')) + ' ha'], ['Trattamenti ' + y, inY('trattamenti').length], ['Raccolto ' + y, L.num(sum(inY('raccolte'), 'kg')) + ' kg']];
    },
    ispezioni: () => {
      const y = year(); const l = rows('ispezioni').filter((r) => (r.data || '').startsWith(y));
      return [['Ispezioni ' + y, l.length], ['Km ' + y, L.num(sum(l, 'km'))], ['Compensi ' + y, L.eur(sum(l, 'compenso'))]];
    },
    scuola: () => [['Classi', rows('classi').length], ['Studenti', rows('studenti').length], ['Verifiche', rows('verifiche').length]],
    professione: () => {
      const y = year(); const f = rows('fatture');
      const inc = sum(f.filter((r) => r.incassata && (r.dataIncasso || '').startsWith(y)), 'importo');
      const soglia = +db.settings.soglia || 85000;
      return [['Incassato ' + y, L.eur(inc)], ['Da incassare', L.eur(sum(f.filter((r) => !r.incassata), 'importo'))], ['Fatture scadute', L.eur(sum(f.filter((r) => { const st = fattStato(r); return st && st.late; }), 'importo')), f.some((r) => { const st = fattStato(r); return st && st.late; })], ['Soglia forfettario', Math.round(inc / soglia * 100) + '%', inc / soglia > 0.9]];
    },
  };

  const open1 = (ek, r) => { if (ENT[ek].detail) location.hash = ENT[ek].detail(r); else openForm(ek, r); };
  function card(ek, r) {
    const ent = ENT[ek]; const done = ent.isDone && ent.isDone(r);
    const meta = [...ent.cols.map((k) => { const f = fieldOf(ent, k); const v = disp(f, r[k]); return v ? (f.t === 'checkbox' ? f.l : v) : null; }).filter(Boolean), ...(ent.extra ? ent.extra(r) : [])];
    const evs = eventsOf(ek, r);
    const next = !done && evs.filter((e) => !e.info || e.date >= L.today()).sort(cmpEv)[0];
    return h('article', { class: 'card' + (done ? ' done' : ''), tabindex: '0', onclick: () => open1(ek, r),
      onkeydown: (e) => { if (e.key === 'Enter') open1(ek, r); } },
    h('div', { class: 'card-t' + (ent.statoPill ? ' card-tp' : '') }, h('span', {}, ent.title(r) || '(senza titolo)'), ent.statoPill && (() => { const sp = ent.statoPill, el = pillSel(sp.opts, r[sp.k] || sp.opts[0], (v) => { r[sp.k] = v; r.updated = NOW(); save(); route(); }, 'Stato'); el.addEventListener('click', (ev) => ev.stopPropagation()); el.addEventListener('keydown', (ev) => ev.stopPropagation()); return el; })()),
    h('div', { class: 'card-m' }, meta.join(' · ')),
    h('div', { class: 'card-a' },
      next && relBadge(next.date),
      ek === 'clienti' && r.email && GM.ok() && (() => { const b = h('span', { class: 'badge mailb', hidden: true }); GM.chain = GM.chain.then(() => GM.unread(r.email)).then((n) => { if (n > 0) { b.textContent = '✉️ ' + (n >= 20 ? '20+' : n) + (n === 1 ? ' nuova' : ' nuove'); b.hidden = false; } }).catch(() => {}); return b; })(),
      (ent.actions || []).filter((a) => a.show(r)).map((a) => btn(a.label, () => {
        if (a.href) { window.open(a.href(r), '_blank', 'noopener'); return; }
        if (a.go) { location.hash = a.go(r); return; }
        if (a.fn) { a.fn(r); return; }
        const i = rows(ek).findIndex((x) => x.id === r.id); const copy = Object.assign({}, rows(ek)[i]);
        a.run(copy); copy.updated = new Date().toISOString(); rows(ek)[i] = copy; save(); route();
      })),
      evs.length > 0 && btn('📅 Calendario', () => exportICS(evs, ek + '-' + (ent.title(r) || 'evento').replace(/[^\w]+/g, '_').slice(0, 30) + '.ics'))));
  }

  function viewList(ek) {
    const ent = ENT[ek]; const listEl = h('div', { class: 'list' });
    const fill = () => {
      const nz = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const toks = nz(ui.q).split(/\s+/).filter(Boolean);
      let list = rows(ek).filter((r) => !ent.isDone || ui.dst === 'tutte' || (ui.dst === 'chiuse') === !!ent.isDone(r));
      if (ek === 'aziende' && ui.com) list = list.filter((r) => (r.comune || '') === ui.com);
      if (toks.length) list = list.filter((r) => { const hay = nz(ent.title(r) + ' ' + ent.fields.map((f) => disp(f, r[f.k])).join(' ')); return toks.every((t) => hay.includes(t)); });
      const { k, dir } = ent.order;
      list.sort((a, b) => {
        const av = ent.sortKey ? ent.sortKey(a) : a[k] || '', bv = ent.sortKey ? ent.sortKey(b) : b[k] || '';
        if (!av && bv) return 1; if (av && !bv) return -1;
        return String(av).localeCompare(String(bv), 'it') * dir;
      });
      listEl.replaceChildren(...(list.length ? list.map((r) => card(ek, r)) : [h('div', { class: 'empty' }, rows(ek).length ? 'Nessun risultato.' : 'Ancora nessun dato. Premi “+ Nuovo”.')]));
    };
    const bar = h('div', { class: 'bar' },
      h('input', { type: 'search', placeholder: ek === 'aziende' ? 'Cerca per nome o comune…' : 'Cerca in ' + ent.label.toLowerCase() + '…', 'aria-label': 'Cerca', value: ui.q, oninput: (e) => { ui.q = e.target.value; fill(); } }),
      ek === 'aziende' && (() => { const cs = [...new Set(rows('aziende').map((r) => r.comune).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'it')); if (!cs.length) return null;
        const s = h('select', { 'aria-label': 'Filtra per comune', onchange: (e) => { ui.com = e.target.value; fill(); } }, h('option', { value: '' }, 'Tutti i comuni'), cs.map((c) => h('option', { value: c }, c))); s.value = cs.includes(ui.com) ? ui.com : ''; if (s.value !== ui.com) ui.com = s.value; return s; })(),
      ent.isDone && (() => { const all = rows(ek), nd = all.filter((r) => ent.isDone(r)).length, box = h('div', { class: 'chips', style: 'margin:0' });
        const drawC = () => box.replaceChildren(...[['aperte', 'Aperte', all.length - nd], ['chiuse', ent.doneLabel || 'Chiuse', nd], ['tutte', 'Tutte', all.length]].map(([k, l, n]) => h('a', { class: 'chip' + (ui.dst === k ? ' on' : ''), href: '#', onclick: (e) => { e.preventDefault(); ui.dst = k; drawC(); fill(); } }, l + ' · ' + n)));
        drawC(); return box; })(),
      btn('+ Nuovo', () => openForm(ek), 'pri'));
    fill();
    return h('div', {}, bar, listEl);
  }

  /* Da incassare, diviso per categoria (tipo pratica) */
  function viewIncassi() {
    const cat = {};
    for (const p of rows('pratiche')) {
      const e = pratEco(p); let due = e.residuo;
      if (!(e.dovuto > 0)) due = r2(rows('denunce').filter((x) => x.pratica === p.id && !x.pagato).reduce((t, x) => t + (+x.importo || 0), 0));
      if (!(due > 0.004)) continue;
      const k = (p.tipo || '').trim() || 'Senza categoria';
      (cat[k] = cat[k] || { tot: 0, l: [] }).tot += due; cat[k].l.push({ p, due });
    }
    const fat = rows('fatture').filter((r) => !r.incassata && (+r.importo || 0) > 0);
    const list = Object.entries(cat).sort((a, b) => b[1].tot - a[1].tot);
    const totP = r2(list.reduce((t, [, c]) => t + c.tot, 0)), totF = r2(fat.reduce((t, r) => t + (+r.importo || 0), 0));
    if (!list.length && !fat.length) return null;
    const det = (title, tot, n, items) => h('details', { class: 'inc-c' }, h('summary', {}, h('span', { class: 't' }, title, h('span', { class: 'az-n' }, n)), h('b', {}, L.eur(r2(tot)))), h('div', { class: 'inc-l' }, items));
    return h('section', { class: 'pr-sec inc' }, h('div', { class: 'az-h' }, h('h3', {}, '💶 Da incassare per categoria')),
      list.map(([k, c]) => det(k, c.tot, c.l.length, c.l.sort((a, b) => b.due - a.due).map(({ p, due }) => h('a', { class: 'row', href: '#/professione/pratica/' + p.id }, h('span', { class: 't' }, lab('clienti', p.cliente) || '(senza cliente)', ' ', h('span', { class: 'note' }, p.stato || '')), h('b', {}, L.eur(due)))))),
      fat.length ? det('Fatture emesse non incassate', totF, fat.length, fat.sort((a, b) => scadFatt(a).localeCompare(scadFatt(b))).map((r) => h('div', { class: 'row', tabindex: '0', onclick: () => openForm('fatture', r) }, h('span', { class: 't' }, ENT.fatture.title(r), scadFatt(r) ? h('span', { class: 'note' }, (fattStato(r).late ? ' · ⚠️ scaduta ' : ' · scade ') + L.fmtDate(scadFatt(r))) : null), h('b', {}, L.eur(+r.importo || 0))))) : null,
      h('p', { class: 'note' }, 'Pratiche: ' + L.eur(totP) + ' (compenso + spese rimborsabili − incassi; per l\u2019anagrafe apistica senza compenso, denunce non pagate).' + (fat.length ? ' Le fatture sono elencate a parte: se una fattura copre una pratica già conteggiata, non sommarle.' : '')));
  }

  /* PDF unico per il commercialista: indice dei versamenti + tutte le ricevute allegate in sequenza */
  async function pdfUnico(list, titolo) {
    toast('Preparo il PDF…');
    if (!window.PDFLib) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/pdf-lib.min.js'; sc.onload = res; sc.onerror = () => rej(new Error('libreria PDF non disponibile')); document.head.append(sc); });
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const items = list.slice().sort((a, b) => (a.data || '').localeCompare(b.data || ''));
    const san = (t) => String(t == null ? '' : t).replace(/[^\x20-\x7e\u00a0-\u00ff\u20ac\u2013\u2014\u2019\u2018\u201c\u201d]/g, '?');
    const out = await PDFDocument.create(), F = await out.embedFont(StandardFonts.Helvetica), FB = await out.embedFont(StandardFonts.HelveticaBold);
    // allegati
    const att = [];
    for (const r of items) {
      const a = { r, pages: [], note: r.pdf ? '' : r.link ? 'solo link cloud' : 'senza allegato' };
      if (r.pdf) {
        try {
          const blob = await FILES.get(r.id + ':pdf'); if (!blob) throw new Error('mancante');
          const bytes = new Uint8Array(await blob.arrayBuffer()), ty = (r.pdf.type || blob.type || '').toLowerCase();
          if (ty.includes('pdf') || /\.pdf$/i.test(r.pdf.name)) { const src = await PDFDocument.load(bytes, { ignoreEncryption: true }); a.pages = await out.copyPages(src, src.getPageIndices()); }
          else { const img = /png/.test(ty) ? await out.embedPng(bytes) : await out.embedJpg(bytes); const sc = Math.min(535 / img.width, 782 / img.height, 1); a.img = { img, w: img.width * sc, hh: img.height * sc }; a.pages = [null]; }
        } catch (e) { a.note = 'allegato non unibile (' + (e.message || e) + ')'; a.pages = []; }
      }
      att.push(a);
    }
    const ROWS = 34, nIdx = Math.max(1, Math.ceil(att.length / ROWS));
    let pageNo = nIdx + 1; att.forEach((a) => { a.start = a.pages.length ? pageNo : 0; pageNo += a.pages.length; });
    const tot = r2(items.reduce((t, r) => t + (+r.importo || 0), 0)), gr = {}; items.forEach((r) => { const g = vsGruppo(r.categoria); gr[g] = (gr[g] || 0) + (+r.importo || 0); });
    const eu = (x) => L.eur(r2(x)).replace(/\s/g, ' ');
    for (let p = 0; p < nIdx; p++) {
      const pg = out.addPage([595, 842]); let y = 800;
      if (p === 0) {
        pg.drawText(san('Versamenti e spese professionali'), { x: 40, y, size: 18, font: FB }); y -= 22; pg.drawText(san(titolo + ' · generato il ' + L.fmtDate(L.today())), { x: 40, y, size: 10, font: F, color: rgb(0.35, 0.35, 0.35) }); y -= 18;
        pg.drawText(san('Totale ' + eu(tot) + '   ·   ' + Object.entries(gr).map(([k, v]) => k + ' ' + eu(v)).join('   ·   ')), { x: 40, y, size: 10, font: FB }); y -= 26;
      } else y -= 10;
      const hdr = [['N.', 40], ['Data', 62], ['Categoria / descrizione', 125], ['Importo', 435], ['Pag.', 505]];
      hdr.forEach(([t, x]) => pg.drawText(t, { x, y, size: 9, font: FB })); y -= 5; pg.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.7, color: rgb(0.2, 0.2, 0.2) }); y -= 14;
      att.slice(p * ROWS, (p + 1) * ROWS).forEach((a, i) => {
        const r = a.r, n = p * ROWS + i + 1, desc = [r.categoria, r.descrizione].filter(Boolean).join(' – ');
        pg.drawText(String(n), { x: 40, y, size: 9, font: F }); pg.drawText(san(r.data ? L.fmtDate(r.data) : ''), { x: 62, y, size: 9, font: F });
        let dd = san(desc); if (F.widthOfTextAtSize(dd, 9) > 300) { while (dd.length > 3 && F.widthOfTextAtSize(dd + '...', 9) > 300) dd = dd.slice(0, -1); dd += '...'; } pg.drawText(dd, { x: 125, y, size: 9, font: F }); pg.drawText(san(eu(+r.importo || 0)), { x: 435, y, size: 9, font: F });
        pg.drawText(san(a.start ? String(a.start) : '—'), { x: 505, y, size: 9, font: F, color: a.start ? rgb(0, 0, 0) : rgb(0.6, 0.3, 0.1) });
        if (a.note) { y -= 11; pg.drawText(san(a.note), { x: 125, y, size: 7.5, font: F, color: rgb(0.6, 0.3, 0.1) }); }
        y -= 17;
      });
    }
    for (const a of att) {
      if (a.img) { const pg = out.addPage([595, 842]); pg.drawImage(a.img.img, { x: (595 - a.img.w) / 2, y: (842 - a.img.hh) / 2, width: a.img.w, height: a.img.hh }); }
      else a.pages.forEach((pp) => out.addPage(pp));
    }
    const bytes = await out.save();
    await deliver(bytes, 'Versamenti-' + String(titolo).replace(/\W+/g, '-').replace(/^-|-$/g, '') + '.pdf', 'application/pdf');
    toast('PDF pronto: ' + out.getPageCount() + ' pagine');
  }

  function viewVersamenti() {
    const all = rows('versamenti'), cur = String(new Date().getFullYear());
    const anni = [...new Set([cur, ...all.map(vsAnno).filter(Boolean)])].sort().reverse();
    if (!ui.vy || (ui.vy !== 'tutti' && !anni.includes(ui.vy))) ui.vy = cur;
    const list = all.filter((r) => ui.vy === 'tutti' || vsAnno(r) === ui.vy).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    const tot = (g) => r2(list.filter((r) => !g || vsGruppo(r.categoria) === g).reduce((t, r) => t + (+r.importo || 0), 0));
    const byCat = {}; list.forEach((r) => { const k = (r.categoria || 'Senza categoria').trim(); (byCat[k] = byCat[k] || { n: 0, t: 0 }); byCat[k].n++; byCat[k].t += +r.importo || 0; });
    const cats = Object.entries(byCat).sort((a, b) => b[1].t - a[1].t), T = tot();
    const csv = () => { const q = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; deliver('\ufeffData;Categoria;Gruppo;Descrizione;Importo;Anno competenza;Allegato\n' + list.slice().reverse().map((r) => [r.data, r.categoria, vsGruppo(r.categoria), r.descrizione, String(r.importo || 0).replace('.', ','), vsAnno(r), r.pdf && r.pdf.name].map(q).join(';')).join('\n'), 'versamenti-' + ui.vy + '.csv', 'text/csv'); };
    const fi = h('input', { type: 'file', accept: '.json', hidden: true });
    fi.addEventListener('change', async () => {
      try {
        const j = JSON.parse(await fi.files[0].text()); let add = 0, dup = 0, pdf = 0;
        for (const it of (j.versamenti || [])) {
          const { _file, ...rec } = it;
          if (rows('versamenti').some((x) => x.data === rec.data && x.categoria === rec.categoria && +x.importo === +rec.importo)) { dup++; continue; }
          rec.id = uid(); rec.updated = NOW();
          if (_file && _file.b64) { const bin = atob(_file.b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await FILES.put(rec.id + ':pdf', new Blob([u], { type: _file.type || 'application/pdf' })); rec.pdf = { name: _file.name, size: u.length, type: _file.type || 'application/pdf' }; pdf++; }
          rows('versamenti').push(rec); add++;
        }
        save(); route(); toast(add + ' versamenti importati (' + pdf + ' PDF)' + (dup ? ', ' + dup + ' già presenti' : ''));
      } catch (e) { toast('Importazione non riuscita: ' + e.message); }
    });
    return h('div', {}, h('div', { class: 'bar' }, btn('+ Nuovo versamento', () => openForm('versamenti', null), 'pri'), btn('📥 Importa da file', () => fi.click(), ''), list.length ? btn('⬇️ Esporta CSV', csv, '') : null, list.length ? btn('🖨️ PDF unico per il commercialista', () => pdfUnico(list, ui.vy === 'tutti' ? 'tutti gli anni' : ui.vy).catch((e) => toast('PDF non riuscito: ' + (e.message || e))), '') : null, fi),
      h('div', { class: 'chips' }, anni.concat(['tutti']).map((a) => h('a', { class: 'chip' + (ui.vy === a ? ' on' : ''), href: '#', onclick: (e) => { e.preventDefault(); ui.vy = a; route(); } }, a === 'tutti' ? 'Tutti gli anni' : a))),
      tiles([['Totale pagato', L.eur(T)], ['Contributi (EPAP…)', L.eur(tot('Contributi'))], ['Imposte', L.eur(tot('Imposte'))], ['Altre spese', L.eur(tot('Spese'))]]),
      !list.length ? h('div', { class: 'empty' }, 'Nessun versamento' + (ui.vy === 'tutti' ? '' : ' nel ' + ui.vy) + '. Registra EPAP, assicurazione professionale, imposte e altre spese con «+ Nuovo versamento», e allega il PDF della ricevuta.') : h('div', {},
        h('h3', {}, 'Per categoria'),
        h('div', { class: 'vs-cat' }, cats.map(([k, v]) => h('div', { class: 'vs-r' }, h('span', { class: 't' }, k, h('span', { class: 'az-n' }, v.n)), h('b', {}, L.eur(r2(v.t))), h('div', { class: 'vs-bar' }, h('i', { style: 'width:' + Math.max(2, Math.round(v.t / T * 100)) + '%' }))))),
        h('h3', {}, 'Elenco'),
        h('div', { class: 'list' }, list.map((r) => h('article', { class: 'card', tabindex: '0', onclick: () => openForm('versamenti', r), onkeydown: (e) => { if (e.key === 'Enter') openForm('versamenti', r); } },
          h('div', { class: 'card-t card-tp' }, h('span', {}, r.categoria || 'Versamento'), h('b', {}, L.eur(+r.importo || 0))),
          h('div', { class: 'card-m' }, [r.data ? L.fmtDate(r.data) : '', r.descrizione, r.anno && String(r.anno) !== (r.data || '').slice(0, 4) ? 'competenza ' + r.anno : ''].filter(Boolean).join(' · ')),
          h('div', { class: 'card-a' }, tag(vsGruppo(r.categoria), vsGruppo(r.categoria) === 'Imposte' ? 'warn' : vsGruppo(r.categoria) === 'Contributi' ? 'info' : ''),
            r.pdf ? h('button', { type: 'button', class: 'vs-pdf', onclick: (e) => { e.stopPropagation(); openDoc(r.id + ':pdf', r.pdf); } }, '📎 Ricevuta') : null,
            r.link ? h('a', { class: 'vs-pdf', href: r.link, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, '🔗 Cloud') : null))))),
      h('p', { class: 'note' }, 'I PDF restano salvati solo su questo dispositivo (non nel backup né nella sincronizzazione): tieni una copia anche su cloud e, se vuoi, incolla il link nel versamento. Il totale per gruppo (Contributi / Imposte / Altre spese) è dedotto dal nome della categoria.'));
  }

  function viewModule(mod, ek) {
    ek = mod.ents.includes(ek) ? ek : mod.ents[0];
    const body = ek === 'periodi' ? viewPeriodi() : ek === 'noteSpese' ? viewNoteSpese() : ek === 'versamenti' ? viewVersamenti() : ek === 'appunti' ? viewAppunti() : ek === 'riunioni' ? viewDipartimento() : ek === 'diario' ? viewDiario() : viewList(ek);
    const extra = mod.id === 'scuola' && ek === 'classi' && CLASSI_STD.some((n) => !rows('classi').some((c) => normCl(c.nome) === normCl(n)))
      ? h('div', { class: 'bar' }, btn('➕ Crea classi 3°A 3°B 4°A 4°B 5°A 5°B', creaClassi, 'pri')) : mod.id === 'scuola' && ek === 'verifiche' ? h('div', { class: 'bar' }, btn('📥 Importa verifica', () => openImportVerifica(), 'pri'))
        : mod.id === 'scuola' && ek === 'verbali' ? h('div', { class: 'bar' }, rows('classi').filter((c) => c.coordinatore).map((c) => btn('+ Verbale CdC ' + c.nome, () => newVerbale('Consiglio di classe', c.id), 'pri')), btn('+ Verbale Dipartimento', () => newVerbale('Dipartimento Scienze Agrarie'), ''), h('span', { class: 'note' }, 'Prima inserisci i docenti e le cattedre (schede “Docenti” e “Consigli di classe”). Spunta “Sono il coordinatore” nella tua classe.')) : null;
    return h('div', {}, h('h2', {}, mod.icon + ' ' + mod.label),
      SUMMARY[mod.id] && !(mod.id === 'professione' && ek === 'versamenti') && tiles(SUMMARY[mod.id]()),
      mod.id === 'professione' && ek !== 'versamenti' && viewIncassi(),
      mod.ents.length > 1 && h('div', { class: 'chips' }, mod.ents.map((k) => h('a', { class: 'chip' + (k === ek ? ' on' : ''), href: '#/' + mod.id + '/' + k }, ENT[k].label)), mod.id === 'ispezioni' && h('a', { class: 'chip', href: '#/ispezioni/mappa' }, '🗺️ Mappa')),
      extra, body);
  }

  function viewOggi() {
    const t = L.today();
    const open = allEvents().filter((e) => !e.done && (e.date >= t || !e.info)).sort(cmpEv);
    const dd = (e) => L.diffDays(t, e.date);
    const groups = [['Scadute', (e) => dd(e) < 0], ['Oggi', (e) => dd(e) === 0], ['Prossimi 7 giorni', (e) => dd(e) >= 1 && dd(e) <= 7], ['Entro 30 giorni', (e) => dd(e) >= 8 && dd(e) <= 30], ['Più avanti', (e) => dd(e) > 30]];
    const root = h('div', {}, h('h2', {}, '📅 Oggi — ' + L.fmtDate(t)),
      tiles([['Scadute', open.filter((e) => dd(e) < 0).length, open.some((e) => dd(e) < 0)], ['Oggi', open.filter((e) => dd(e) === 0).length], ['Prossimi 7 gg', open.filter((e) => dd(e) >= 1 && dd(e) <= 7).length],
        ['Da incassare', L.eur(sum(rows('fatture').filter((r) => !r.incassata), 'importo'))]]),
      h('div', { class: 'bar' },
        btn('+ Promemoria rapido', () => openForm('promemoria'), 'pri'),
        btn('📅 Esporta in Calendario', () => exportICS(open.filter((e) => e.date >= t), 'scadenze-gestionale.ics'), ''),
        btn('🔔 Invia a Promemoria', () => { const f = open.filter((e) => e.date >= t); f.length ? showReminders(f) : toast('Nessuna scadenza'); }, '')));
    if (!open.length) root.append(h('div', { class: 'empty' }, 'Nessuna scadenza. Aggiungi dati dalle sezioni qui sotto o carica i dati di esempio da Impostazioni.'));
    for (const [name, fn] of groups) {
      const list = open.filter(fn); if (!list.length) continue;
      root.append(h('h3', {}, name), ...list.map((e) => h('div', { class: 'row' + (dd(e) < 0 ? ' late' : ''), onclick: () => openForm(e.entKey, byId(e.entKey, e.id)) },
        h('span', { class: 'date' }, L.fmtDate(e.date) + (e.time ? ' ' + e.time : '')), h('span', { class: 't' }, e.title), h('span', { class: 'tag' }, ENT[e.entKey].label))));
    }
    return root;
  }

  function seedDemo() {
    const t = L.today(); const d = (n) => L.addDays(t, n);
    const add = (ek, o) => { const r = Object.assign({ id: uid(), updated: new Date().toISOString() }, o); rows(ek).push(r); return r.id; };
    const p1 = add('parcelle', { nome: 'Pescheto (esempio)', coltura: 'Pesco', ettari: 2.5 });
    add('parcelle', { nome: 'Noccioleto (esempio)', coltura: 'Nocciolo', ettari: 4 });
    add('magazzino', { prodotto: 'Prodotto di esempio', tipo: 'Fitofarmaco', quantita: 5, unita: 'l', scadenza: d(60) });
    add('trattamenti', { data: d(-3), parcella: p1, prodotto: 'Prodotto di esempio', avversita: 'Esempio', carenza: 14 });
    add('raccolte', { data: d(-10), parcella: p1, prodotto: 'Pesche', kg: 1200, prezzo: 0.8 });
    add('manutenzioni', { titolo: 'Revisione trattore (esempio)', luogo: 'Trattore / macchine', scadenza: d(12), ricorrenza: 'Annuale', stato: 'Da fare' });
    add('manutenzioni', { titolo: 'Pulizia grondaie (esempio)', luogo: 'Casa', scadenza: d(-2), ricorrenza: 'Semestrale', stato: 'Da fare' });
    const az = add('aziende', { ragione: 'Azienda Agricola Esempio', comune: 'Comune di prova' });
    add('ispezioni', { data: d(5), ora: '09:00', azienda: az, tipo: 'Annuale', norma: 'Reg. UE 848/2018', stato: 'Programmata', scadVerbale: d(20) });
    const cl = add('clienti', { nome: 'Cliente di esempio' });
    add('pratiche', { cliente: cl, tipo: 'PAC / domanda unica', scadenza: d(25), stato: 'In corso', compenso: 300 });
    add('fatture', { numero: '1/' + year(), data: d(-20), cliente: cl, importo: 300, scadPag: d(10), incassata: false });
    const cs = add('classi', { nome: '3A (esempio)', scuola: 'Scuola di prova' });
    add('impegni', { titolo: 'Consiglio di classe', tipo: 'Consiglio di classe', classe: cs, data: d(3), ora: '15:00', stato: 'Da fare' });
    add('promemoria', { titolo: 'Telefonare al commercialista (esempio)', area: 'Professione', data: d(1), ora: '10:00', priorita: 'Alta', stato: 'Da fare' });
    save();
  }

  /* ---------- Mail dei clienti (Gmail, sola lettura, direttamente dal browser) ---------- */
  const GM = { tok: null, exp: 0, cache: {}, chain: Promise.resolve() };
  try { const j = JSON.parse(sessionStorage.getItem('gm:tok') || 'null'); if (j && j.exp > Date.now() + 30000) { GM.tok = j.t; GM.exp = j.exp; } } catch (e) { /* niente */ }
  GM.ok = () => !!GM.tok && GM.exp > Date.now() + 30000;
  GM.id = () => String((db.settings && db.settings.gClientId) || '').trim();
  GM.script = () => new Promise((ok, ko) => { if (window.google && window.google.accounts && window.google.accounts.oauth2) return ok(); const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.onload = ok; sc.onerror = () => ko(new Error('Google non raggiungibile: sei offline?')); document.head.append(sc); });
  GM.connect = () => GM.script().then(() => new Promise((ok, ko) => {
    const c = window.google.accounts.oauth2.initTokenClient({ client_id: GM.id(), scope: 'https://www.googleapis.com/auth/gmail.readonly',
      callback: (r) => { if (r.error) return ko(new Error(r.error_description || r.error)); GM.tok = r.access_token; GM.exp = Date.now() + (+r.expires_in || 3600) * 1000; GM.cache = {}; try { sessionStorage.setItem('gm:tok', JSON.stringify({ t: GM.tok, exp: GM.exp })); } catch (e) { /* niente */ } ok(); },
      error_callback: (e) => ko(new Error(e && e.type === 'popup_closed' ? 'Finestra chiusa prima di autorizzare' : 'Accesso non riuscito')) });
    c.requestAccessToken({ prompt: '' });
  }));
  GM.off = () => { GM.tok = null; GM.exp = 0; GM.cache = {}; try { sessionStorage.removeItem('gm:tok'); } catch (e) { /* niente */ } };
  GM.api = async (path) => {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, { headers: { Authorization: 'Bearer ' + GM.tok } });
    if (r.status === 401) { GM.off(); throw new Error('Sessione Gmail scaduta: ricollega.'); }
    if (!r.ok) throw new Error('Gmail: errore ' + r.status); return r.json();
  };
  const gmCached = (k, fn) => { const c = GM.cache[k]; if (c && Date.now() - c.t < 180000) return Promise.resolve(c.v); return fn().then((v) => { GM.cache[k] = { t: Date.now(), v }; return v; }); };
  GM.unread = (email) => gmCached('u:' + email, async () => (await GM.api('messages?maxResults=20&q=' + encodeURIComponent('from:' + email + ' is:unread in:inbox'))).messages?.length || 0);
  GM.recent = (email) => gmCached('r:' + email, async () => {
    const j = await GM.api('threads?maxResults=8&q=' + encodeURIComponent('from:' + email + ' OR to:' + email)); const out = [];
    for (const th of j.threads || []) {
      const t = await GM.api('threads/' + th.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From'); const ms = t.messages || [], last = ms[ms.length - 1] || {};
      const hd = (n) => ((last.payload && last.payload.headers) || []).find((x) => x.name.toLowerCase() === n)?.value || '';
      out.push({ id: th.id, subject: hd('subject') || '(senza oggetto)', from: hd('from').replace(/<.*>/, '').replace(/"/g, '').trim() || hd('from'), date: +last.internalDate || 0, snippet: last.snippet || '', unread: ms.some((m) => (m.labelIds || []).includes('UNREAD')), n: ms.length });
    }
    return out;
  });
  const gmFmt = (ms) => { const d = new Date(ms), t = new Date(); return d.toDateString() === t.toDateString() ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : '2-digit' }); };
  function openMailCliente(r) {
    const dlg = document.getElementById('dlg'); dlg.replaceChildren(); const body = h('div', {});
    const nome = ENT.clienti.title(r), draw = async () => {
      if (!GM.id()) { body.replaceChildren(h('p', {}, 'Per vedere le mail qui serve collegare Gmail (una volta sola).'), h('div', { class: 'bar' }, h('button', { type: 'button', class: 'pri', onclick: () => { dlg.close(); location.hash = '#/impostazioni'; } }, 'Vai alle Impostazioni'))); return; }
      if (!GM.ok()) { body.replaceChildren(h('p', {}, 'Collega Gmail per leggere le mail di ' + nome + '. L’accesso è di sola lettura e dura circa un’ora.'), h('div', { class: 'bar' }, h('button', { type: 'button', class: 'pri', onclick: async () => { try { await GM.connect(); draw(); route(); } catch (e) { toast(e.message); } } }, 'Collega Gmail'))); return; }
      body.replaceChildren(h('p', { class: 'note' }, 'Carico le mail…'));
      try {
        const list = await GM.recent(r.email);
        body.replaceChildren(list.length ? h('div', {}, list.map((m) => h('a', { class: 'mail-r' + (m.unread ? ' nuova' : ''), href: 'https://mail.google.com/mail/u/0/#all/' + m.id, target: '_blank', rel: 'noopener' }, h('div', { class: 'mail-t' }, m.unread ? h('i', { class: 'dot' }) : null, h('span', {}, m.subject), h('small', {}, gmFmt(m.date))), h('div', { class: 'note' }, m.from + (m.n > 1 ? ' · ' + m.n + ' messaggi' : '')), h('div', { class: 'note mail-s' }, m.snippet)))) : h('p', { class: 'note' }, 'Nessuna mail con ' + r.email + '.'));
      } catch (e) { body.replaceChildren(h('p', { class: 'neg' }, e.message), h('div', { class: 'bar' }, h('button', { type: 'button', onclick: draw }, 'Riprova'))); }
    };
    dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, '📬 Mail — ' + nome), h('p', { class: 'note' }, r.email), body, h('div', { class: 'dlg-btns' }, h('a', { class: 'btnlink', href: gmailSearch('from:' + r.email + ' OR to:' + r.email), target: '_blank', rel: 'noopener' }, 'Apri in Gmail'), h('button', { type: 'button', class: 'pri', onclick: () => dlg.close() }, 'Chiudi'))));
    dlg.showModal(); draw();
  }
  function tipiSection() {
    const ta = h('textarea', { rows: 8, spellcheck: 'false' }); ta.value = tipiPratica().join('\n');
    ta.addEventListener('change', () => { db.settings.tipiPratica = ta.value.split('\n').map((x) => x.trim()).filter(Boolean); save(); toast('Elenco salvato'); });
    return h('div', {}, h('h3', {}, 'Tipi di pratica'), h('p', { class: 'note' }, 'Uno per riga: è l’elenco che compare nel campo «Tipo pratica». Nel campo puoi comunque scrivere un tipo nuovo a mano: viene ricordato e proposto la volta dopo.'), ta,
      h('div', { class: 'bar', style: 'margin-top:8px' }, h('button', { type: 'button', onclick: () => { delete db.settings.tipiPratica; save(); route(); toast('Elenco ripristinato'); } }, 'Ripristina predefiniti')));
  }
  function gmailSection() {
    const id = h('input', { type: 'text', placeholder: 'xxxxxxxx.apps.googleusercontent.com', value: (db.settings.gClientId || ''), autocomplete: 'off', spellcheck: 'false' });
    id.addEventListener('change', () => { db.settings.gClientId = id.value.trim(); save(); toast('ID client salvato'); route(); });
    const st = GM.ok() ? '✅ Collegato (la sessione dura circa un’ora)' : GM.id() ? 'Non collegato in questa sessione' : 'Non configurato';
    return h('div', {}, h('h3', {}, 'Mail dei clienti (Gmail)'),
      h('p', { class: 'note' }, 'Sulla scheda di ogni cliente con email compare il pulsante «📬 Mail» (ultime conversazioni) e il numero di mail non lette. Lettura soltanto: le mail restano nel tuo browser e non vengono salvate né sincronizzate.'),
      h('details', {}, h('summary', {}, 'Come configurare (una volta sola)'),
        h('ol', { class: 'note' }, ['Vai su console.cloud.google.com e crea un progetto (es. «Gestionale»).', 'Menu «API e servizi» › «Libreria»: cerca «Gmail API» e premi Abilita.', '«Schermata di consenso OAuth»: tipo Esterno, nome app a piacere, aggiungi la tua email tra gli «Utenti di prova».', '«Credenziali» › «Crea credenziali» › «ID client OAuth» › Applicazione web. In «Origini JavaScript autorizzate» scrivi https://agronomoriccardomutti.github.io', 'Copia l’ID client (finisce con .apps.googleusercontent.com) e incollalo qui sotto.', 'Premi «Collega Gmail»: Google avviserà che l’app non è verificata, è normale (è tua): Avanzate › Vai a… › Consenti.'].map((x) => h('li', {}, x)))),
      h('div', { class: 'fld' }, h('label', {}, 'ID client Google'), id),
      h('div', { class: 'bar' }, h('button', { type: 'button', class: 'pri', onclick: async () => { if (!GM.id()) return toast('Incolla prima l’ID client'); try { await GM.connect(); toast('Gmail collegato'); route(); } catch (e) { toast(e.message); } } }, 'Collega Gmail'), GM.ok() && h('button', { type: 'button', onclick: () => { GM.off(); route(); } }, 'Scollega'), h('span', { class: 'note' }, st)));
  }

  function viewImpostazioni() {
    const s = db.settings;
    const set = (k, label, type, extra) => {
      const el = h('input', Object.assign({ type, id: 's-' + k }, extra)); el.value = s[k];
      el.addEventListener('change', () => { s[k] = type === 'number' ? Number(el.value) : el.value; save(); toast('Impostazione salvata'); });
      return h('div', { class: 'fld' }, h('label', { for: 's-' + k }, label), el);
    };
    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const o = JSON.parse(await f.text());
        if (!o || typeof o !== 'object' || !o.data || typeof o.data !== 'object') throw new Error('formato');
        if (!confirm('Sostituire TUTTI i dati attuali con quelli del backup?')) return;
        restoreFrom(o); save(); route(); toast('Backup ripristinato');
      } catch (err) { toast('File di backup non valido'); }
      e.target.value = '';
    } });
    return h('div', {}, h('h2', {}, '⚙️ Impostazioni'),
      h('h3', {}, 'Promemoria nel calendario'),
      h('div', { class: 'set' },
        set('alarmDays', 'Avviso: giorni prima', 'number', { min: 0, step: 1 }),
        set('alarmTime', 'Ora dell\'avviso (eventi senza orario)', 'time'),
        set('durationMin', 'Durata predefinita eventi (min)', 'number', { min: 15, step: 15 }),
        set('soglia', 'Soglia ricavi forfettario (€)', 'number', { min: 0, step: 1000 }),
        set('partenza', 'Luogo di partenza (nota spese)', 'text')),
      h('p', { class: 'note' }, 'Gli eventi esportati hanno un identificativo stabile: se li reimporti dopo averli modificati, il Calendario li aggiorna invece di duplicarli.'),
      tipiSection(),
      gmailSection(),
      syncSection(),
      calendarSection(),
      h('h3', {}, 'Backup dei dati'),
      h('p', { class: 'note' }, 'I dati stanno solo in questo dispositivo. Fai un backup ogni tanto, soprattutto prima di cambiare telefono o browser.'),
      h('div', { class: 'bar' },
        btn('⬇️ Esporta backup (.json)', () => deliver(JSON.stringify(db, null, 2), 'gestionale-backup-' + L.today() + '.json', 'application/json'), 'pri'),
        btn('⬆️ Ripristina da backup', () => fileIn.click(), ''), fileIn),
      h('h3', {}, 'Altro'),
      h('div', { class: 'bar' },
        btn('Carica dati di esempio', () => { if (confirm('Aggiungere alcuni dati di esempio ai tuoi?')) { seedDemo(); toast('Dati di esempio aggiunti'); location.hash = '#/oggi'; route(); } }, ''),
        btn('Cancella tutti i dati', () => { if (confirm('Cancellare TUTTI i dati? Operazione irreversibile.') && confirm('Sei sicuro? Hai fatto un backup?')) { clearAll(); save(); route(); toast('Dati cancellati'); } }, 'del sm')),
      h('p', { class: 'note' }, 'Per installare l\'app: da Safari su iPhone “Condividi → Aggiungi a Home”; da Chrome “Installa app”.'));
  }

  /* ---------- Scuola: studenti, verifiche e correzione ---------- */
  const NOW = () => new Date().toISOString();
  const rng = (v) => ({ min: v.vmin === '' || v.vmin == null ? 3 : +v.vmin, max: v.vmax === '' || v.vmax == null ? 9 : +v.vmax });
  const studentsOf = (cid) => rows('studenti').filter((x) => x.classe === cid).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  const valOf = (vid, sid) => rows('valutazioni').find((x) => x.verifica === vid && x.studente === sid);
  function dropWhere(ek, pred) { for (const x of rows(ek).filter(pred)) tombstone(ek, x.id); db.data[ek] = rows(ek).filter((x) => !pred(x)); }
  function calcVal(v, val) {
    const sc = (val && val.scores) || {}; let any = false, tot = 0;
    for (const p of v.parti || []) { const x = sc[p.id]; if (typeof x === 'number' && isFinite(x)) { any = true; tot += Math.min(x, +p.max || 0); } }
    const m = maxTot(v), r = rng(v);
    const hyp = any && m > 0 ? r.min + tot / m * (r.max - r.min) : null;
    const fin = val && typeof val.final === 'number' ? val.final : null;
    return { any, tot, hyp, fin, eff: fin !== null ? fin : hyp };
  }
  const MATERIE = ['Genio Rurale', 'Industrie agrarie'];
  const matShort = (m) => (m === 'Industrie agrarie' ? 'Industrie' : 'Genio Rurale');
  const matOf = (v) => {
    if (v.materia) return v.materia;
    const cm = String((byId('classi', v.classe) || {}).materia || '').toLowerCase();
    return cm.includes('industri') && !cm.includes('genio') ? 'Industrie agrarie' : 'Genio Rurale';
  };
  const matsOfClass = (c) => { const t = String(c.materia || '').toLowerCase(); const m = MATERIE.filter((x) => t.includes(x.split(' ')[0].toLowerCase())); return m.length ? m : ['Genio Rurale']; };
  const perOf = (v) => v.periodo || (v.data && +v.data.slice(5, 7) >= 9 ? 'Trimestre' : v.data ? 'Pentamestre' : 'Trimestre');
  const CLASSI_STD = ['3°A', '3°B', '4°A', '4°B', '5°A', '5°B'];
  const normCl = (n) => String(n || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  function creaClassi() {
    const have = new Set(rows('classi').map((c) => normCl(c.nome))); let n = 0;
    for (const nome of CLASSI_STD) if (!have.has(normCl(nome))) { rows('classi').push({ id: uid(), nome, scuola: 'ITAS Leardi', materia: nome[0] === '3' ? 'Genio Rurale, Industrie agrarie' : 'Genio Rurale', updated: NOW() }); n++; }
    save(); route(); toast(n ? n + ' classi create' : 'Le classi ci sono già tutte');
  }
  const classChips = (cur, hrefOf) => h('div', { class: 'chips' }, rows('classi').slice().sort((a, b) => a.nome.localeCompare(b.nome, 'it')).map((c) => h('a', { class: 'chip' + (c.id === cur ? ' on' : ''), href: hrefOf(c) }, c.nome)));
  const firstVer = (cid) => rows('verifiche').filter((v) => v.classe === cid).sort((a, b) => (b.data || '').localeCompare(a.data || ''))[0];
  function gradeLabel(x) {
    let w = Math.floor(x + 1e-9), fr = Math.round((x - w) * 4);
    if (fr >= 4) { w += 1; fr = 0; }
    return fr === 3 ? w + '/' + (w + 1) : w + ['', '+', '½'][fr];
  }
  function gradeSelect(cur, onch, label) {
    const vals = []; for (let x = 2; x <= 10.0001; x += 0.25) vals.push(Math.round(x * 100) / 100);
    if (typeof cur === 'number' && !vals.includes(cur)) { vals.push(cur); vals.sort((a, b) => a - b); }
    const el = h('select', { 'aria-label': label, onchange: (e) => onch(e.target.value === '' ? '' : +e.target.value) }, h('option', { value: '' }, '—'), vals.map((x) => h('option', { value: String(x) }, gradeLabel(x))));
    el.value = typeof cur === 'number' ? String(cur) : ''; return el;
  }
  const fnum = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
  function buildMd(v) {
    const c = byId('classi', v.classe) || {}, cl = String(c.nome || '').replace('°', ''), per = perOf(v), parts = v.parti || [], r = rng(v), tot = maxTot(v), today = L.today();
    const studs = studentsOf(v.classe); const votes = []; let pres = 0; const lines = [];
    for (const st of studs) {
      const val = valOf(v.id, st.id) || {}, cv = calcVal(v, val), sc = val.scores || {}, ass = !!val.assente;
      if (!ass) pres++; if (cv.eff !== null) votes.push(cv.eff);
      lines.push('| [[' + st.nome + ']]' + (st.tag ? ' (' + st.tag + ')' : '') + ' | ' + (ass ? 'A' + (val.rec ? ' (rec. ' + L.fmtDate(val.rec) + ')' : '') : 'P') + ' | ' + parts.map((p) => (typeof sc[p.id] === 'number' ? fnum(sc[p.id]) : '')).join(' | ') + ' | ' + (cv.any ? fnum(cv.tot) : '') + ' | ' + (cv.hyp === null ? '' : fnum(cv.hyp)) + ' | ' + (cv.fin === null ? '' : fnum(cv.fin)) + ' |');
    }
    const avg = votes.length ? votes.reduce((a, x) => a + x, 0) / votes.length : null, suff = votes.filter((x) => x >= 6).length, n = studs.length;
    const titolo = v.titolo || 'Verifica', mat = matOf(v);
    const head = '| Alunno | Presenza | ' + parts.map((p) => p.name + ' /' + fnum(p.max)).join(' | ') + ' | Totale | Voto ipotetico | Voto finale |';
    const sep = '|---|:---:|' + new Array(parts.length + 4).join('---:|');
    return ['---', 'tags: [scuola, verifica, ' + mat.toLowerCase().replace(/\s+/g, '-') + ', ' + cl.toLowerCase() + ', ' + (per === 'Trimestre' ? 'T' : 'P') + ']', 'tipo: verifica',
      'titolo: "' + titolo + ' di ' + mat + '"', 'periodo: ' + per, 'data: ' + (v.data || ''), 'classe: ' + cl, 'punti_max: ' + fnum(tot), 'scala: ' + fnum(r.min) + '-' + fnum(r.max),
      'voto_medio: ' + (avg === null ? '' : fnum(Math.round(avg * 10) / 10)), 'sufficienti: ' + suff, 'corretti: ' + votes.length, 'presenti: ' + pres, 'assenti: ' + (n - pres),
      'data_creazione: ' + today, 'data_aggiornamento: ' + today, '---', '',
      '# ' + titolo + ' di ' + mat + ' (' + cl + ', ' + per + ')', '',
      'Registro della verifica per la classe ' + cl + '. Voto = ' + fnum(r.min) + ' + punti ÷ ' + fnum(tot) + ' × ' + fnum(r.max - r.min) + ', cioè da ' + fnum(r.min) + ' a ' + fnum(r.max) + '.', '',
      '## Punti chiave', '', '- ' + fnum(tot) + ' punti totali: ' + parts.map((p) => p.name + ' ' + fnum(p.max)).join(', ') + '.', '- Presenza: P presente, A assente (con data del recupero se inserita).',
      '- Alunni presenti: ' + pres + ' su ' + n + '; verifiche con voto: ' + votes.length + '.', '', '## Registro', '', head, sep, ...lines, '', '## Articoli correlati', '', '- [[indice_wiki]]', ''].join('\n');
  }
  const obsName = (v) => 'verifica-' + matOf(v).toLowerCase().replace(/\s+/g, '-') + '-' + (v.titolo || 'verifica').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + String((byId('classi', v.classe) || {}).nome || '').replace('°', '').toLowerCase() + '.md';
  function openImportVerifica(presetClasse) {
    const dlg = document.getElementById('dlg'); dlg.replaceChildren();
    const ta = h('textarea', { placeholder: 'Classe: 4°A\nVerifica: V03T\nData: 2026-12-10\nPeriodo: Trimestre\nVoto: 3-9\nVero o falso: 8\nDomanda 2: 8\nDomanda 3: 10', style: 'min-height:200px;font-family:monospace' });
    const status = h('p', { class: 'note' }, 'Incolla il blocco che ti ha preparato Claude.');
    const close = () => dlg.close();
    const fail = (m) => { status.textContent = m; status.style.color = 'var(--warn, #c0392b)'; };
    dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, '📥 Importa verifica'), ta, status,
      h('div', { class: 'dlg-btns' }, h('button', { type: 'button', onclick: close }, 'Annulla'),
        h('button', { type: 'button', class: 'pri', onclick: () => {
          const p = L.parseVerifica(ta.value); status.style.color = '';
          if (p.errori.length) return fail(p.errori.join(' · '));
          const cl = rows('classi').find((c) => normCl(c.nome) === normCl(p.classe));
          if (!cl) return fail('Classe «' + p.classe + '» non trovata. Crea prima le classi (Scuola → Classi).');
          if (rows('verifiche').some((v) => v.classe === cl.id && (v.titolo || '').toLowerCase() === p.titolo.toLowerCase() && matOf(v) === matOf({ classe: cl.id, materia: p.materia }))) return fail('Esiste già la verifica «' + p.titolo + '» per la ' + cl.nome + ' (' + matShort(matOf({ classe: cl.id, materia: p.materia })) + ').');
          const v = { id: uid(), classe: cl.id, titolo: p.titolo, data: p.data || L.today(), parti: p.parti, vmin: p.vmin, vmax: p.vmax, updated: NOW() };
          if (p.periodo) v.periodo = p.periodo;
          if (p.materia) v.materia = p.materia;
          rows('verifiche').push(v); save(); close(); location.hash = '#/scuola/correggi/' + v.id; route(); toast('Verifica creata: ' + p.titolo + ' (' + cl.nome + ')');
        } }, 'Crea verifica'))));
    dlg.showModal();
  }
  const votoCls = (x) => (x === null ? 'na' : x >= 8 ? 'top' : x >= 6 ? 'ok' : x >= 5 ? 'mid' : 'ko');
  const votoEl = (x) => h('span', { class: 'voto ' + votoCls(x) }, x === null ? '—' : fmt1(x));

  function viewClasse(id) {
    const c = byId('classi', id);
    if (!c) return h('div', { class: 'empty' }, 'Classe non trovata.');
    const studs = studentsOf(id);
    const allVers = rows('verifiche').filter((v) => v.classe === id).sort((a, b) => (a.data || '').localeCompare(b.data || ''));
    const mats = matsOfClass(c);
    if (ui.mat && !mats.includes(ui.mat)) ui.mat = '';
    const vers = allVers.filter((v) => (!ui.per || perOf(v) === ui.per) && (!ui.mat || matOf(v) === ui.mat));
    const matChips = mats.length > 1 ? h('div', { class: 'chips' }, [['', 'Tutte le materie'], ...mats.map((m) => [m, m])].map(([k, l]) => h('a', { class: 'chip' + (ui.mat === k ? ' on' : ''), href: '#/scuola/classe/' + id, onclick: (e) => { e.preventDefault(); ui.mat = k; route(); } }, l))) : null;
    const perChips = h('div', { class: 'chips' }, [['', 'Tutto l\'anno'], ['Trimestre', 'Trimestre'], ['Pentamestre', 'Pentamestre']].map(([k, l]) => h('a', { class: 'chip' + (ui.per === k ? ' on' : ''), href: '#/scuola/classe/' + id, onclick: (e) => { e.preventDefault(); ui.per = k; route(); } }, l)));
    const ta = h('textarea', { id: 'paste', placeholder: 'Rossi Marco\nBianchi Giulia\n…' });
    const addBox = h('div', { class: 'box' }, h('label', { for: 'paste' }, 'Aggiungi studenti: uno per riga (puoi incollare l\'elenco dal registro)'), ta,
      h('div', { class: 'bar' }, btn('Aggiungi alla classe', () => {
        const have = new Set(studs.map((x) => x.nome.toLowerCase())); let n = 0;
        for (const raw of ta.value.split(/\r?\n/)) {
          const nome = raw.trim(); if (!nome || have.has(nome.toLowerCase())) continue;
          have.add(nome.toLowerCase()); rows('studenti').push({ id: uid(), classe: id, nome, tag: '', updated: NOW() }); n++;
        }
        if (!n) return toast('Nessun nuovo nome da aggiungere');
        save(); route(); toast(n + ' studenti aggiunti');
      }, 'pri'), btn('+ Verifica per questa classe', () => openForm('verifiche', null, { classe: id, periodo: ui.per || undefined, materia: ui.mat || (mats.length === 1 ? mats[0] : undefined) }), ''), btn('📥 Importa verifica', () => openImportVerifica(), '')));
    const root = h('div', {}, h('p', {}, h('a', { href: '#/scuola/classi' }, '← Classi')), classChips(id, (x) => '#/scuola/classe/' + x.id), h('h2', {}, '👥 ' + c.nome + ' · ' + (ui.mat || mats.join(' + ')), c.scuola && h('small', { class: 'note' }, ' – ' + c.scuola)), matChips, perChips, addBox);
    if (!studs.length) { root.append(h('div', { class: 'empty' }, 'Nessuno studente. Incolla l\'elenco qui sopra.')); return root; }
    const head = h('tr', {}, h('th', {}, 'Studente'), h('th', {}, 'H / DSA'),
      vers.map((v) => h('th', {}, h('a', { href: '#/scuola/correggi/' + v.id }, v.titolo || 'Verifica'), h('div', { class: 'note' }, L.fmtDate(v.data) + ' · ' + (perOf(v) === 'Trimestre' ? 'T' : 'P') + (mats.length > 1 ? ' · ' + (matOf(v) === 'Industrie agrarie' ? 'IND' : 'GR') : '')))), h('th', {}, 'Media'), h('th', {}));
    const body = studs.map((st) => {
      let sum = 0, n = 0;
      const cells = vers.map((v) => {
        const val = valOf(v.id, st.id), cv = calcVal(v, val);
        if (cv.eff !== null) { sum += cv.eff; n++; return h('td', {}, votoEl(cv.eff)); }
        return h('td', { class: 'note' }, val && val.assente ? 'assente' : '—');
      });
      const sel = h('select', { 'aria-label': 'H o DSA di ' + st.nome, onchange: (e) => { st.tag = e.target.value; st.updated = NOW(); save(); } },
        ['', 'H', 'DSA'].map((o) => h('option', { value: o }, o || '—')));
      sel.value = st.tag || '';
      return h('tr', {}, h('td', { class: 'nm' }, st.nome), h('td', {}, sel), cells, h('td', {}, n ? votoEl(sum / n) : '—'),
        h('td', {}, btn('Elimina', () => {
          if (!confirm('Eliminare ' + st.nome + ' e le sue valutazioni?')) return;
          dropWhere('valutazioni', (x) => x.studente === st.id); dropWhere('studenti', (x) => x.id === st.id); save(); route();
        })));
    });
    root.append(h('div', { class: 'scroll' }, h('table', { class: 'g' }, h('thead', {}, head), h('tbody', {}, body))));
    return root;
  }

  /* ---------- Verbali ---------- */
  const ODG_TPL = {
    'CdC 1 – inizio anno': [['Insediamento componenti e nomina segretario'], ['Analisi della classe e segnalazione casi particolari già accertati o da verificare (H e BES)'], ['Piano di lavoro annuale secondo quanto definito dal documento di programmazione del dipartimento'], ['Avvio programmazione per curricolo digitale di istituto (rif. Dipartimenti disciplinari)'], ['Educazione civica: individuazione docenti (minimo tre) e tematiche da svolgere'], ['Attività di FSL (PCTO) per il triennio (ipotesi di programmazione)'], ['Progetto CLIL (Classi Quinte)'], ['Indicazioni sulle linee guida per l’orientamento e relative azioni (Classi Triennio)'], ['Indicazioni sulla meta delle visite di istruzione di un giorno (una per periodo didattico nel rispetto delle indicazioni della commissione gite)'], ['Comunicazioni del Dirigente Scolastico / Coordinatore di Classe']],
    'CdC 2 – con genitori e alunni': [['Insediamento componenti'], ['Analisi e situazione della classe e andamento didattico disciplinare'], ['Piano didattico personalizzato, certificazioni BES e indicazione per inclusione (DPCM 04/11/2000 e nota M.I. del 05/11/2020)'], ['Linee programmatiche e progettuali e azioni per il curricolo di Istituto'], ['Programmazione attività dei percorsi di orientamento (linee guida orientamento DM 328/2022)'], ['FSL (PCTO): programmazione attività di indirizzo'], ['Conferma CLIL'], ['Comunicazioni varie'], ['Insediamento genitori e studenti', 1], ['Comunicazione ai rappresentanti di classe di genitori ed alunni dell’andamento disciplinare della classe, della programmazione didattica ed educativa in generale e dei criteri di valutazione', 1]],
    'Dipartimento Scienze Agrarie': [['Insediamento componenti e nomina segretario'], ['Programmazione disciplinare e piano di lavoro annuale'], ['Criteri e griglie di valutazione, prove comuni'], ['Progetti, uscite didattiche e attività laboratoriali'], ['Comunicazioni varie']],
  };
  const surname = (d) => String(d.nome || '').trim().split(/\s+/)[0] || '';
  const given = (d) => String(d.nome || '').trim().split(/\s+/).slice(1).join(' ');
  const profFull = (d) => d ? (d.titolo || 'Prof.') + ' ' + L.nomeMaiusc((given(d) + ' ' + surname(d)).trim()) : '';
  const profLow = (d) => { const t = (d.titolo || 'Prof.'); const n = (given(d) + ' ' + surname(d)).trim().replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()); return t + ' ' + n; };
  function verbCouncil(v) {
    if (v.tipo === 'Dipartimento Scienze Agrarie') {
      return rows('docenti').filter((d) => d.sdA).sort((a, b) => a.nome.localeCompare(b.nome, 'it')).map((d) => ({ d, mats: [...new Set(rows('cattedre').filter((x) => x.docente === d.id).map((x) => x.materia))] }));
    }
    const map = new Map();
    for (const c of rows('cattedre').filter((x) => x.classe === v.classe)) { const d = byId('docenti', c.docente); if (!d) continue; if (!map.has(d.id)) map.set(d.id, { d, mats: [] }); map.get(d.id).mats.push(c.materia); }
    return [...map.values()].sort((a, b) => a.d.nome.localeCompare(b.d.nome, 'it'));
  }
  function verbData(v) {
    const dip = v.tipo === 'Dipartimento Scienze Agrarie', cl = byId('classi', v.classe), dt = L.dataEstesa(v.data);
    const iso = v.data || '', y = +iso.slice(0, 4), mo = +iso.slice(5, 7);
    const anno = y ? (mo >= 9 ? y + '/' + (y + 1) : (y - 1) + '/' + y) : '____/____';
    const council = verbCouncil(v), ass = new Set(v.assenti || []);
    const absent = council.filter((x) => ass.has(x.d.id)).map((x) => profLow(x.d).replace(/^Prof\.ssa /, 'prof.ssa ').replace(/^Prof\. /, 'prof. '));
    const auto = !absent.length ? 'Sono tutti presenti.' : absent.length === 1 ? (/^prof\.ssa/.test(absent[0]) ? 'Risulta assente giustificata la ' : 'Risulta assente giustificato il ') + absent[0] + '.' : 'Risultano assenti giustificati i proff. ' + L.lstNomi(absent.map((s) => s.replace(/^prof\.(ssa)? /, ''))) + '.';
    const odg = (v.odg || []);
    const solo = odg.map((p, i) => [p, i]).filter(([p]) => !p.completo), comp = odg.map((p, i) => [p, i]).filter(([p]) => p.completo);
    const odgLines = []; const num = (i) => (i + 1) + ') ' + (odg[i].titolo || '') + ';';
    if (comp.length && solo.length) { odgLines.push({ t: 'Solo docenti:', h: 1 }); solo.forEach(([, i]) => odgLines.push({ t: num(i) })); odgLines.push({ t: dip ? 'Dipartimento allargato:' : 'Consiglio di classe completo (rappresentanti genitori ed alunni):', h: 1 }); comp.forEach(([, i]) => odgLines.push({ t: num(i) })); }
    else odg.forEach((p, i) => odgLines.push({ t: num(i) }));
    const corpo = []; let ammesso = false;
    odg.forEach((p, i) => {
      if (p.completo && !ammesso && solo.length) { corpo.push({ t: 'Vengono ora ammessi i rappresentanti degli studenti e dei genitori (Consiglio di classe completo)', h: 1 }); ammesso = true; }
      corpo.push({ t: (i + 1) + ') ' + (p.titolo || ''), testo: (p.testo && p.testo.trim()) || (i === 0 ? auto : '') });
    });
    const fine = L.oraIt(v.oraFine) || '__.__', sig = (d) => (d ? profFull(d) : 'Prof. ____________________');
    const sec = byId('docenti', v.segretario), coo = byId('docenti', v.coordinatore);
    return {
      intest1: v.intest1, intest2: v.intest2,
      titolo: dip ? 'DIPARTIMENTO DI SCIENZE AGRARIE' : 'CONSIGLIO DI CLASSE ' + (cl ? String(cl.nome).replace('°', '^') : ''),
      anno: 'Anno scolastico ' + anno, dataRiga: 'Data ' + (v.data ? L.fmtDate(v.data) : '__/__/____') + ' (verbale n. ' + (v.numero || '__') + ')',
      meta: [['Segretario (nome e cognome)', sec ? profFull(sec) : ''], [dip ? 'Coordinatore di dipartimento (nome e cognome)' : 'Coordinatori (nome e cognome)', coo ? profFull(coo) : ''], ['Presidente (Dirigente o suo delegato)', v.presidente || '']],
      docTitolo: dip ? 'Elenco docenti del dipartimento' : 'Elenco docenti del consiglio di classe',
      docenti: council.map((x) => [L.nomeMaiusc(x.d.nome), x.mats.join(', ')]),
      intro: 'Il giorno ' + dt.g + ' del mese di ' + dt.mese + " dell'anno " + dt.a + ' alle ore ' + (L.oraIt(v.ora) || '__.__') + ' ' + (v.luogo || '') + " dell'" + (v.istituto || '') + ' di ' + (v.citta || '') + ' si riunisce ' + (dip ? 'il Dipartimento di Scienze Agrarie' : 'il Consiglio di Classe') + ', per trattare il seguente ordine del giorno:',
      odg: odgLines, corpo, chiusura: 'Non essendoci altro ' + (dip ? 'il Dipartimento' : 'il C.d.C.') + ' si chiude alle ore ' + fine + '.',
      luogoData: (v.citta || '') + ', lì ' + (v.data ? L.fmtDate(v.data) : '__/__/____'),
      firme: [['FIRMA PRESIDENTE', v.presidente || 'Prof. ____________________'], ['FIRMA COORDINATORE', sig(coo)], ['FIRMA SEGRETARIO', sig(sec)]],
    };
  }
  function newVerbale(tipo, classe, data, ora, luogo, cb) {
    const prev = rows('verbali').filter((x) => x.tipo === tipo && (tipo !== 'Consiglio di classe' || x.classe === classe)).sort((a, b) => (b.data || '').localeCompare(a.data || ''))[0];
    const base = prev || rows('verbali').slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''))[0] || {};
    const me = rows('docenti').find((d) => /mutti/i.test(d.nome));
    const v = { id: uid(), tipo, classe: tipo === 'Consiglio di classe' ? (classe || '') : '', numero: prev ? (Number(prev.numero) || 0) + 1 : 1, data: data || L.today(), ora: ora || base.ora || '', oraFine: '', luogo: luogo || base.luogo || "nell'aula-informatica",
      segretario: base.segretario || '', coordinatore: base.coordinatore || (me ? me.id : ''), presidente: base.presidente || '', intest1: base.intest1 || 'ITAS "VINCENZO LUPARIA"', intest2: base.intest2 || 'Via Luparia, 14 - ROSIGNANO M.TO (AL) - FRAZ. SAN MARTINO',
      istituto: base.istituto || 'Istituto Superiore “V. LUPARIA”', citta: base.citta || 'SAN MARTINO DI ROSIGNANO', assenti: [], odg: [], updated: NOW() };
    rows('verbali').push(v); if (cb) cb(v); save(); location.hash = '#/scuola/verbale/' + v.id; route();
  }
  function viewVerbale(id) {
    const v = byId('verbali', id);
    if (!v) return h('div', { class: 'empty' }, 'Verbale non trovato.');
    if (!Array.isArray(v.odg)) v.odg = []; if (!Array.isArray(v.assenti)) v.assenti = [];
    const dip = v.tipo === 'Dipartimento Scienze Agrarie', touch = () => { v.updated = NOW(); save(); };
    const council = verbCouncil(v);
    const prevV = rows('verbali').filter((x) => x.id !== v.id && x.tipo === v.tipo && x.classe === v.classe && (x.data || '') < (v.data || '9999')).sort((a, b) => (b.data || '').localeCompare(a.data || ''))[0];
    const pres = h('div', { class: 'chips' });
    const drawPres = () => pres.replaceChildren(...council.map((x) => { const off = v.assenti.includes(x.d.id); return h('a', { class: 'chip' + (off ? '' : ' on'), href: '#', title: x.mats.join(', '), onclick: (e) => { e.preventDefault(); v.assenti = off ? v.assenti.filter((i) => i !== x.d.id) : v.assenti.concat(x.d.id); touch(); drawPres(); } }, (off ? '✗ ' : '✓ ') + x.d.nome + (x.mats.length ? ' · ' + x.mats.join(', ') : '')); }));
    drawPres();
    const list = h('div');
    const drawOdg = () => {
      list.replaceChildren(...v.odg.map((p, i) => {
        const tit = h('input', { type: 'text', value: p.titolo || '', placeholder: 'Punto ' + (i + 1), 'aria-label': 'Titolo punto ' + (i + 1), oninput: (e) => { p.titolo = e.target.value; touch(); } });
        const txt = h('textarea', { placeholder: i === 0 ? 'Vuoto = testo automatico (presenti/assenti)' : 'Testo del verbale per questo punto…', style: 'min-height:90px', oninput: (e) => { p.testo = e.target.value; touch(); } }); txt.value = p.testo || '';
        const cb = h('input', { type: 'checkbox', onchange: (e) => { p.completo = e.target.checked; touch(); } }); cb.checked = !!p.completo;
        return h('div', { class: 'box' }, h('div', { class: 'bar' }, h('b', {}, (i + 1) + ')'), tit),
          h('label', { class: 'note' }, cb, dip ? ' dipartimento allargato' : ' con genitori e alunni (consiglio completo)'), txt,
          h('div', { class: 'bar' }, btn('↑', () => { if (i) { [v.odg[i - 1], v.odg[i]] = [v.odg[i], v.odg[i - 1]]; touch(); drawOdg(); } }), btn('↓', () => { if (i < v.odg.length - 1) { [v.odg[i + 1], v.odg[i]] = [v.odg[i], v.odg[i + 1]]; touch(); drawOdg(); } }),
            btn('Elimina punto', () => { v.odg.splice(i, 1); touch(); drawOdg(); })));
      }));
    };
    drawOdg();
    const newP = (t, c) => ({ id: uid(), titolo: t || '', testo: '', completo: !!c });
    const tplSel = h('select', { 'aria-label': 'Modello ordine del giorno' }, h('option', { value: '' }, 'Carica un modello di ordine del giorno…'), Object.keys(ODG_TPL).map((k) => h('option', { value: k }, k)));
    tplSel.addEventListener('change', () => {
      const k = tplSel.value; tplSel.value = ''; if (!k) return;
      if (v.odg.some((p) => p.titolo || p.testo) && !confirm('Sostituire l\'ordine del giorno attuale con il modello?')) return;
      v.odg = ODG_TPL[k].map((x) => newP(x[0], x[1])); touch(); drawOdg();
    });
    const openImportOdg = () => {
      const dlg = document.getElementById('dlg'); dlg.replaceChildren();
      const ta = h('textarea', { style: 'min-height:200px', placeholder: '1) Insediamento componenti\n2) Analisi della classe…\n\nPer i punti con genitori/alunni scrivi prima la riga: Consiglio di classe completo' });
      dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, 'Importa ordine del giorno'), h('p', { class: 'note' }, 'Incolla il testo della convocazione: un punto per riga. I numeri iniziali sono tolti. Dopo una riga che contiene “completo” (o “genitori”) i punti successivi sono con genitori e alunni.'), ta,
        h('div', { class: 'dlg-btns' }, h('button', { type: 'button', onclick: () => dlg.close() }, 'Annulla'), h('button', { type: 'button', class: 'pri', onclick: () => {
          let comp = false; const out = [];
          for (const raw of ta.value.split(/\r?\n/)) {
            const s = raw.trim(); if (!s) continue;
            if (/^(solo docenti)/i.test(s)) { comp = false; continue; }
            if (/completo|rappresentant/i.test(s) && !/^\d+\s*[).]/.test(s) && s.length < 90) { comp = true; continue; }
            out.push(newP(s.replace(/^\d+\s*[).\-]\s*/, '').replace(/[;.]\s*$/, ''), comp));
          }
          if (!out.length) return toast('Nessun punto trovato');
          v.odg = v.odg.concat(out); touch(); dlg.close(); drawOdg(); toast(out.length + ' punti aggiunti');
        } }, 'Importa'))));
      dlg.showModal();
    };
    const doc = async () => {
      const bytes = L.buildVerbaleDocx(verbData(v));
      const nm = 'Verbale ' + (dip ? 'Dipartimento Agrarie' : 'CdC ' + (lab('classi', v.classe) || '')) + ' n.' + (v.numero || '') + ' ' + (v.data || '') + '.docx';
      await deliver(bytes, nm.replace(/[\/\\:*?"<>|°]/g, ''), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    };
    const asText = () => { const d = verbData(v); return [d.titolo, d.anno, d.dataRiga, '', d.intro, ...d.odg.map((o) => o.t), '', ...d.corpo.flatMap((s) => (s.h ? [s.t] : [s.t, s.testo, ''])), d.chiusura, d.luogoData].join('\n'); };
    const head = h('div', { class: 'vhead' }, h('h2', {}, '📝 ' + ENT.verbali.title(v)), h('div', { class: 'vtags' }, h('span', { class: 'pill' }, v.tipo), v.data && h('span', { class: 'pill' }, L.fmtDate(v.data)), v.ora && h('span', { class: 'pill' }, 'ore ' + L.oraIt(v.ora))));
    const meta = h('p', { class: 'note' }, 'Segretario: ' + (lab('docenti', v.segretario) || '—') + ' · Coordinatore: ' + (lab('docenti', v.coordinatore) || '—') + ' · Presidente: ' + (v.presidente || '—'));
    const root = h('div', {}, h('p', {}, h('a', { href: '#/scuola/verbali' }, '← Verbali')), head, meta,
      h('div', { class: 'bar' }, btn('✏️ Dati del verbale', () => openForm('verbali', v), ''), btn('⬇️ Scarica Word (.docx)', doc, 'pri'), btn('📋 Copia testo', () => showText('Verbale – testo', asText(), 'Testo semplice del verbale.'), '')));
    if (!council.length) root.append(h('div', { class: 'empty' }, dip ? 'Nessun docente del Dipartimento: in “Docenti” spunta “Dipartimento Scienze Agrarie”.' : 'Nessun docente per questa classe: aggiungili in “Docenti” e poi in “Consigli di classe” (classe + materia + docente).'));
    else root.append(h('h3', {}, 'Presenti (tocca per segnare un’assenza)'), pres);
    root.append(h('h3', {}, 'Ordine del giorno e testo'), h('div', { class: 'bar' }, tplSel, btn('📥 Importa ordine del giorno', openImportOdg, ''),
      prevV && btn('↩︎ Copia i testi dal verbale n. ' + (prevV.numero || '?'), () => {
        if (!prevV.odg || !prevV.odg.length) return toast('Il verbale precedente non ha punti');
        if (!v.odg.length) v.odg = prevV.odg.map((p) => newP(p.titolo, p.completo));
        let n = 0; v.odg.forEach((p) => { if (p.testo && p.testo.trim()) return; const m = prevV.odg.find((q) => (q.titolo || '').trim().toLowerCase() === (p.titolo || '').trim().toLowerCase()); if (m && m.testo) { p.testo = m.testo; n++; } });
        touch(); drawOdg(); toast(n + ' testi copiati');
      }, '')), list, h('div', { class: 'bar' }, btn('+ Aggiungi punto', () => { v.odg.push(newP('', false)); touch(); drawOdg(); }, 'pri')));
    return root;
  }

  /* ---------- Spese personali (periodo dal 23 al 22) ---------- */
  const SP = { per: '', q: '', tipo: 'Uscita', conf: null, rconf: null };
  const SP_G = 23, pad2 = (n) => String(n).padStart(2, '0');
  const spIso = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const spPer = (s) => { let [y, m, d] = s.split('-').map(Number); if (d < SP_G) { m -= 1; if (m === 0) { m = 12; y -= 1; } } return y + '-' + pad2(m) + '-' + pad2(SP_G); };
  const spShift = (k, n) => { let [y, m] = k.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + '-' + pad2(m) + '-' + pad2(SP_G); };
  const spEnd = (k) => { const [y, m] = spShift(k, 1).split('-').map(Number); return y + '-' + pad2(m) + '-' + pad2(SP_G - 1); };
  const spBrev = (s) => { const [, m, d] = s.split('-').map(Number); return d + ' ' + ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'][m - 1]; };
  const spLab = (k) => spBrev(k) + ' – ' + spBrev(spEnd(k)) + ' ' + spEnd(k).slice(0, 4);
  const spDays = (x, y) => Math.round((new Date(y + 'T12:00') - new Date(x + 'T12:00')) / 86400000);
  const spNorm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const SP_KW = {
    Uscita: [
      ['Carburante', /gasolio|benzina|diesel|carburante|metano|\bgpl\b|rifornimento|distributore|self service|\bpieno\b/],
      ['Assicurazione/Bollo', /assicurazione|\brca\b|\bbollo\b|polizza/],
      ['Manutenzione veicoli', /tagliando|gomme|pneumatic|revisione|meccanico|officina|olio motore|autolavaggio|ricambi|freni|batteria auto/],
      ['Spesa alimentare', /\bspesa\b|supermercato|\bcoop\b|conad|esselunga|carrefour|lidl|eurospin|\bpam\b|aldi|panetteria|\bpane\b|macelleria|frutta|verdura|alimentari|\blatte\b/],
      ['Casa/Utenze', /\bluce\b|\bgas\b|bolletta|\benel\b|\bacqua\b|affitto|condominio|\btari\b|\bimu\b|riscaldamento|pellet|legna/],
      ['Telefono/Internet', /telefon|internet|fibra|\btim\b|vodafone|windtre|iliad|ricarica|\bsim\b/],
      ['Farmacia', /farmaci|parafarmacia|medicin/],
      ['Salute', /dentista|medico|visita|analisi|\bticket\b|oculista|fisioterap|ospedale/],
      ['Abbigliamento', /vestit|scarpe|giacca|pantaloni|maglia|abbigliament|calze/],
      ['Bar', /\bbar\b|caffe|cappuccino|colazione|aperitivo|spritz|birra/],
      ['Ristoranti/Svago', /ristorante|pizza|trattoria|osteria|\bcena\b|pranzo|cinema|teatro|concerto|gelato|hotel|vacanza|ingresso/],
      ['Regali', /regalo|fiori|compleanno/],
      ['Libri/Cultura', /\blibro\b|\blibri\b|libreria|giornale|rivista|museo/],
      ['Figlie', /figli|\bscuola\b|mensa|\bgita\b|danza|nuoto|cartoleria|quaderni/],
      ['Abbonamenti', /abbonament|netflix|spotify|youtube|disney|dazn|icloud|google one/],
      ['Rate/Finanziamenti', /\brata\b|finanziament|mutuo|prestito/],
      ['Tasse/Imposte', /irpef|\binps\b|\btasse\b|imposta|\bf24\b|commercialista|\biva\b|enpaia/]],
    Entrata: [
      ['Stipendio', /stipendio|emolument|busta paga/],
      ['Rimborsi', /rimborso|nota spese/],
      ['Consulenze agronomo', /consulenz|parcella|fattura|ispezion|perizia|progetto|pratica|\bpac\b/],
      ['Regali ricevuti', /regalo/]]
  };
  /* categoria (e veicolo) proposti dalla descrizione: prima lo storico dei tuoi movimenti, poi le parole chiave */
  const spSuggest = (tipo, testo, mov) => {
    const q = spNorm(testo); if (!q || tipo === 'Prelievo') return null;
    const conta = {}; let vei = {};
    (mov || []).forEach((m) => { if (m.tipo !== tipo || !m.categoria) return; const d = spNorm(m.descrizione); if (d && (d === q || (q.length >= 3 && d.startsWith(q)))) { conta[m.categoria] = (conta[m.categoria] || 0) + 1; if (m.veicolo) vei[m.categoria + '|' + m.veicolo] = (vei[m.categoria + '|' + m.veicolo] || 0) + 1; } });
    const top = Object.entries(conta).sort((a, b) => b[1] - a[1])[0];
    if (top) { const v = Object.entries(vei).filter(([k]) => k.startsWith(top[0] + '|')).sort((a, b) => b[1] - a[1])[0]; return { cat: top[0], vei: v ? v[0].split('|')[1] : '' }; }
    const k = (SP_KW[tipo] || []).find(([, re]) => re.test(q)); return k ? { cat: k[0], vei: '' } : null;
  };
  /* ---------- Previsioni spese (calcolate sul dispositivo, nessun dato esce) ---------- */
  const SP_FISSE = ['Rate/Finanziamenti', 'Assicurazione/Bollo', 'Tasse/Imposte'];
  const spIsFix = (m) => !!m.ricorrenteId || SP_FISSE.includes(m.categoria);
  function spForecast(key, T) {
    const tot = spDays(key, spShift(key, 1)), el = Math.min(tot, Math.max(1, spDays(key, T) + 1)), rem = Math.max(0, tot - el), end = spEnd(key);
    const usc = rows('movimenti').filter((m) => m.tipo === 'Uscita' && m.data);
    const cur = {}; let fixCur = 0, entr = 0;
    for (const m of usc) if (spPer(m.data) === key) { const v = +m.importo || 0; if (spIsFix(m)) fixCur += v; else cur[m.categoria || 'Altro'] = (cur[m.categoria || 'Altro'] || 0) + v; }
    for (const m of rows('movimenti')) if (m.tipo === 'Entrata' && m.data && spPer(m.data) === key) entr += +m.importo || 0;
    const hist = {}; let nPer = 0, hDays = 0, hVar = 0;
    for (let i = 1; i <= 8 && nPer < 3; i++) {
      const k = spShift(key, -i), mm = usc.filter((m) => spPer(m.data) === k && !spIsFix(m)); if (!mm.length) continue;
      nPer++; hDays += spDays(k, spShift(k, 1)); for (const m of mm) { const v = +m.importo || 0; hist[m.categoria || 'Altro'] = (hist[m.categoria || 'Altro'] || 0) + v; hVar += v; }
    }
    const w = Math.min(1, el / tot), w2 = w * w, cats = [];
    for (const c of new Set([...Object.keys(cur), ...Object.keys(hist)])) {
      const att = cur[c] || 0, media = nPer ? (hist[c] || 0) / nPer : null, ritmo = att / Math.max(el, 10) * tot;
      const stima = media === null ? Math.max(att, ritmo) : Math.max(att, (1 - w2) * media + w2 * ritmo);
      cats.push({ c, att, stima: r2(stima), media: media === null ? null : r2(media) });
    }
    cats.sort((a, b) => b.stima - a.stima);
    const varAtt = Object.values(cur).reduce((a, b) => a + b, 0), varStima = cats.reduce((a, c) => a + c.stima, 0);
    const ric = rows('ricorrenti'), fixUp = ric.filter((r) => r.prossima && r.prossima <= end).reduce((a, r) => a + (+r.importo || 0), 0);
    const ent = entr > 0 ? entr : (spLastStip() || 0), risp = +(db.settings && db.settings.accantonare) || 0;
    const uscite = fixCur + varStima + fixUp, saldo = ent - risp - uscite;
    const nxt = spShift(key, 1), nxtEnd = spEnd(nxt), fixNext = ric.filter((r) => r.prossima && r.prossima > end && r.prossima <= nxtEnd).reduce((a, r) => a + (+r.importo || 0), 0);
    const varTipica = nPer ? hVar / nPer : (varAtt / Math.max(el, 10) * tot);
    const libero = rem > 0 ? (ent - risp - fixCur - fixUp - varAtt) / rem : 0;
    return { el, rem, tot, cats, varAtt, varStima: r2(varStima), fixCur: r2(fixCur), fixUp: r2(fixUp), uscite: r2(uscite), ent: r2(ent), stimaEnt: entr <= 0, risp, saldo: r2(saldo), nPer, prossimo: r2(varTipica + fixNext), fixNext: r2(fixNext), libero: r2(libero), attendibile: nPer >= 1 ? (el >= 7 ? 'buona' : 'media') : el >= 10 ? 'media' : 'bassa' };
  }
  const spPrevCard = (key, T) => {
    const f = spForecast(key, T), ok = f.saldo >= 0;
    const rowsC = f.cats.slice(0, 8).map((c) => {
      const pct = c.media > 0 ? Math.round((c.stima / c.media - 1) * 100) : null, alto = pct !== null && pct > 15 && c.stima - c.media > 10, basso = pct !== null && pct < -15;
      return h('div', { class: 'sp-pv' }, h('span', {}, c.c), h('b', {}, '~' + L.eur(c.stima)), h('small', { class: alto ? 'neg' : basso ? 'pos' : '' }, c.media === null ? 'nessuno storico' : alto ? '↑ +' + pct + '% sulla media (' + L.eur(c.media) + ')' : basso ? '↓ ' + pct + '% sulla media' : '≈ in linea con la media'));
    });
    const fonte = f.nPer ? 'sul ritmo di questo periodo e sulla media degli ultimi ' + f.nPer + ' period' + (f.nPer === 1 ? 'o' : 'i') : 'solo sul ritmo di questo periodo (manca lo storico)';
    const consigli = [];
    if (f.rem > 0) consigli.push(f.libero > 0 ? 'Per chiudere in pari puoi spendere ancora circa ' + L.eur(f.libero) + ' al giorno in spese variabili.' : 'Per chiudere in pari dovresti ridurre le spese variabili: il margine è già esaurito.');
    const sopra = f.cats.find((c) => c.media > 0 && c.stima - c.media > 10 && c.stima / c.media > 1.15); if (sopra) consigli.push('Occhio a «' + sopra.c + '»: va verso ' + L.eur(sopra.stima) + ', di solito ' + L.eur(sopra.media) + '.');
    if (f.fixUp > 0) consigli.push('Ricorrenti ancora in scadenza nel periodo: ' + L.eur(f.fixUp) + '.');
    return h('div', { class: 'sp-prev' }, h('h3', {}, '🔮 Previsione di fine periodo'),
      h('div', { class: 'sp-big' + (ok ? '' : ' neg') }, (ok ? '+' : '−') + L.eur(Math.abs(f.saldo))),
      h('p', { class: 'note' }, (ok ? 'Avanzo previsto' : 'Sforamento previsto') + ' al ' + spBrev(spEnd(key)) + ', dopo il risparmio di ' + L.eur(f.risp) + (f.stimaEnt ? ' (entrate stimate sull’ultimo stipendio)' : '') + '.'),
      h('div', { class: 'kv' }, [['Uscite previste', L.eur(f.uscite)], ['Già speso', L.eur(f.fixCur + f.varAtt)], ['Variabili ancora attese', L.eur(Math.max(0, f.varStima - f.varAtt))], ['Ricorrenti in scadenza', L.eur(f.fixUp)], ['Prossimo periodo (stima)', L.eur(f.prossimo)]].map(([l, v]) => h('div', {}, h('small', {}, l), v))),
      f.cats.length ? h('div', { class: 'sp-pvl' }, rowsC) : null,
      consigli.length ? h('ul', { class: 'sp-tips' }, consigli.map((x) => h('li', {}, x))) : null,
      h('p', { class: 'note' }, 'Attendibilità ' + f.attendibile + ': stima basata ' + fonte + '. Calcolata sul telefono, nessun dato esce dal dispositivo.'));
  };
  const spAddM = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(y, m - 1 + n, 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(Math.min(d, last)); };
  function spTot(key) {
    const t = { entrate: 0, uscite: 0, stip: false, cat: {} };
    for (const m of rows('movimenti')) {
      if (!m.data || spPer(m.data) !== key) continue; const v = +m.importo || 0;
      if (m.tipo === 'Entrata') { t.entrate += v; if (m.categoria === 'Stipendio') t.stip = true; } else if (m.tipo === 'Uscita') { t.uscite += v; t.cat[m.categoria || 'Altro'] = (t.cat[m.categoria || 'Altro'] || 0) + v; }
    }
    t.entrate = r2(t.entrate); t.uscite = r2(t.uscite); t.saldo = r2(t.entrate - t.uscite); return t;
  }
  const spCash = () => { let p = 0, s = 0; for (const m of rows('movimenti')) { const v = +m.importo || 0; if (m.tipo === 'Prelievo') p += v; else if (m.tipo === 'Uscita' && m.metodo === 'Contanti') s += v; } return r2(p - s); };
  const spLastStip = () => { const s = rows('movimenti').filter((m) => m.tipo === 'Entrata' && m.categoria === 'Stipendio').sort((x, y) => (y.data || '').localeCompare(x.data || '')); return s.length ? +s[0].importo : null; };
  const spReserve = (key) => { let tot = 0; for (const r of rows('ricorrenti')) { const q = (+r.importo || 0) / (+r.mesi || 1); let pg = 0; for (const m of rows('movimenti')) if (m.ricorrenteId === r.id && m.tipo === 'Uscita' && m.data && spPer(m.data) === key) pg += +m.importo || 0; tot += Math.max(0, q - pg); } return r2(tot); };
  function spPay(r) {
    const now = NOW();
    rows('movimenti').push({ id: uid(), tipo: 'Uscita', data: L.today(), importo: r2(+r.importo || 0), descrizione: r.descrizione, categoria: r.categoria || 'Altro', metodo: r.metodo || 'Carta', veicolo: r.veicolo || '', ricorrenteId: r.id, updated: now });
    r.prossima = spAddM(r.prossima || L.today(), +r.mesi || 1); r.updated = now; save(); route(); toast('Registrata come uscita: ' + r.descrizione);
  }
  function openImportSpese() {
    const dlg = document.getElementById('dlg'); dlg.replaceChildren();
    const file = h('input', { type: 'file', accept: '.json,application/json' });
    const ta = h('textarea', { style: 'min-height:120px', placeholder: 'oppure incolla qui il contenuto del file JSON' });
    dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, '📥 Importa da “Gestione Spese”'), h('p', { class: 'note' }, 'Carica il file JSON dei movimenti (o incollalo). Quelli già presenti non vengono duplicati.'), file, ta,
      h('div', { class: 'dlg-btns' }, h('button', { type: 'button', onclick: () => dlg.close() }, 'Annulla'), h('button', { type: 'button', class: 'pri', onclick: async () => {
        try {
          const txt = file.files[0] ? await file.files[0].text() : ta.value; const j = JSON.parse(txt);
          const have = new Set(rows('movimenti').map((x) => x.id)), haveR = new Set(rows('ricorrenti').map((x) => x.id)); let n = 0, nr = 0; const now = NOW();
          for (const m of j.movimenti || []) if (m && m.data && m.tipo && !have.has(m.id)) { rows('movimenti').push({ id: m.id || uid(), tipo: m.tipo, data: m.data, importo: +m.importo || 0, descrizione: m.descrizione || '', categoria: m.categoria || '', metodo: m.metodo || '', veicolo: m.veicolo || '', ricorrenteId: m.ricorrenteId || '', updated: now }); n++; }
          for (const r of j.ricorrenti || []) if (r && r.descrizione && !haveR.has(r.id)) { rows('ricorrenti').push({ id: r.id || uid(), descrizione: r.descrizione, importo: +r.importo || 0, mesi: String(r.mesi || 1), prossima: r.prossima || '', categoria: r.categoria || '', metodo: r.metodo || '', veicolo: r.veicolo || '', updated: now }); nr++; }
          if (j.accantonare != null && !db.settings.accantonare) db.settings.accantonare = +j.accantonare || 0;
          save(); dlg.close(); route(); toast(n + ' movimenti e ' + nr + ' ricorrenti importati');
        } catch (e) { toast('File non valido: ' + e.message); }
      } }, 'Importa'))));
    dlg.showModal();
  }

  // stipendio da mail/link: #/spese/stipendio/1729.56_2026-11-24
  const parseImportoMail = (txt) => { const m = /importo di\s*([\d.]+,\d{2}|\d+(?:\.\d{1,2})?)\s*euro/i.exec(txt || '') || /([\d.]*\d,\d{2})\s*(?:euro|€)/i.exec(txt || ''); return m ? +m[1].replace(/\./g, '').replace(',', '.') : null; };
  function openStipendioConferma(imp, data) {
    const per = spPer(data || L.today()), dup = rows('movimenti').find((m) => m.tipo === 'Entrata' && m.categoria === 'Stipendio' && m.data && spPer(m.data) === per);
    if (dup) return toast('Stipendio del periodo già registrato (' + L.eur(+dup.importo) + ')');
    const dlg = document.getElementById('dlg'); dlg.replaceChildren();
    const d = h('input', { type: 'date', value: data || L.today() }), im = h('input', { type: 'number', step: '0.01', inputmode: 'decimal', value: imp || '' });
    const ta = h('textarea', { style: 'min-height:70px', placeholder: 'Incolla qui il testo della mail “accredito emolumenti”: l’importo viene letto da solo' });
    ta.addEventListener('input', () => { const v = parseImportoMail(ta.value); if (v) im.value = v; });
    dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, '💶 Registra stipendio'), h('p', { class: 'note' }, 'Accredito emolumenti scuola: controlla importo e data.'), h('div', { class: 'fld' }, h('label', {}, 'Data accredito'), d), h('div', { class: 'fld' }, h('label', {}, 'Importo €'), im), imp ? null : ta,
      h('div', { class: 'dlg-btns' }, h('button', { type: 'button', onclick: () => dlg.close() }, 'Annulla'), h('button', { type: 'button', class: 'pri', onclick: () => {
        const v = +String(im.value).replace(',', '.'); if (!d.value || !(v > 0)) return toast('Servono data e importo');
        rows('movimenti').push({ id: uid(), tipo: 'Entrata', data: d.value, importo: r2(v), descrizione: 'Stipendio', categoria: 'Stipendio', metodo: 'Bonifico', veicolo: '', updated: NOW() }); save(); SP.per = spPer(d.value); dlg.close(); route(); toast('Stipendio registrato: ' + L.eur(v));
      } }, 'Registra'))));
    dlg.showModal();
  }
  function viewSpese() {
    const T = L.today(), cur = spPer(T); if (!SP.per) SP.per = cur;
    const key = SP.per, t = spTot(key), isCur = key === cur;
    const mov = rows('movimenti');
    const body = h('div');
    const head = h('div', { class: 'sp-top' }, h('div', { class: 'sp-per' }, btn('‹', () => { SP.per = spShift(key, -1); route(); }, 'sm'), h('div', { class: 'sp-pl' }, h('b', {}, spLab(key)), h('small', {}, isCur ? 'Periodo in corso · ' + Math.max(0, spDays(T, spShift(key, 1))) + ' giorni al prossimo stipendio' : key < cur ? 'Periodo chiuso' : 'Periodo futuro')), key < cur ? btn('›', () => { SP.per = spShift(key, 1); route(); }, 'sm') : h('span', { style: 'width:34px' })),
      h('div', { class: 'bar' }, btn('📥 Importa', openImportSpese, ''), h('a', { class: 'btnlink', href: '#/spese/movimenti' }, 'Tutti i movimenti'), h('a', { class: 'btnlink', href: '#/spese/ricorrenti' }, 'Ricorrenti')));
    const root = h('div', { class: 'sp' }, h('h2', {}, '💶 Spese'), head, body);
    // banner stipendio
    if (isCur && !t.stip) {
      const d = h('input', { type: 'date', value: T >= key && T <= spEnd(key) ? T : key }), im = h('input', { type: 'number', step: '0.01', inputmode: 'decimal', placeholder: 'Importo €', value: spLastStip() || '' });
      body.append(h('div', { class: 'sp-ban' }, h('div', {}, h('b', {}, 'Nuovo periodo. '), 'Inserisci lo stipendio per far partire il conteggio.'), h('div', { class: 'bar' }, d, im, btn('📧 Da mail', () => openStipendioConferma('', ''), ''), btn('Registra stipendio', () => { const v = +String(im.value).replace(',', '.'); if (!d.value || !(v > 0)) return toast('Data e importo'); mov.push({ id: uid(), tipo: 'Entrata', data: d.value, importo: r2(v), descrizione: 'Stipendio', categoria: 'Stipendio', metodo: 'Bonifico', veicolo: '', updated: NOW() }); save(); route(); }, 'pri'))));
    }
    const quota = t.entrate > 0 ? t.uscite / t.entrate : 0;
    body.append(tiles([['Entrate', L.eur(t.entrate)], ['Uscite', L.eur(t.uscite) + (t.entrate > 0 ? ' (' + Math.round(quota * 100) + '%)' : ''), quota > 1], ['Disponibile', L.eur(t.saldo), t.saldo < 0], ['Contanti', L.eur(spCash())]]));
    // budget settimanale
    const wk = h('div', { class: 'sp-week' }); const wOut = h('div'); const acc = h('input', { type: 'number', step: '10', min: '0', inputmode: 'decimal', placeholder: '0', value: db.settings.accantonare || '' });
    const drawWeek = () => {
      if (!isCur) { const sett = spDays(key, spShift(key, 1)) / 7; wOut.replaceChildren(h('div', { class: 'sp-big' }, L.eur(t.uscite / sett)), h('p', { class: 'note' }, 'Spesa media a settimana (uscite ÷ ' + fmt1(sett) + ' settimane).')); return; }
      const stim = t.entrate <= 0, ent = stim ? (spLastStip() || 0) : t.entrate, risp = +String(acc.value).replace(',', '.') || 0, riserva = spReserve(key), accT = risp + riserva;
      const giorni = Math.max(1, spDays(T, spShift(key, 1))), resto = r2(ent - accT - t.uscite), sett = resto / giorni * 7;
      const d = new Date(), lun = new Date(d); lun.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const ini = spIso(lun) < key ? key : spIso(lun);
      let spSett = 0; for (const m of mov) if (m.tipo === 'Uscita' && m.data >= ini && m.data <= T) spSett += +m.importo || 0; spSett = r2(spSett);
      const prima = r2(t.uscite - spSett), gi = Math.max(1, spDays(ini, spShift(key, 1))), bud = Math.max(0, (ent - accT - prima) / gi * 7), q = bud > 0 ? spSett / bud : spSett > 0 ? 2 : 0;
      wOut.replaceChildren(h('div', { class: 'sp-big' + (resto < 0 ? ' neg' : '') }, L.eur(giorni >= 7 ? sett : resto)),
        h('p', { class: 'note' }, resto < 0 ? 'Hai già superato il limite del periodo di ' + L.eur(-resto) + '.' : giorni >= 7 ? 'Circa ' + L.eur(resto / giorni) + ' al giorno per i prossimi ' + giorni + ' giorni, fino al ' + spBrev(spEnd(key)) + '.' + (stim ? ' Stima sull’ultimo stipendio.' : '') : 'Restano ' + giorni + ' giorni: puoi spendere ancora questa somma fino al ' + spBrev(spEnd(key)) + '.'),
        h('div', { class: 'sp-bar' + (q > 1 ? ' over' : '') }, h('i', { style: 'width:' + Math.min(100, q * 100) + '%' })),
        h('p', { class: 'note' + (q > 1 ? ' neg' : '') }, 'Questa settimana (dal ' + spBrev(ini) + '): spesi ' + L.eur(spSett) + ' su ' + L.eur(bud) + (q > 1 ? ' — sei oltre.' : '.')),
        h('div', { class: 'kv' }, [['Ricorrenti da coprire', L.eur(riserva)], ['Risparmio', L.eur(risp)], ['Entrate', L.eur(ent) + (stim ? ' (stima)' : '')], ['Già speso', L.eur(t.uscite)], ['Ancora da spendere', L.eur(resto)], ['Giorni al 22', String(giorni)]].map(([l, v]) => h('div', {}, h('small', {}, l), v))));
    };
    acc.addEventListener('input', () => { db.settings.accantonare = +String(acc.value).replace(',', '.') || 0; save(); drawWeek(); });
    wk.append(h('h3', {}, isCur ? 'Quanto puoi spendere alla settimana' : 'Quanto hai speso in media a settimana'), wOut, isCur && h('div', { class: 'fld' }, h('label', {}, 'Risparmio da mettere da parte nel periodo €'), acc));
    drawWeek(); body.append(wk);
    if (isCur) body.append(spPrevCard(key, T));
    // ricorrenti
    const ric = rows('ricorrenti').slice().sort((x, y) => (x.prossima || '9').localeCompare(y.prossima || '9'));
    const mese = ric.reduce((s, r) => s + (+r.importo || 0) / (+r.mesi || 1), 0);
    body.append(h('div', { class: 'az-h' }, h('h3', {}, 'Spese ricorrenti', h('span', { class: 'az-n' }, ric.length)), btn('+ Nuova ricorrente', () => openForm('ricorrenti'), '')),
      ric.length ? h('p', { class: 'note' }, 'Al mese (media): ' + L.eur(mese) + ' · all’anno: ' + L.eur(mese * 12)) : h('p', { class: 'note' }, 'Bollette, assicurazioni, abbonamenti, rate: la loro quota viene tenuta da parte nel budget settimanale.'),
      h('div', {}, ric.map((r) => { const g = r.prossima ? spDays(T, r.prossima) : null; return h('div', { class: 'row' + (g != null && g < 0 ? ' late' : ''), tabindex: '0', onclick: () => openForm('ricorrenti', r) }, h('span', { class: 'date' }, r.prossima ? spBrev(r.prossima) : '—'), h('span', { class: 't' }, r.descrizione, h('div', { class: 'note' }, 'ogni ' + (+r.mesi === 1 ? 'mese' : r.mesi + ' mesi') + (g == null ? '' : g < 0 ? ' · scaduta da ' + (-g) + ' gg' : g === 0 ? ' · oggi' : ' · tra ' + g + ' gg'))), h('b', {}, L.eur(+r.importo || 0)), btn('Pagata', () => spPay(r), 'sm')); })));
    // nuovo movimento
    const f = {}; const mk = (k, el) => (f[k] = el);
    const seg = h('div', { class: 'chips' }, ['Uscita', 'Entrata', 'Prelievo'].map((x) => h('a', { class: 'chip' + (SP.tipo === x ? ' on' : ''), href: '#', onclick: (e) => { e.preventDefault(); SP.tipo = x; route(); } }, x)));
    const catList = SP.tipo === 'Uscita' ? SP_CAT : SP.tipo === 'Entrata' ? ['Stipendio', 'Consulenze agronomo', 'Rimborsi', 'Regali ricevuti', 'Altre entrate'] : [];
    const sel = (k, opts, v) => { const s = h('select', {}, opts.map((o) => h('option', { value: o }, o))); s.value = v; return mk(k, s); };
    const fl = (l, el, cls) => h('div', { class: 'fld' + (cls ? ' ' + cls : '') }, h('label', {}, l), el);
    const catSel = SP.tipo !== 'Prelievo' ? sel('categoria', catList, catList[0]) : null, vei = h('select', {}, h('option', { value: '' }, '—'), SP_VEI.map((o) => h('option', { value: o }, o))); mk('veicolo', vei);
    const veiFld = SP.tipo === 'Uscita' ? fl('Veicolo', vei) : null; if (veiFld) { const upd = () => { veiFld.hidden = !['Carburante', 'Manutenzione veicoli', 'Assicurazione/Bollo'].includes(catSel.value); }; catSel.addEventListener('change', upd); upd(); }
    const dt = mk('data', h('input', { type: 'date', value: T })), im = mk('importo', h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: '0,00' })), ds = mk('descrizione', h('input', { type: 'text', placeholder: SP.tipo === 'Entrata' ? 'es. Consulenza' : 'es. Gasolio, Spesa' }));
    const met = SP.tipo !== 'Prelievo' ? sel('metodo', ['Contanti', 'Carta', 'Bonifico'], SP.tipo === 'Entrata' ? 'Bonifico' : 'Contanti') : null;
    if (ds && catSel) {
      let manual = false, auto = false; catSel.addEventListener('change', () => { if (!auto) manual = true; });
      ds.addEventListener('input', () => {
        if (!ds.value.trim()) { manual = false; return; }
        if (manual) return;
        const g = spSuggest(SP.tipo, ds.value, mov); if (!g || !catList.includes(g.cat)) return;
        auto = true; catSel.value = g.cat; catSel.dispatchEvent(new Event('change')); auto = false;
        if (vei && !veiFld.hidden) vei.value = g.vei || (g.cat === 'Carburante' && !vei.value ? 'Nissan' : vei.value);
      });
    }
    body.append(h('h3', {}, 'Aggiungi movimento'), h('div', { class: 'sp-card' }, seg, h('div', { class: 'sp-form' }, fl('Data', dt), fl('Importo €', im), fl('Descrizione', ds, 'w2'), catSel && fl('Categoria', catSel), veiFld, met && fl('Pagamento', met)),
      h('div', { class: 'bar' }, btn('Aggiungi', () => {
        const v = +String(im.value).replace(',', '.'); if (!dt.value || !ds.value.trim() || !(v > 0)) return toast('Servono data, descrizione e importo');
        mov.push({ id: uid(), tipo: SP.tipo, data: dt.value, importo: r2(v), descrizione: ds.value.trim(), categoria: SP.tipo === 'Prelievo' ? 'Prelievo contanti' : catSel.value, metodo: SP.tipo === 'Prelievo' ? 'Contanti' : met.value, veicolo: veiFld && !veiFld.hidden ? vei.value : '', updated: NOW() });
        save(); if (spPer(dt.value) !== SP.per) SP.per = spPer(dt.value); route(); toast('Aggiunto'); }, 'pri'))));
    // categorie
    const cats = Object.entries(t.cat).sort((x, y) => y[1] - x[1]), mx = cats.length ? cats[0][1] : 1;
    body.append(h('h3', {}, 'Uscite per categoria'), cats.length ? h('div', { class: 'sp-cats' }, cats.map(([c, v]) => h('div', { class: 'sp-cat' }, h('span', {}, c), h('div', { class: 'sp-tr' }, h('i', { style: 'width:' + (v / mx * 100) + '%' })), h('b', {}, L.eur(v))))) : h('p', { class: 'note' }, 'Nessuna uscita in questo periodo.'));
    // movimenti
    const lst = h('div'); const draw = () => {
      const q = SP.q.trim().toLowerCase();
      const list = mov.filter((m) => m.data && spPer(m.data) === key && (!q || ((m.descrizione || '') + ' ' + (m.categoria || '') + ' ' + (m.veicolo || '')).toLowerCase().includes(q))).sort((x, y) => (y.data || '').localeCompare(x.data || ''));
      lst.replaceChildren(...(list.length ? list.map((m) => h('div', { class: 'row', tabindex: '0', onclick: () => openForm('movimenti', m) }, h('span', { class: 'date' }, spBrev(m.data)), h('span', { class: 't' }, m.descrizione + (m.veicolo ? ' · ' + m.veicolo : ''), h('div', { class: 'note' }, [m.categoria, m.tipo === 'Prelievo' ? 'Prelievo' : m.metodo].filter(Boolean).join(' · '))), h('b', { class: m.tipo === 'Entrata' ? 'pos' : '' }, (m.tipo === 'Entrata' ? '+' : m.tipo === 'Uscita' ? '−' : '') + L.eur(+m.importo || 0)))) : [h('p', { class: 'note' }, 'Nessun movimento.')]));
    };
    body.append(h('div', { class: 'az-h' }, h('h3', {}, 'Movimenti', h('span', { class: 'az-n' }, mov.filter((m) => m.data && spPer(m.data) === key).length)), h('input', { type: 'search', placeholder: 'Cerca…', value: SP.q, oninput: (e) => { SP.q = e.target.value; draw(); } })), lst);
    draw();
    return root;
  }

  /* ---------- Mappa aziende (Leaflet + OpenStreetMap, posizioni da Nominatim) ---------- */
  const MAP = { f: 'tutte', g: 'comune', q: '', geoBusy: false };
  const loadLeaflet = () => new Promise((ok, ko) => {
    if (window.L && window.L.map) return ok(window.L);
    if (!document.getElementById('leaflet-css')) { const l = document.createElement('link'); l.id = 'leaflet-css'; l.rel = 'stylesheet'; l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.append(l); }
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = () => ok(window.L); s.onerror = () => ko(new Error('Mappa non disponibile: sei offline?')); document.head.append(s);
  });
  const azQuery = (a) => [a.ubicazione, a.comune, a.provincia, 'Italia'].filter(Boolean).join(', ');
  async function geocodeAz(a, onStep) {
    const tries = [azQuery(a), [a.comune, a.provincia, 'Italia'].filter(Boolean).join(', ')].filter((q, i, arr) => q && q !== 'Italia' && arr.indexOf(q) === i);
    for (const q of tries) {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=it&accept-language=it&q=' + encodeURIComponent(q));
      if (!r.ok) throw new Error('Servizio indirizzi non raggiungibile (' + r.status + ')');
      const j = await r.json(); onStep && onStep();
      if (j[0]) { a.lat = +(+j[0].lat).toFixed(6); a.lng = +(+j[0].lon).toFixed(6); a.geoq = q; a.geoApprox = q !== tries[0]; delete a.geoFail; a.updated = NOW(); save(); return true; }
      await new Promise((ok) => setTimeout(ok, 1100));
    }
    a.geoFail = true; a.updated = NOW(); save(); return false;
  }
  function viewMappa() {
    const T = L.today(), all = rows('aziende');
    const prog = new Map(); for (const i of rows('ispezioni')) if (i.azienda && i.stato === 'Programmata' && i.data && i.data >= T && (!prog.has(i.azienda) || i.data < prog.get(i.azienda))) prog.set(i.azienda, i.data);
    const withPos = () => all.filter((a) => a.lat != null && a.lng != null);
    const todo = () => all.filter((a) => (a.lat == null || a.lng == null) && !a.geoFail && (a.ubicazione || a.comune));
    const status = h('p', { class: 'note' }), mapEl = h('div', { id: 'azmap', class: 'azmap' }), listEl = h('div');
    let map = null, layer = null;
    const FL = [['tutte', 'Tutte'], ['prog', 'Con ispezione programmata']];
    const chips = h('div', { class: 'chips' }, FL.map(([k, l]) => h('a', { class: 'chip' + (MAP.f === k ? ' on' : ''), href: '#', onclick: (e) => { e.preventDefault(); MAP.f = k; route(); } }, l)));
    const gmaps = (a, dir) => 'https://www.google.com/maps/' + (dir ? 'dir/?api=1&destination=' : 'search/?api=1&query=') + a.lat + ',' + a.lng;
    /* elenco organizzato per nome / comune / provincia */
    const nz = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const provOf = (a) => { const v = String(a.provincia || '').trim(); return v ? (v.length <= 2 ? v.toUpperCase() : v.replace(/\b\w/g, (c) => c.toUpperCase())) : 'Senza provincia'; };
    const comOf = (a) => String(a.comune || '').trim() || 'Senza comune';
    const GR = [['nome', 'Nome'], ['comune', 'Comune'], ['provincia', 'Provincia'], ['provcom', 'Provincia › Comune']];
    const groupBy = (arr, fn) => { const m = new Map(); for (const a of arr) { const k = fn(a); if (!m.has(k)) m.set(k, []); m.get(k).push(a); } return [...m.entries()].sort((x, y) => (/^Senza /.test(x[0]) ? 1 : 0) - (/^Senza /.test(y[0]) ? 1 : 0) || x[0].localeCompare(y[0], 'it')); };
    const byName = (x, y) => x.ragione.localeCompare(y.ragione, 'it');
    const rowOf = (a) => { const pos = a.lat != null && a.lng != null; return h('div', { class: 'row', tabindex: '0', onclick: () => { if (pos && map) { map.setView([a.lat, a.lng], 14); window.scrollTo(0, 0); } else location.hash = '#/ispezioni/azienda/' + a.id; } }, h('span', { class: 't' }, a.ragione, h('div', { class: 'note' }, [a.ubicazione, a.comune, a.provincia].filter(Boolean).join(', ') || (pos ? '' : 'senza indirizzo'))), pos ? null : h('span', { class: 'tag' }, 'non sulla mappa'), prog.has(a.id) ? h('span', { class: 'tag' }, '📅 ' + L.fmtDate(prog.get(a.id))) : null, pos ? h('a', { href: gmaps(a, true), target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, '➜') : h('a', { href: '#/ispezioni/azienda/' + a.id, onclick: (e) => e.stopPropagation() }, 'Scheda')); };
    const zoomTo = (arr) => { const b = arr.filter((a) => a.lat != null && a.lng != null).map((a) => [a.lat, a.lng]); if (map && b.length) { map.fitBounds(b, { padding: [30, 30], maxZoom: 14 }); window.scrollTo(0, 0); } };
    const grp = (title, arr, inner, open) => h('details', { class: 'inc-c', open: open ? '' : null }, h('summary', {}, h('span', { class: 't' }, title, h('span', { class: 'az-n' }, arr.length)), arr.some((a) => a.lat != null) ? h('button', { type: 'button', class: 'gz', title: 'Mostra sulla mappa', onclick: (e) => { e.preventDefault(); e.stopPropagation(); zoomTo(arr); } }, '📍') : null), h('div', { class: 'inc-l' }, inner));
    const drawList = () => {
      const q = nz(MAP.q).split(/\s+/).filter(Boolean);
      const items = all.filter((a) => (MAP.f !== 'prog' || prog.has(a.id)) && q.every((t) => nz([a.ragione, a.comune, a.provincia, a.ubicazione, a.codice].join(' ')).includes(t)));
      let out;
      if (MAP.g === 'nome') out = groupBy(items, (a) => (nz(a.ragione).charAt(0) || '#').toUpperCase()).map(([k, arr]) => grp(k, arr, arr.sort(byName).map(rowOf), true));
      else if (MAP.g === 'provincia') out = groupBy(items, provOf).map(([k, arr]) => grp(k, arr, arr.sort(byName).map(rowOf), true));
      else if (MAP.g === 'provcom') out = groupBy(items, provOf).map(([k, arr]) => grp(k, arr, groupBy(arr, comOf).map(([c, sub]) => grp(c, sub, sub.sort(byName).map(rowOf), true)), true));
      else out = groupBy(items, comOf).map(([k, arr]) => grp(k, arr, arr.sort(byName).map(rowOf), true));
      listEl.replaceChildren(h('p', { class: 'note' }, items.length + ' aziende' + (q.length ? ' trovate' : '') + ' · ' + new Set(items.map(comOf)).size + ' comuni · ' + new Set(items.map(provOf)).size + ' province'), ...(out.length ? out : [h('div', { class: 'empty' }, 'Nessuna azienda.')]));
    };
    const draw = () => {
      const pts = withPos().filter((a) => MAP.f !== 'prog' || prog.has(a.id));
      status.textContent = pts.length + ' aziende sulla mappa' + (todo().length ? ' · ' + todo().length + ' da localizzare' : '') + (all.filter((a) => a.geoFail).length ? ' · ' + all.filter((a) => a.geoFail).length + ' senza risultato' : '') + '.';
      if (map && layer) {
        layer.clearLayers(); const bounds = [];
        for (const a of pts) {
          const p = prog.get(a.id), m = window.L.circleMarker([a.lat, a.lng], { radius: 9, weight: 2, color: '#fff', fillColor: p ? '#2f7d4a' : '#2b6cb0', fillOpacity: 0.95 });
          const pop = h('div', { class: 'azpop' }, h('b', {}, a.ragione), h('div', {}, [a.ubicazione, a.comune].filter(Boolean).join(', ')), p ? h('div', {}, '📅 Ispezione ' + L.fmtDate(p)) : null, a.geoApprox ? h('div', { class: 'note' }, 'Posizione approssimata (solo comune)') : null,
            h('div', { class: 'azpop-b' }, h('a', { href: '#/ispezioni/azienda/' + a.id }, 'Scheda'), h('a', { href: gmaps(a), target: '_blank', rel: 'noopener' }, 'Google Maps'), h('a', { href: gmaps(a, true), target: '_blank', rel: 'noopener' }, 'Indicazioni')));
          m.bindPopup(pop); m.bindTooltip(a.ragione); m.addTo(layer); bounds.push([a.lat, a.lng]);
        }
        if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
      }
      drawList();
    };
    const runGeo = async (force) => {
      if (MAP.geoBusy) return; if (force) for (const a of all) { delete a.lat; delete a.lng; delete a.geoFail; delete a.geoApprox; }
      const list = todo(); if (!list.length) return; MAP.geoBusy = true; let n = 0;
      try {
        for (const a of list) { if (!document.getElementById('azmap')) break; status.textContent = 'Localizzo le aziende… ' + (++n) + ' / ' + list.length + ' (' + a.ragione + ')'; await geocodeAz(a); draw(); await new Promise((ok) => setTimeout(ok, 1100)); }
      } catch (e) { toast(e.message); } finally { MAP.geoBusy = false; if (!mapEl.isConnected && /ispezioni\/mappa/.test(location.hash)) route(); else if (document.getElementById('azmap')) draw(); }
    };
    const root = h('div', {}, h('p', {}, h('a', { href: '#/ispezioni/aziende' }, '← Aziende')), h('h2', {}, '🗺️ Mappa aziende'), chips,
      h('div', { class: 'bar' }, btn('📍 Localizza le aziende mancanti', () => runGeo(false), 'pri'), btn('↻ Ricalcola tutte le posizioni', () => { if (confirm('Cancellare le posizioni salvate e ricalcolarle (richiede circa 1 secondo per azienda)?')) runGeo(true); }, '')), status,
      h('div', { class: 'note' }, '🟢 ispezione programmata · 🔵 altre aziende. Tocca un pin per scheda, Google Maps e indicazioni.'), mapEl, h('h3', {}, 'Elenco'),
      h('div', { class: 'chips' }, h('span', { class: 'note' }, 'Organizza per:'), GR.map(([k, l]) => h('a', { class: 'chip' + (MAP.g === k ? ' on' : ''), href: '#', onclick: (e) => { e.preventDefault(); MAP.g = k; route(); } }, l))),
      h('input', { type: 'search', class: 'az-q', placeholder: 'Cerca per nome, comune o provincia…', value: MAP.q, 'aria-label': 'Cerca azienda', oninput: (e) => { MAP.q = e.target.value; drawList(); } }), listEl);
    loadLeaflet().then((Lf) => { if (!document.getElementById('azmap')) return; map = Lf.map(mapEl, { zoomControl: true }).setView([44.95, 8.55], 9); Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map); layer = Lf.layerGroup().addTo(map); draw(); if (todo().length) runGeo(false); })
      .catch((e) => { status.textContent = e.message; draw(); });
    draw(); return root;
  }

  function viewCorreggi(vid) {
    const v = byId('verifiche', vid);
    if (!v) return h('div', { class: 'empty' }, 'Verifica non trovata.');
    const studs = studentsOf(v.classe), parts = v.parti || [], r = rng(v), m = maxTot(v);
    const statsBox = h('div'); const refs = new Map();
    const ensure = (sid) => {
      let x = valOf(vid, sid);
      if (!x) { x = { id: uid(), verifica: vid, studente: sid, scores: {}, final: '', assente: false, updated: NOW() }; rows('valutazioni').push(x); }
      if (!x.scores) x.scores = {};
      return x;
    };
    const renderStats = () => {
      const all = studs.map((x) => calcVal(v, valOf(vid, x.id))), done = all.filter((x) => x.eff !== null);
      const avg = done.length ? done.reduce((a, x) => a + x.eff, 0) / done.length : null;
      const bk = [['< 5', 0, 5, 'ko'], ['5–5,9', 5, 6, 'mid'], ['6–6,9', 6, 7, 'ok'], ['7–7,9', 7, 8, 'ok2'], ['8–10', 8, 11, 'top']];
      const ko = done.filter((x) => x.eff < 6).length, cnt = bk.map((x) => done.filter((y) => y.eff >= x[1] && y.eff < x[2]).length);
      statsBox.replaceChildren(
        tiles([['Corrette', done.length + ' / ' + studs.length], ['Media', avg === null ? '—' : fmt1(avg)], ['Insufficienti', ko, ko > 0], ['Voti finali', all.filter((x) => x.fin !== null).length + ' / ' + studs.length]]),
        done.length ? h('div', { class: 'dist' }, h('div', { class: 'dbar' }, bk.map((x, i) => cnt[i] ? h('i', { class: 'd-' + x[3], style: 'flex:' + cnt[i], title: x[0] + ': ' + cnt[i] }, cnt[i]) : null)),
          h('div', { class: 'dleg' }, bk.map((x, i) => h('span', {}, h('b', { class: 'd-' + x[3] }), x[0] + ' · ' + cnt[i])))) : null);
    };
    const updateRow = (st) => {
      const t = refs.get(st.id), cv = calcVal(v, valOf(vid, st.id));
      t.tot.replaceChildren(cv.any ? h('div', { class: 'ptot' }, h('b', {}, fmt1(cv.tot)), h('span', { class: 'pbar' }, h('i', { style: 'width:' + Math.min(100, Math.round(cv.tot / (m || 1) * 100)) + '%' }))) : ''); t.hyp.replaceChildren(votoEl(cv.hyp));
    };
    const head = h('tr', {}, h('th', {}, 'Studente'), parts.map((p) => h('th', {}, p.name, h('div', { class: 'note' }, 'max ' + L.num(p.max)))),
      h('th', {}, 'Punti', h('div', { class: 'note' }, '/ ' + L.num(m))), h('th', {}, 'Voto'), h('th', {}, 'Voto finale'));
    const body = studs.map((st) => {
      const val = valOf(vid, st.id) || {}, ass = !!val.assente;
      const tot = h('td', { class: 'tot' }), hyp = h('td', { class: 'hyp' }); refs.set(st.id, { tot, hyp });
      const rec = h('input', { type: 'date', class: 'rec', 'aria-label': 'Data recupero di ' + st.nome, value: val.rec || '',
        onchange: (e) => { const x = ensure(st.id); x.rec = e.target.value; x.updated = NOW(); save(); } });
      const tagBtn = h('button', { type: 'button', class: 'tagc' + (st.tag ? ' on' : ''), title: 'Tocca per cambiare: nessuno → H → DSA', onclick: () => { st.tag = st.tag === 'H' ? 'DSA' : st.tag === 'DSA' ? '' : 'H'; st.updated = NOW(); save(); route(); } }, st.tag || '+ H/DSA');
      const presBtn = h('button', { type: 'button', class: 'pres' + (ass ? ' abs' : ''), onclick: () => { const x = ensure(st.id); x.assente = !x.assente; x.updated = NOW(); save(); route(); } }, ass ? 'Assente' : 'Presente');
      const nm = h('td', { class: 'nm' }, h('div', { class: 'nmn' }, st.nome), h('div', { class: 'nmc' }, presBtn, tagBtn, ass && rec));
      const pc = parts.map((p) => {
        const inp = h('input', { class: 'score', type: 'number', inputmode: 'decimal', step: '0.25', min: '0', max: String(p.max), 'aria-label': p.name + ' di ' + st.nome });
        if (val.scores && typeof val.scores[p.id] === 'number') inp.value = val.scores[p.id];
        inp.addEventListener('input', () => {
          const raw = inp.value.replace(',', '.'), x = ensure(st.id);
          if (raw === '') delete x.scores[p.id]; else { const n = parseFloat(raw); if (isFinite(n) && n >= 0) x.scores[p.id] = n; }
          inp.classList.toggle('over', typeof x.scores[p.id] === 'number' && x.scores[p.id] > p.max);
          x.updated = NOW(); save(); updateRow(st); renderStats();
        });
        inp.addEventListener('change', () => {
          const x = valOf(vid, st.id);
          if (x && x.scores[p.id] > p.max) { x.scores[p.id] = +p.max; inp.value = p.max; inp.classList.remove('over'); x.updated = NOW(); save(); updateRow(st); renderStats(); }
        });
        return h('td', { 'data-l': p.name + ' (max ' + L.num(p.max) + ')' }, inp);
      });
      const fin = gradeSelect(val.final, (n) => { const x = ensure(st.id); x.final = n; x.updated = NOW(); save(); updateRow(st); renderStats(); }, 'Voto finale di ' + st.nome);
      tot.dataset.l = 'Punti / ' + L.num(m); hyp.dataset.l = 'Voto';
      return h('tr', { class: ass ? 'abs' : '' }, nm, pc, tot, hyp, h('td', { 'data-l': 'Voto finale' }, fin));
    });
    const copy = () => {
      const lines = [['Classe', 'Verifica', 'Studente'].concat(parts.map((p) => p.name), ['Punti', 'Voto ipotetico', 'Voto finale']).join('\t')];
      for (const st of studs) {
        const val = valOf(vid, st.id) || {}, cv = calcVal(v, val), sc = val.scores || {};
        lines.push([lab('classi', v.classe), v.titolo || '', st.nome].concat(parts.map((p) => (typeof sc[p.id] === 'number' ? String(sc[p.id]).replace('.', ',') : '')),
          [cv.any ? String(cv.tot).replace('.', ',') : '', cv.hyp === null ? '' : fmt1(cv.hyp), cv.fin === null ? '' : fmt1(cv.fin)]).join('\t'));
      }
      showText('Risultati della verifica', lines.join('\n'), 'Copia e incolla nel registro o in un foglio di calcolo.');
    };
    const obsUri = () => 'obsidian://new?vault=' + encodeURIComponent('VaultdiRic') + '&file=' + encodeURIComponent('wiki/scuola/' + obsName(v).replace(/\.md$/, '')) + '&overwrite=true&content=' + encodeURIComponent(buildMd(v));
    const root = h('div', {}, h('p', {}, h('a', { href: '#/scuola/verifiche' }, '← Verifiche')), classChips(v.classe, (c) => { const f = firstVer(c.id); return f ? '#/scuola/correggi/' + f.id : '#/scuola/classe/' + c.id; }), h('div', { class: 'vhead' }, h('h2', {}, v.titolo || 'Verifica'), h('div', { class: 'vtags' },
        h('span', { class: 'vt cl' }, (byId('classi', v.classe) || {}).nome || ''), h('span', { class: 'vt' }, matOf(v)), h('span', { class: 'vt' }, perOf(v)), h('span', { class: 'vt' }, '📅 ' + L.fmtDate(v.data)), h('span', { class: 'vt' }, L.num(m) + ' punti')),
        h('p', { class: 'note' }, 'Voto = ' + fmt1(r.min) + ' + punti ÷ ' + L.num(m) + ' × ' + fmt1(r.max - r.min) + ' (da ' + fmt1(r.min) + ' a ' + fmt1(r.max) + '). Si salva da solo.')),
      h('div', { class: 'bar' }, btn('Copia risultati', copy, 'pri'), btn('Modifica struttura', () => openForm('verifiche', v), ''), btn('📝 Scrivi su Obsidian', () => { location.href = obsUri(); }, ''), btn('⬇️ Nota .md', () => deliver(buildMd(v), obsName(v), 'text/markdown'), ''),
        h('a', { class: 'btn', href: '#/scuola/classe/' + v.classe }, 'Studenti della classe')), statsBox);
    if (!studs.length) { root.append(h('div', { class: 'empty' }, 'Questa classe non ha ancora studenti: aggiungili da “Studenti della classe”.')); return root; }
    root.append(h('div', { class: 'scroll cor-w' }, h('table', { class: 'g cor' }, h('thead', {}, head), h('tbody', {}, body))));
    studs.forEach(updateRow); renderStats();
    return root;
  }

  /* ---------- Periodi (trimestri), scheda periodo e scheda azienda ---------- */
  const tag = (txt, c) => h('span', { class: 'pill', 'data-c': c || '' }, txt);

  function viewNoteSpese() {
    const list = rows('noteSpese').slice().sort((a, b) => (a.dataNota || '').localeCompare(b.dataNota || '') || String(a.numero || '').localeCompare(String(b.numero || ''), 'it', { numeric: true }));
    const fi = h('input', { type: 'file', accept: '.xlsx', hidden: true });
    const ser = (v) => (typeof v === 'number' && v > 20000 ? L.addDays('1899-12-30', Math.round(v)) : /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');
    fi.addEventListener('change', async () => {
      try {
        if (typeof DecompressionStream === 'undefined') throw new Error('Browser troppo vecchio');
        const c = await L.xlsxCells(await fi.files[0].arrayBuffer()), col = {};
        Object.keys(c).filter((k) => /^[A-Z]+1$/.test(k)).forEach((k) => { col[String(c[k]).trim().toLowerCase()] = k.replace(/\d/g, ''); });
        const need = ['nota spese', 'data nota spese']; if (need.some((n) => !col[n])) throw new Error('Non riconosco le colonne del foglio (servono «Nota Spese» e «Data Nota Spese»)');
        const nrows = [...new Set(Object.keys(c).map((k) => +k.replace(/\D/g, '')))].filter((n) => n > 1).sort((a, b) => a - b);
        const v = (n, name) => (col[name] ? c[col[name] + n] : undefined), num = (x) => (typeof x === 'number' ? r2(x) : undefined);
        let add = 0, dup = 0;
        for (const n of nrows) {
          const numero = v(n, 'nota spese') == null ? '' : String(v(n, 'nota spese')).trim(), dn = ser(v(n, 'data nota spese'));
          if (!numero || !dn) continue;
          if (rows('noteSpese').some((x) => String(x.numero) === numero)) { dup++; continue; }
          rows('noteSpese').push({ id: uid(), numero, dataNota: dn, rimborsoKm: num(v(n, 'rimborso km')), autostrada: num(v(n, 'autostrada')), ispezioni: num(v(n, 'ispezioni')), fatturaData: ser(v(n, 'fattura emessa')), pagamentoData: ser(v(n, 'data pagamento')), updated: NOW() }); add++;
        }
        save(); route(); toast(add + ' note importate' + (dup ? ' (' + dup + ' già presenti)' : ''));
      } catch (e) { toast('Errore: ' + e.message); }
    });
    const root = h('div', {}, h('div', { class: 'bar' }, btn('+ Nuova nota spese', () => openForm('noteSpese', null, { numero: String(list.length + 1).padStart(2, '0') }), 'pri'), btn('📥 Importa dal foglio Excel', () => fi.click(), ''), fi));
    if (!list.length) { root.append(h('div', { class: 'empty' }, 'Nessuna nota spese. Aggiungila con «+ Nuova nota spese» oppure importa il tuo foglio «Conteggio Note Spese» (.xlsx).')); return root; }
    const T = { rimb: 0, km: 0, aut: 0, isp: 0, tot: 0, epap: 0, bollo: 0, fatt: 0 }, dafatt = list.filter((r) => !r.fatturaData), attesa = list.filter((r) => r.fatturaData && !r.pagamentoData), soll = attesa.filter((r) => nsStato(r).k === 'late');
    root.append(tiles([['Da fatturare', dafatt.length + ' · ' + L.eur(r2(dafatt.reduce((t, r) => t + nsCalc(r).tot, 0))), dafatt.length > 0], ['In attesa di pagamento', L.eur(r2(attesa.reduce((t, r) => t + nsCalc(r).totFatt, 0)))], ['Da sollecitare', soll.length, soll.length > 0], ['Incassato', L.eur(r2(list.filter((r) => r.pagamentoData).reduce((t, r) => t + nsCalc(r).totFatt, 0)))]]));
    const body = list.map((r) => {
      const k = nsCalc(r), st = nsStato(r); T.km += +r.rimborsoKm || 0; T.aut += +r.autostrada || 0; T.rimb += k.rimb; T.isp += +r.ispezioni || 0; T.tot += k.tot; T.epap += k.epap; T.bollo += k.bollo; T.fatt += k.totFatt;
      const money = (x) => h('td', { class: 'r' }, x ? L.eur(+x) : '');
      return h('tr', { class: 'clk', tabindex: '0', onclick: () => openForm('noteSpese', r), onkeydown: (ev) => { if (ev.key === 'Enter') openForm('noteSpese', r); } },
        h('td', {}, r.numero || ''), h('td', {}, r.dataNota ? L.fmtDate(r.dataNota) : ''), h('td', {}, !r.fatturaData && r.dataNota ? L.diffDays(r.dataNota, L.today()) + ' giorni trascorsi' : ''),
        money(r.rimborsoKm), money(r.autostrada), money(k.rimb), money(r.ispezioni), money(k.tot), h('td', {}, r.fatturaData ? L.fmtDate(r.fatturaData) : ''),
        h('td', {}, r.fatturaData && !r.pagamentoData ? h('b', { class: 'ns-' + st.k }, st.t) : ''), h('td', {}, r.pagamentoData ? L.fmtDate(r.pagamentoData) : ''),
        money(k.epap), money(k.bollo), money(k.totFatt), h('td', {}, h('span', { class: 'ns-' + st.k }, st.k === 'ok' ? '✓ Pagata' : st.k === 'todo' ? 'Da fatturare' : st.k === 'late' ? '⚠️ Sollecitare' : r.fatturaData ? 'In attesa' : '')));
    });
    root.append(h('div', { class: 'scroll' }, h('table', { class: 'g' },
      h('thead', {}, h('tr', {}, ['Nota spese', 'Data nota', 'Invio nota spese', 'Rimborso km', 'Autostrada', 'Totale rimborso', 'Ispezioni', 'Totale', 'Fattura emessa', '60 gg', 'Data pagamento', 'EPAP 4%', 'Bollo', 'Totale fattura', 'Stato'].map((x) => h('th', {}, x)))),
      h('tbody', {}, body), h('tfoot', {}, h('tr', {}, h('td', { colspan: 3 }, 'Σ'), ...[T.km, T.aut, T.rimb, T.isp, T.tot].map((x) => h('td', { class: 'r' }, L.eur(r2(x)))), h('td', { colspan: 3 }), ...[T.epap, T.bollo, T.fatt].map((x) => h('td', { class: 'r' }, L.eur(r2(x)))), h('td', {}))))));
    return root;
  }

  function viewDipartimento() {
    const all = rows('riunioni'), oggi = L.today();
    const key = (r) => (r.data || '') + ' ' + (r.ora || '');
    const prox = all.filter((r) => r.stato !== 'Svolta' && (r.data || '9') >= oggi).sort((a, b) => key(a).localeCompare(key(b)));
    const pass = all.filter((r) => !prox.includes(r)).sort((a, b) => key(b).localeCompare(key(a)));
    const verbale = (r) => {
      const v = r.verbale && rows('verbali').find((x) => x.id === r.verbale);
      if (v) { location.hash = '#/scuola/verbale/' + v.id; route(); return; }
      newVerbale('Dipartimento Scienze Agrarie', '', r.data, r.ora, '', (nv) => { r.verbale = nv.id; r.stato = 'Svolta'; r.updated = NOW(); });
    };
    const card = (r) => {
      const v = r.verbale && rows('verbali').find((x) => x.id === r.verbale);
      const pts = (r.odg || '').split('\n').map((x) => x.trim()).filter(Boolean);
      const gg = r.data ? L.diffDays(r.data, oggi) : null;
      return h('div', { class: 'row', tabindex: '0', onclick: () => openForm('riunioni', r) },
        h('span', { class: 't' }, (r.data ? L.fmtDate(r.data) : 'Senza data') + (r.ora ? ' · ' + r.ora : '') + (r.luogo ? ' · ' + r.luogo : ''),
          pts.length ? h('div', { class: 'note' }, pts.length + (pts.length === 1 ? ' punto: ' : ' punti: ') + pts.slice(0, 3).join(' · ') + (pts.length > 3 ? '…' : '')) : null,
          r.decisioni ? h('div', { class: 'note' }, '✔ ' + r.decisioni.split('\n')[0]) : null),
        h('span', { class: 'tag' }, r.stato === 'Svolta' ? 'Svolta' : (gg != null && gg <= 0 ? (gg === 0 ? 'Oggi' : 'tra ' + (-gg) + ' gg') : 'Programmata')),
        r.link ? h('a', { href: r.link, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, '🔗') : null,
        h('button', { type: 'button', class: 'gz', title: v ? 'Apri verbale' : 'Crea verbale', onclick: (e) => { e.stopPropagation(); verbale(r); } }, v ? '📄 Verbale' : '📝 Verbale'));
    };
    const sec = (t, a, vuoto) => h('div', {}, h('h3', {}, t), h('div', { class: 'inc-l' }, a.length ? a.map(card) : [h('div', { class: 'empty' }, vuoto)]));
    return h('div', {}, h('div', { class: 'bar' }, btn('+ Nuova riunione', () => openForm('riunioni', null), 'pri'), btn('+ Verbale Dipartimento', () => newVerbale('Dipartimento Scienze Agrarie'), '')),
      h('p', { class: 'note' }, 'Dipartimento di Scienze Agrarie: tocca 📝 per creare il verbale della riunione (data, ora e luogo vengono copiati).'),
      sec('Prossime riunioni', prox, 'Nessuna riunione in programma.'), sec('Riunioni passate', pass, 'Nessuna riunione registrata.'));
  }

  // Appunti pubblicati sul sito: pagine statiche in appunti/ elencate in appunti/index.json (sola lettura, valgono su tutti i dispositivi)
  const APPUNTI_SITO = { list: null };
  const VER_K = 'gestionale-verifica-appunti'; // argomenti scelti per la verifica (salvati su questo dispositivo; le pagine di appunti scrivono la stessa chiave)
  const verLoad = () => { try { return JSON.parse(localStorage.getItem(VER_K)) || {}; } catch (e) { return {}; } };
  const verSave = (o) => { try { localStorage.setItem(VER_K, JSON.stringify(o)); } catch (e) { /* storage non disponibile */ } };
  const META_K = 'gestionale-appunti-meta'; // data e nota delle pagine pubblicate (stessa chiave usata dentro le pagine)
  const metaLoad = () => { try { return JSON.parse(localStorage.getItem(META_K)) || {}; } catch (e) { return {}; } };
  const pageKey = (link) => (link || '').split('/').pop().replace(/\.html$/, '');
  function viewDiario() {
    const all = rows('diario').slice().sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.updated || '').localeCompare(a.updated || ''));
    const fig = rows('figlie').slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'it'));
    const nz = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const cats = [...new Set(all.map((r) => (r.categoria || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    const list = h('div', {});
    const draw = () => {
      const fl = ui.dgf || '', ct = ui.dgc || '', q = nz(ui.dgq);
      const sh = all.filter((r) => (!fl || (fl === '_t' ? !r.figlia : r.figlia === fl)) && (!ct || (r.categoria || '') === ct) && (!q || nz([r.titolo, r.testo, r.categoria].join(' ')).includes(q)));
      const mesi = new Map();
      for (const r of sh) { const k = (r.data || '').slice(0, 7) || 'senza data'; if (!mesi.has(k)) mesi.set(k, []); mesi.get(k).push(r); }
      const nomeMese = (k) => /^\d{4}-\d\d$/.test(k) ? new Date(k + '-15').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : k;
      const i = [...mesi.keys()];
      list.replaceChildren(...(sh.length ? i.map((k, n) => h('details', { class: 'inc-c', open: n < 2 ? '' : null }, h('summary', {}, h('b', {}, nomeMese(k)), h('span', { class: 'note' }, ' · ' + mesi.get(k).length)),
        h('div', { class: 'inc-l' }, mesi.get(k).map((r) => h('div', { class: 'row', tabindex: '0', onclick: () => openForm('diario', r), onkeydown: (e) => { if (e.key === 'Enter') openForm('diario', r); } },
          h('span', { class: 't' }, (r.titolo || r.categoria || 'Annotazione'), h('div', { class: 'note' }, [r.data ? L.fmtDate(r.data) : '', r.categoria && r.titolo ? r.categoria : ''].filter(Boolean).join(' · ')),
            r.testo ? h('div', { class: 'note' }, r.testo.length > 160 ? r.testo.slice(0, 160) + '…' : r.testo) : null),
          h('span', { class: 'tag' }, r.figlia ? lab('figlie', r.figlia) : 'Tutte')))))) : [h('div', { class: 'empty' }, all.length ? 'Nessuna annotazione con questi filtri.' : 'Il diario è vuoto: tocca “+ Nuova annotazione”.')]));
    };
    const chip = (k, cur, set, l) => h('a', { class: 'chip' + (cur === k ? ' on' : ''), href: '#', onclick: (e) => { e.preventDefault(); set(k); route(); } }, l);
    const search = h('input', { type: 'search', class: 'az-q', placeholder: 'Cerca nel diario…', value: ui.dgq || '', oninput: (e) => { ui.dgq = e.target.value; draw(); } });
    const root = h('div', {}, h('div', { class: 'bar' }, btn('+ Nuova annotazione', () => openForm('diario', null, { figlia: fig.some((f) => f.id === ui.dgf) ? ui.dgf : undefined }), 'pri'), !fig.length ? btn('+ Aggiungi figlia', () => openForm('figlie', null), '') : null),
      fig.length ? h('div', { class: 'chips' }, chip('', ui.dgf || '', (v) => { ui.dgf = v; }, 'Tutte'), fig.map((f) => chip(f.id, ui.dgf || '', (v) => { ui.dgf = v; }, f.nome)), chip('_t', ui.dgf || '', (v) => { ui.dgf = v; }, 'Per tutte')) : h('p', { class: 'note' }, 'Aggiungi prima le figlie (scheda “Figlie”) per segnare a chi si riferisce ogni annotazione.'),
      cats.length ? h('div', { class: 'chips' }, chip('', ui.dgc || '', (v) => { ui.dgc = v; }, 'Ogni categoria'), cats.map((c) => chip(c, ui.dgc || '', (v) => { ui.dgc = v; }, c))) : null,
      search, list, h('p', { class: 'note' }, '🔒 Il diario resta solo su questo dispositivo: non viene sincronizzato.'));
    draw(); return root;
  }

  function viewAppunti() {
    if (!APPUNTI_SITO.list && !APPUNTI_SITO.busy) {
      APPUNTI_SITO.busy = true;
      fetch('appunti/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => []).then((j) => { APPUNTI_SITO.list = Array.isArray(j) ? j : []; if (/#\/scuola\/appunti/.test(location.hash)) route(); });
    }
    const classeNome = (c) => rows('classi').find((x) => normCl(x.nome) === normCl(c));
    const meta = metaLoad();
    const sito = (APPUNTI_SITO.list || []).map((p, i) => ({ id: 'sito' + i, titolo: p.titolo, argomento: p.argomento, materia: p.materia, tipo: p.tipo, data: (meta[pageKey(p.link)] || {}).data || p.data, link: p.link, nota: (meta[pageKey(p.link)] || {}).nota, note: p.note, classe: (classeNome(p.classe) || {}).id, classeTxt: p.classe, sito: true }));
    const all = rows('appunti').concat(sito).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    const g = ui.apg || 'classe', nz = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const classeOf = (r) => (r.classe && lab('classi', r.classe)) || r.classeTxt || 'Senza classe', matOf = (r) => (r.materia || '').trim() || 'Senza materia';
    const list = h('div', {});
    const verPanel = () => {
      const pages = (APPUNTI_SITO.list || []).filter((p) => (p.sezioni || []).length), key = (p) => (p.link || '').split('/').pop().replace(/\.html$/, '');
      if (!pages.length) return null;
      const tot = () => Object.values(verLoad()).reduce((n, a) => n + a.length, 0), sum = h('b', {});
      const upd = () => { const t = tot(); sum.textContent = '🎯 Argomenti per la verifica: ' + (t ? t + ' scelti' : 'nessuno scelto'); };
      upd();
      return h('details', { class: 'inc-c', open: tot() ? '' : null }, h('summary', {}, sum),
        h('p', { class: 'note' }, 'Spunta gli argomenti che userai per la verifica (si possono spuntare anche dentro la pagina degli appunti).'),
        ...pages.map((p) => h('div', {}, h('div', { class: 'note' }, p.titolo + (p.classe ? ' · ' + p.classe : '')),
          ...p.sezioni.map((x) => { const c = h('input', { type: 'checkbox' }); c.checked = (verLoad()[key(p)] || []).includes(x.id);
            c.onchange = () => { const st = verLoad(), a = (st[key(p)] || []).filter((i) => i !== x.id); if (c.checked) a.push(x.id); if (a.length) st[key(p)] = a; else delete st[key(p)]; verSave(st); upd(); draw(); };
            return h('label', { class: 'row', style: 'cursor:pointer' }, c, h('span', { class: 't' }, ' ' + x.titolo), h('a', { href: p.link + '#' + x.id, target: '_blank', rel: 'noopener' }, '📖')); }))));
    };
    const verN = (r) => (r.sito && r.link ? (verLoad()[r.link.split('/').pop().replace(/\.html$/, '')] || []).length : 0);
    const editSito = (r) => {
      const dlg = document.getElementById('dlg'); dlg.replaceChildren();
      const k = pageKey(r.link), m = metaLoad()[k] || {}, d = h('input', { type: 'date', name: 'data' }), t = h('textarea', { name: 'nota', rows: '5' });
      d.value = m.data || r.data || ''; t.value = m.nota || '';
      dlg.append(h('form', { class: 'dlg-in', method: 'dialog' }, h('h2', {}, 'Data e nota: ' + (r.titolo || 'Appunti')),
        h('label', {}, 'Data', d), h('label', {}, 'Nota', t),
        h('div', { class: 'bar' }, btn('Salva', () => { const all2 = metaLoad(); all2[k] = { data: d.value, nota: t.value.trim() }; try { localStorage.setItem(META_K, JSON.stringify(all2)); } catch (e) { /* storage non disponibile */ } dlg.close(); route(); }, 'pri'), btn('Annulla', () => dlg.close()))));
      dlg.showModal();
    };
    const open = (r) => { if (r.link) window.open(r.link, '_blank', 'noopener'); else openForm('appunti', r); };
    const rowOf = (r) => h('div', { class: 'row', tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } },
      h('span', { class: 't' }, r.titolo || r.argomento || 'Appunti', h('div', { class: 'note' }, [r.argomento && r.titolo ? r.argomento : '', g !== 'classe' ? (r.classe || r.classeTxt ? classeOf(r) : '') : '', g !== 'materia' ? r.materia : '', r.tipo, r.data ? L.fmtDate(r.data) : '', verN(r) ? '🎯 ' + verN(r) + ' per la verifica' : ''].filter(Boolean).join(' · ')), r.sito && r.nota ? h('div', { class: 'note' }, '📝 ' + r.nota) : null),
      r.link ? h('a', { href: r.link, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, '📖 Apri') : h('span', { class: 'tag' }, 'senza link'),
      r.sito ? h('button', { type: 'button', class: 'gz', title: 'Data e nota (pagina pubblicata 🌐)', onclick: (e) => { e.stopPropagation(); editSito(r); } }, '✏️') : h('button', { type: 'button', class: 'gz', title: 'Modifica', onclick: (e) => { e.stopPropagation(); openForm('appunti', r); } }, '✏️'));
    const draw = () => {
      const q = nz(ui.apq).split(/\s+/).filter(Boolean), items = all.filter((r) => q.every((t) => nz([r.titolo, r.argomento, r.materia, r.tipo, r.note, r.nota, r.classe || r.classeTxt ? classeOf(r) : ''].join(' ')).includes(t)));
      let out;
      if (g === 'recenti') out = [h('div', { class: 'inc-l' }, items.map(rowOf))];
      else { const m = new Map(); items.forEach((r) => { const k = g === 'materia' ? matOf(r) : classeOf(r); (m.has(k) ? m.get(k) : m.set(k, []).get(k)).push(r); });
        out = [...m.entries()].sort((x, y) => (/^Senza /.test(x[0]) ? 1 : 0) - (/^Senza /.test(y[0]) ? 1 : 0) || x[0].localeCompare(y[0], 'it', { numeric: true })).map(([k, arr]) => h('details', { class: 'inc-c', open: '' }, h('summary', {}, h('span', { class: 't' }, k, h('span', { class: 'az-n' }, arr.length))), h('div', { class: 'inc-l' }, arr.map(rowOf)))); }
      list.replaceChildren(h('p', { class: 'note' }, items.length + ' pagine' + (q.length ? ' trovate' : '')), ...(out.length ? out : [h('div', { class: 'empty' }, 'Nessuna pagina di appunti.')]));
    };
    draw();
    return h('div', {}, h('div', { class: 'bar' }, btn('+ Nuova pagina di appunti', () => openForm('appunti', null), 'pri')),
      h('div', { class: 'chips' }, h('span', { class: 'note' }, 'Raggruppa per:'), [['classe', 'Classe'], ['materia', 'Materia'], ['recenti', 'Più recenti']].map(([k, l]) => h('a', { class: 'chip' + (g === k ? ' on' : ''), href: '#', onclick: (e) => { e.preventDefault(); ui.apg = k; route(); } }, l))),
      verPanel(),
      h('input', { type: 'search', class: 'az-q', placeholder: 'Cerca negli appunti…', value: ui.apq || '', 'aria-label': 'Cerca appunti', oninput: (e) => { ui.apq = e.target.value; draw(); } }), list);
  }

  function viewPeriodi() {
    const list = rows('periodi').slice().sort((a, b) => (a.avvio || '').localeCompare(b.avvio || ''));
    const q = curQuarter();
    const root = h('div', {}, h('div', { class: 'bar' },
      btn('+ Nuovo periodo', () => openForm('periodi', null, { anno: q.y, avvio: L.quarterStart(q), chiusura: L.quarterEnd(q) }), 'pri'),
      btn('📥 Importa Modello 22', () => openImport22(null), '')));
    if (!list.length) { root.append(h('div', { class: 'empty' }, 'Nessun periodo. Carica il Modello 22 del trimestre oppure crea un periodo.')); return root; }
    const T = { tot: 0, imp: 0, somma: 0, p20: 0 };
    const body = list.map((p, i) => {
      const st = periodoStats(p); T.tot += st.tot; T.imp += st.imp; T.somma += st.somma; T.p20 += st.p20;
      return h('tr', { class: 'clk', tabindex: '0', onclick: () => { location.hash = '#/ispezioni/periodo/' + p.id; } },
        h('td', {}, i + 1), h('td', {}, p.anno), h('td', {}, L.fmtDate(p.avvio)), h('td', {}, L.fmtDate(p.chiusura)), h('td', { class: 'r' }, L.eur(st.tot)), h('td', { class: 'r' }, L.eur(st.imp)), h('td', { class: 'r' }, L.eur(st.somma)), h('td', { class: 'r' }, L.eur(st.p20)));
    });
    root.append(h('div', { class: 'scroll' }, h('table', { class: 'g' },
      h('thead', {}, h('tr', {}, ['', 'Anno lavorativo', 'Avvio trimestre', 'Chiusura trimestre', 'Totale', 'Totale ispezioni', 'Totale rimborso', '20%'].map((x) => h('th', {}, x)))),
      h('tbody', {}, body), h('tfoot', {}, h('tr', {}, h('td', { colspan: 4 }, 'Σ'), h('td', { class: 'r' }, L.eur(r2(T.tot))), h('td', { class: 'r' }, L.eur(r2(T.imp))), h('td', { class: 'r' }, L.eur(r2(T.somma))), h('td', { class: 'r' }, L.eur(r2(T.p20))))))));
    return root;
  }

  function viewPeriodo(id) {
    const p = byId('periodi', id);
    if (!p) return h('div', { class: 'empty' }, 'Periodo non trovato.');
    const T = ENT.periodi.title(p), qEnd = p.chiusura || L.today();
    const ids = new Set(rows('piano').filter((r) => r.periodo === id).map((r) => r.azienda).concat(rows('ispezioni').filter((r) => inPer(r, p) && r.azienda).map((r) => r.azienda)));
    const list = [...ids].map((a) => byId('aziende', a)).filter(Boolean).sort((a, b) => a.ragione.localeCompare(b.ragione, 'it'));
    const ispOf = (aid) => rows('ispezioni').find((i) => i.azienda === aid && inPer(i, p));
    const pianoOf = (aid) => rows('piano').find((i) => i.azienda === aid && i.periodo === id);
    const setP = (k, v) => { p[k] = v; p.updated = NOW(); save(); };
    const fld = (label, el) => h('div', { class: 'fld' }, h('label', {}, label), el);
    const anno = h('input', { type: 'number', step: '1', value: p.anno || '', onchange: (e) => { setP('anno', +e.target.value || p.anno); } });
    const av = h('input', { type: 'date', value: p.avvio || '', onchange: (e) => { setP('avvio', e.target.value); route(); } });
    const ch = h('input', { type: 'date', value: p.chiusura || '', onchange: (e) => { setP('chiusura', e.target.value); route(); } });
    const lbl = p.avvio && p.chiusura ? L.periodoLabel(p.avvio, p.chiusura) : '';
    const foot = h('tfoot'), boxes = h('div', { class: 'kv' }); const cellsOf = new Map();
    const refresh = () => {
      const st = periodoStats(p);
      foot.replaceChildren(h('tr', {}, h('td', { colspan: 5, class: 'sg' }, 'Σ'), h('td'), h('td', { class: 'r', 'data-l': 'Autostrada €' }, L.eur(st.aut)), h('td', { class: 'r', 'data-l': 'Rimborso km' }, L.eur(st.rimb)), h('td', { class: 'r', 'data-l': 'Somma rimborso' }, L.eur(st.somma)), h('td'), h('td', { class: 'r', 'data-l': 'Importo ispezione' }, L.eur(st.imp)), h('td', { class: 'r', 'data-l': 'Totale' }, L.eur(st.tot))));
      const kv = (l, v) => h('div', {}, h('small', {}, l), v);
      const epap = h('input', { type: 'checkbox', 'aria-label': 'Applica EPAP', onchange: (e) => { setP('epap', e.target.checked); refresh(); } }); epap.checked = !!p.epap;
      boxes.replaceChildren(kv('20%', L.eur(st.p20)), kv('EPAP (4%)', h('span', {}, L.eur(st.epap) + ' ', h('label', { class: 'note' }, epap, ' applica'))), kv('Da accantonare', L.eur(st.accant)));
    };
    const upd = (x) => { const c = ispCalc(x), cs = cellsOf.get(x.id); if (!cs) return; cs.rimb.textContent = L.eur(c.rimb); cs.somma.textContent = L.eur(c.somma); cs.imp.value = c.imp; cs.tot.textContent = L.eur(c.tot); refresh(); };
    const numIn = (x, key, step) => h('input', { type: 'number', inputmode: 'decimal', step, min: '0', class: 'score', 'aria-label': key, value: x[key] == null || x[key] === '' ? '' : x[key],
      onchange: (e) => { const v = e.target.value.replace(',', '.'); x[key] = v === '' ? '' : Number(v); x.updated = NOW(); save(); upd(x); } });
    const HEADS = ['✓', 'Operatore', 'Organizzazione', 'Data ispezione', 'Pagamento', 'Km', 'Autostrada €', 'Rimborso km', 'Somma rimborso', 'Complessità', 'Importo ispezione', 'Totale'];
    const WIDTHS = [3, 16, 11, 10, 9, 6, 7, 7, 7, 8, 8, 8];
    const tbl = h('div', { class: 'scroll tpw' });
    const draw = () => {
      cellsOf.clear();
      const trs = list.map((a) => {
        const x = ispOf(a.id), pr = pianoOf(a.id), note = (pr && pr.note) || (x && x.note) || '', camp = (pr && pr.campionamento) || (x && x.campionamento) || '';
        const cb = h('input', { type: 'checkbox', 'aria-label': 'Da ispezionare: ' + a.ragione }); cb.checked = !!x;
        cb.addEventListener('change', () => {
          const cur = ispOf(a.id);
          if (cb.checked && !cur) {
            const imp = parseFloat(a.importo);
            rows('ispezioni').push(Object.assign({ id: uid(), periodo: id, data: qEnd, azienda: a.id, tipo: (pr && pr.tipo) || L.tipoDaNote(note), norma: 'Reg. UE 848/2018', stato: 'Programmata', pagamento: 'Da registrare', campionamento: camp, note, updated: NOW() }, isFinite(imp) ? { compenso: imp } : {}));
          } else if (!cb.checked && cur) {
            if (cur.stato !== 'Programmata') { cb.checked = true; return toast('Ispezione già svolta: non si toglie dal periodo'); }
            dropWhere('ispezioni', (y) => y.id === cur.id);
          }
          save(); draw(); refresh();
        });
        const name = h('td', { class: 'nm' }, h('a', { href: '#/ispezioni/azienda/' + a.id }, a.ragione), h('div', { class: 'note' }, [a.comune, a.codice].filter(Boolean).join(' · ')));
        if (!x) return h('tr', { class: 'off' }, h('td', {}, cb), name, h('td', { class: 'note', colspan: 10 }, ['Non da ispezionare', pr && pr.tipo && L.tipoDaNote(note) !== 'Annuale' ? pr.tipo : '', note].filter(Boolean).join(' — ')));
        const cs = { rimb: h('td', { class: 'r' }), somma: h('td', { class: 'r' }), tot: h('td', { class: 'r tot' }) }; cellsOf.set(x.id, cs);
        const dt = h('input', { type: 'date', value: x.data || '', 'aria-label': 'Data ispezione', onchange: (e) => { x.data = e.target.value || qEnd; x.updated = NOW(); save(); } });
        const comp = h('select', { 'aria-label': 'Complessità', onchange: (e) => { x.complessita = e.target.value; if (L.TARIFFE[x.complessita] != null) x.compenso = L.TARIFFE[x.complessita]; x.updated = NOW(); save(); upd(x); } },
          h('option', { value: '' }, '—'), Object.keys(L.TARIFFE).map((k) => h('option', { value: k }, k))); comp.value = x.complessita || '';
        cs.imp = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', class: 'score', 'aria-label': 'Importo ispezione', value: importoOf(x),
          onchange: (e) => { const v = e.target.value.replace(',', '.'); if (v === '') delete x.compenso; else x.compenso = Number(v); x.updated = NOW(); save(); upd(x); } });
        const c = ispCalc(x); cs.rimb.textContent = L.eur(c.rimb); cs.somma.textContent = L.eur(c.somma); cs.tot.textContent = L.eur(c.tot);
        return h('tr', {}, h('td', {}, cb), name,
          h('td', {}, pillSel(fieldOpts('ispezioni', 'stato'), x.stato, (v) => { x.stato = v; x.updated = NOW(); save(); }, 'Organizzazione')), h('td', {}, dt),
          h('td', {}, pillSel(fieldOpts('ispezioni', 'pagamento'), x.pagamento || 'Da registrare', (v) => { x.pagamento = v; x.updated = NOW(); save(); }, 'Pagamento')),
          h('td', {}, numIn(x, 'km', '1')), h('td', {}, numIn(x, 'altreSpese', '0.01')), cs.rimb, cs.somma, h('td', {}, comp), h('td', {}, cs.imp), cs.tot);
      });
      for (const tr of trs) if (!tr.classList.contains('off')) [...tr.children].forEach((td, k) => { td.dataset.l = HEADS[k]; });
      tbl.replaceChildren(h('table', { class: 'g tp' },
        h('colgroup', {}, WIDTHS.map((w) => h('col', { style: 'width:' + w + '%' }))),
        h('thead', {}, h('tr', {}, HEADS.map((x) => h('th', {}, x)))),
        h('tbody', {}, trs), foot));
    };
    const all = (on) => () => {
      for (const a of list) {
        const x = ispOf(a.id), pr = pianoOf(a.id), imp = parseFloat(a.importo);
        if (on && !x) rows('ispezioni').push(Object.assign({ id: uid(), periodo: id, data: qEnd, azienda: a.id, tipo: (pr && pr.tipo) || 'Annuale', norma: 'Reg. UE 848/2018', stato: 'Programmata', pagamento: 'Da registrare', campionamento: (pr && pr.campionamento) || '', note: (pr && pr.note) || '', updated: NOW() }, isFinite(imp) ? { compenso: imp } : {}));
        if (!on && x && x.stato === 'Programmata') dropWhere('ispezioni', (y) => y.id === x.id);
      }
      save(); draw(); refresh();
    };
    const addAz = () => {
      const dlg = document.getElementById('dlg'); dlg.replaceChildren();
      const cand = rows('aziende').filter((a) => !ids.has(a.id)).sort((a, b) => a.ragione.localeCompare(b.ragione, 'it'));
      const pick = h('select', {}, cand.map((a) => h('option', { value: a.id }, a.ragione + (a.comune ? ' (' + a.comune + ')' : ''))));
      dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, '+ Azienda nel periodo'),
        cand.length ? h('div', { class: 'fld' }, h('label', {}, 'Scegli un’azienda già in archivio'), pick) : h('p', { class: 'note' }, 'Tutte le aziende in archivio sono già nel periodo. Creane una nuova da Aziende.'),
        h('div', { class: 'dlg-btns' }, h('button', { type: 'button', onclick: () => dlg.close() }, 'Chiudi'),
          cand.length && h('button', { type: 'button', class: 'pri', onclick: () => { rows('piano').push({ id: uid(), azienda: pick.value, periodo: id, tipo: 'Annuale', campionamento: '', note: '', updated: NOW() }); save(); dlg.close(); route(); } }, 'Aggiungi'))));
      dlg.showModal();
    };
    const notaRows = () => rows('ispezioni').filter((i) => inPer(i, p) && i.azienda && (i.stato !== 'Programmata' || (+i.km || 0) + (+i.kmExtra || 0) + (+i.altreSpese || 0) > 0)).sort((a, b) => (a.data || '').localeCompare(b.data || '')).map((i) => {
      const a = azOf(i.azienda);
      return { operatore: a.ragione || '', codice: a.codice || '', data: i.data, partenza: i.partenza || db.settings.partenza || '', destinazione: i.destinazione || a.comune || '', km: i.km, kmExtra: i.kmExtra, altre: i.altreSpese, complessita: i.complessita || '', importo: importoOf(i) };
    });
    const download = async () => {
      try {
        const rr = notaRows(); if (!rr.length) return toast('Inserisci i km o segna almeno un\'ispezione come Svolta');
        await loadNotaTemplate();
        const bytes = Uint8Array.from(atob(window.NOTA_TEMPLATE), (c) => c.charCodeAt(0));
        const dates = rr.map((r) => r.data).filter(Boolean).sort();
        const out = await L.buildNotaSpese(bytes, { periodo: L.periodoLabel(dates[0], dates[dates.length - 1]), righe: rr });
        const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const a = h('a', { href: url, download: 'Nota_Spese_' + (dates[0] || '').slice(0, 7) + '.xlsx' }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast(rr.length > 22 ? 'Il modello ha 22 righe: le altre sono escluse' : 'Nota spese scaricata');
      } catch (e) { toast('Errore: ' + e.message); }
    };
    const root = h('div', {}, h('p', {}, h('a', { href: '#/ispezioni/periodi' }, '← Periodi')), h('h2', {}, '📋 ' + T),
      h('div', { class: 'row3' }, fld('Anno lavorativo', anno), fld('Avvio trimestre', av), fld('Chiusura trimestre', ch)),
      lbl && h('p', { class: 'note' }, 'Ispezioni BIO effettuate nel mese di ' + lbl),
      h('div', { class: 'bar' }, btn('📥 Importa Modello 22', () => openImport22(id), 'pri'), btn('+ Azienda', addAz, ''), btn('Spunta tutte', all(true), ''), btn('Togli tutte', all(false), ''),
        btn('⬇️ Nota spese (Excel)', download, ''), btn('Modifica periodo', () => openForm('periodi', p), '')),
      h('p', { class: 'note' }, 'Il Modello 22 elenca le aziende del trimestre: spunta quelle da ispezionare. Km a ' + L.eur(L.KM_EURO) + '/km; importo dall\'azienda o dalla complessità (Basso 80 · Medio 90 · Alto 110 · Altro combinato 40 · Altro singolo 70). Si salva da solo.'));
    if (!list.length) { root.append(h('div', { class: 'empty' }, 'Nessuna azienda in questo periodo: carica il Modello 22 o aggiungile a mano.')); return root; }
    draw(); refresh();
    root.append(tbl, boxes);
    return root;
  }

  function openAppuntoContatto(a) {
    const dlg = document.getElementById('dlg'); dlg.replaceChildren();
    const oggi = L.today();
    const prox = rows('ispezioni').filter((i) => i.azienda === a.id && i.data && i.data >= oggi).sort((x, y) => x.data.localeCompare(y.data))[0];
    const contatto = [a.telefono && 'cell. ' + a.telefono, a.fisso && 'fisso ' + a.fisso, a.email].filter(Boolean).join(' · ');
    const fld = (l, el) => h('div', { class: 'fld' }, h('label', {}, l), el);
    const cont = h('input', { type: 'text', value: contatto, placeholder: 'telefono, email, referente…' });
    const isp = h('input', { type: 'date', value: prox ? prox.data : '' });
    const quando = h('input', { type: 'date', value: '' });
    const note = h('textarea', { placeholder: 'Note (facoltative)', style: 'min-height:70px' });
    const status = h('p', { class: 'note' }, '');
    dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, '📞 Appunto: da contattare'), h('p', { class: 'note' }, a.ragione),
      fld('Contatto', cont), fld('Ispezione prevista il', isp), fld('Da contattare entro (facoltativo, crea il promemoria con data)', quando), fld('Note', note), status,
      h('div', { class: 'dlg-btns' }, h('button', { type: 'button', onclick: () => dlg.close() }, 'Annulla'),
        h('button', { type: 'button', class: 'pri', onclick: () => {
          const righe = ['DA CONTATTARE', 'Contatto: ' + (cont.value.trim() || '—'), 'Ispezione prevista il ' + (isp.value ? L.fmtDate(isp.value) : 'xx/xx/xxxx')];
          if (note.value.trim()) righe.push(note.value.trim());
          const rec = { id: uid(), titolo: 'Da contattare: ' + a.ragione + (isp.value ? ' – ispezione prevista ' + L.fmtDate(isp.value) : ''), area: 'Ispezioni', priorita: 'Normale', stato: 'Da fare', azienda: a.id, note: righe.join('\n'), updated: NOW() };
          if (quando.value) rec.data = quando.value;
          rows('promemoria').push(rec); save(); dlg.close(); route(); toast('Appunto creato');
        } }, 'Crea appunto'))));
    dlg.showModal();
  }

  // ispezione Programmata con data = fine periodo: è solo il termine del periodo ispettivo, la data va ancora fissata
  const daFissare = (i) => i.stato === 'Programmata' && (!i.data || (!!i.periodo && (() => { const p = byId('periodi', i.periodo); return !!p && !!p.chiusura && i.data === p.chiusura; })()));
  const entroTxt = (i) => { const p = i.periodo && byId('periodi', i.periodo); return p && p.chiusura ? 'entro ' + L.fmtDate(p.chiusura) : ''; };
  const periodoPerData = (d) => { const ps = rows('periodi').filter((p) => p.avvio && p.chiusura); return (ps.find((p) => d && d >= p.avvio && d <= p.chiusura) || {}).id || ''; };
  async function scaricaNota(rr) {
    try {
      if (!rr.length) return toast('Nessuna ispezione da inserire');
      await loadNotaTemplate();
      const bytes = Uint8Array.from(atob(window.NOTA_TEMPLATE), (c) => c.charCodeAt(0));
      const dates = rr.map((r) => r.data).filter(Boolean).sort();
      const out = await L.buildNotaSpese(bytes, { periodo: L.periodoLabel(dates[0], dates[dates.length - 1]), righe: rr });
      await deliver(out, 'Nota_Spese_' + (dates[0] || '').slice(0, 7) + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      toast(rr.length > 22 ? 'Il modello ha 22 righe: le altre sono escluse' : 'Nota spese pronta');
    } catch (e) { toast('Errore: ' + e.message); }
  }
  // tasti rapidi dell'azienda: "Contattata il…" / "Ispezione fissata il…"
  function openStatoRapido(a, kind) {
    const dlg = document.getElementById('dlg'); dlg.replaceChildren();
    const fissata = kind === 'fissata';
    const prog = rows('ispezioni').filter((i) => i.azienda === a.id && i.stato === 'Programmata').sort((x, y) => (x.data || '').localeCompare(y.data || ''))[0];
    const dt = h('input', { type: 'date', value: fissata ? (prog && prog.data) || '' : L.today() });
    const ora = h('input', { type: 'time', value: (prog && prog.ora) || '' });
    const note = h('textarea', { placeholder: 'Note (facoltative)', style: 'min-height:60px' });
    const fld = (l, el) => h('div', { class: 'fld' }, h('label', {}, l), el);
    dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, fissata ? '📅 Ispezione fissata' : '✅ Contattata'), h('p', { class: 'note' }, a.ragione),
      fld(fissata ? 'Ispezione fissata il' : 'Contattata il', dt), fissata && fld('Ora (facoltativa)', ora), fld('Note', note),
      h('div', { class: 'dlg-btns' }, h('button', { type: 'button', onclick: () => dlg.close() }, 'Annulla'),
        h('button', { type: 'button', class: 'pri', onclick: () => {
          if (!dt.value) { dt.focus(); return toast('Scegli la data'); }
          const now = NOW();
          if (fissata) {
            const per = rows('periodi').find((p) => p.avvio && p.chiusura && dt.value >= p.avvio && dt.value <= p.chiusura);
            if (prog) { prog.data = dt.value; if (ora.value) prog.ora = ora.value; prog.updated = now; }
            else rows('ispezioni').push({ id: uid(), azienda: a.id, data: dt.value, ora: ora.value || '', tipo: 'Annuale', norma: 'Reg. UE 848/2018', stato: 'Programmata', pagamento: 'Da registrare', periodo: per ? per.id : '', updated: now });
          }
          rows('attivita').push({ id: uid(), azienda: a.id, tipo: fissata ? 'Ispezione fissata' : 'Contattata', data: fissata ? L.today() : dt.value, testo: (fissata ? 'Ispezione fissata per il ' + L.fmtDate(dt.value) + (ora.value ? ' ore ' + ora.value : '') + (note.value.trim() ? ' – ' : '') : '') + note.value.trim(), updated: now });
          for (const p of rows('promemoria')) if (p.azienda === a.id && p.stato !== 'Fatto' && /contattare/i.test(p.titolo || '')) { p.stato = 'Fatto'; p.updated = now; }
          save(); dlg.close(); route(); toast(fissata ? 'Ispezione fissata il ' + L.fmtDate(dt.value) : 'Registrato: contattata il ' + L.fmtDate(dt.value));
        } }, 'Salva'))));
    dlg.showModal();
  }

  /* ---------- Scheda pratica: economia (compenso, acconti, spese, saldo), preventivi, documenti e cartelle cloud ---------- */
  function viewPratica(id) {
    const p = byId('pratiche', id);
    if (!p) return h('div', { class: 'empty' }, 'Pratica non trovata.');
    const T = L.today(), cl = p.cliente && byId('clienti', p.cliente), done = ['Consegnata', 'Chiusa'].includes(p.stato), e = pratEco(p);
    const mine = (ek) => rows(ek).filter((x) => x.pratica === id);
    const PCL = { 'In corso': 'info', 'In attesa': 'warn', Consegnata: 'ok', Chiusa: 'ok' };
    const sec = (title, n, buttons, content) => h('section', { class: 'pr-sec' }, h('div', { class: 'az-h' }, h('h3', {}, title, h('span', { class: 'az-n' }, n)), h('div', { class: 'bar' }, buttons)), content);
    const rowOf = (ek, x, date, main, sub, amount, extra) => h('div', { class: 'row', tabindex: '0', onclick: () => openForm(ek, x), onkeydown: (ev) => { if (ev.key === 'Enter') openForm(ek, x); } },
      h('span', { class: 'date' }, date ? L.fmtDate(date) : '—'), h('span', { class: 't' }, main, sub ? h('div', { class: 'note' }, sub) : null, extra || null), amount != null ? h('b', {}, L.eur(+amount || 0)) : null);
    const byData = (a, b) => (b.data || '').localeCompare(a.data || '');
    const pag = mine('pagamenti').sort(byData), spe = mine('spesePratica').sort(byData), prev = mine('preventivi').sort(byData), doc = mine('documenti');
    const prePag = (tipo, imp) => openForm('pagamenti', null, { pratica: id, tipo, importo: imp > 0 ? imp : undefined });
    const pct = e.dovuto > 0 ? Math.min(100, e.incassato / e.dovuto * 100) : 0;
    const pagList = pag.length ? h('div', {}, pag.map((x) => rowOf('pagamenti', x, x.data, x.tipo || 'Pagamento', [x.metodo, x.nota].filter(Boolean).join(' · '), x.importo))) : h('p', { class: 'note' }, 'Nessun pagamento registrato.');
    const speList = spe.length ? h('div', {}, spe.map((x) => rowOf('spesePratica', x, x.data, x.descrizione || 'Spesa', [x.rimborsabile ? 'da rimborsare dal cliente' : 'a tuo carico', x.nota].filter(Boolean).join(' · '), x.importo))) : h('p', { class: 'note' }, 'Nessuna spesa registrata (bolli, visure, trasferte…).');
    const preList = prev.length ? h('div', {}, prev.map((x) => rowOf('preventivi', x, x.data, (x.numero || 'Preventivo') + '  ', x.nota, x.importo, h('div', { class: 'pr-act' }, tag(x.stato || 'Bozza', { Accettato: 'ok', Inviato: 'info', Rifiutato: 'warn' }[x.stato] || ''),
      x.url && h('a', { class: 'btnlink', href: linkOf(x.url), target: '_blank', rel: 'noopener', onclick: (ev) => ev.stopPropagation() }, '📄 Apri'),
      x.stato === 'Accettato' && +x.importo > 0 && +p.compenso !== +x.importo && btn('Usa come compenso', (ev) => { ev.stopPropagation(); p.compenso = +x.importo; p.updated = NOW(); save(); route(); toast('Compenso aggiornato'); }, 'sm'))))) : h('p', { class: 'note' }, 'Nessun preventivo.');
    const docList = doc.length ? h('div', {}, doc.map((x) => h('div', { class: 'row', tabindex: '0', onclick: () => (x.url ? window.open(linkOf(x.url), '_blank', 'noopener') : openForm('documenti', x)) },
      h('span', { class: 'date' }, x.tipo === 'Cartella cloud' ? '📁' : '📄'), h('span', { class: 't' }, x.titolo || x.tipo || 'Documento', h('div', { class: 'note' }, [x.tipo, provider(x.url), x.nota].filter(Boolean).join(' · '))),
      btn('✏️', (ev) => { ev.stopPropagation(); openForm('documenti', x); }, 'sm')))) : h('p', { class: 'note' }, 'Collega la cartella della pratica sul cloud (Drive, iCloud, Dropbox…) e i documenti importanti.');
    const line = (ico, l, v, href) => v ? h('div', { class: 'az-l' }, h('span', { class: 'az-i' }, ico), h('div', {}, h('small', {}, l), href ? h('a', { href: href + v }, v) : h('span', {}, v))) : null;
    const isApi = /apist|apicolt/i.test((p.tipo || '') + ' ' + (p.descrizione || ''));
    const apiSec = () => {
      if (cl && !cl.codApistico && p.apCodice) { cl.codApistico = p.apCodice; cl.updated = NOW(); save(); }
      const den = rows('denunce').filter((x) => x.pratica === id).sort((x, y) => (+x.anno || 0) - (+y.anno || 0)), nonPag = den.filter((x) => !x.pagato);
            const ultimo = den[den.length - 1];
      const tbl = den.length ? h('table', { class: 'g' }, h('thead', {}, h('tr', {}, ['Anno', 'Importo', 'Pagato?', 'Data aggiornamento', 'Note pagamento'].map((c) => h('th', {}, c)))),
        h('tbody', {}, den.map((x) => h('tr', { class: 'clk', tabindex: '0', onclick: () => openForm('denunce', x) },
          h('td', {}, String(x.anno || '')), h('td', {}, L.eur(+x.importo || 0)),
          h('td', {}, h('button', { type: 'button', class: 'apy ' + (x.pagato ? 'si' : 'no'), title: 'Tocca per cambiare', onclick: (ev) => { ev.stopPropagation(); x.pagato = !x.pagato; x.updated = NOW(); save(); route(); } }, h('i', {}, x.pagato ? '✓' : '✕'), x.pagato ? 'Sì' : 'No')),
          h('td', {}, h('div', { class: 'api-dw' }, h('input', { type: 'date', class: 'api-d', value: x.dataAgg || '', 'aria-label': 'Data aggiornamento ' + x.anno, onclick: (ev) => ev.stopPropagation(), onchange: (ev) => { x.dataAgg = ev.target.value; x.updated = NOW(); save(); route(); } }), x.dataAgg ? h('button', { type: 'button', class: 'api-x', title: 'Svuota la data', 'aria-label': 'Svuota la data', onclick: (ev) => { ev.stopPropagation(); x.dataAgg = ''; x.updated = NOW(); save(); route(); } }, '✕') : null)), h('td', {}, x.nota || ''))))) : h('p', { class: 'note' }, 'Nessuna denuncia registrata: usa «+ Nuova denuncia» per aggiungere l’anno.');
      return h('section', { class: 'pr-sec api' }, h('div', { class: 'az-h' }, h('h3', {}, 'Anagrafe apistica', h('span', { class: 'az-n' }, den.length)), h('div', { class: 'bar' }, btn('+ Nuova denuncia', () => openForm('denunce', null, { pratica: id, anno: ultimo ? (+ultimo.anno || new Date().getFullYear()) + 1 : new Date().getFullYear(), importo: ultimo ? ultimo.importo : 40 }), 'pri'))),
        h('div', { class: 'api-top' }, cl ? h('label', { class: 'nf w2' }, h('small', {}, 'Denominazione'), h('input', { type: 'text', value: ENT.clienti.title(cl), readonly: true, tabindex: '-1' })) : null, cl ? h('label', { class: 'nf w2' }, h('small', {}, 'Codice apistico (del cliente)'), h('input', { type: 'text', value: cl.codApistico || '', placeholder: '123AL023', onchange: (ev) => { cl.codApistico = ev.target.value.trim(); cl.updated = NOW(); save(); route(); } })) : h('p', { class: 'note' }, 'Collega un cliente alla pratica (✏️ Modifica) per indicare il codice apistico.')),
        h('h3', { class: 'api-h' }, 'Archivio denunce'), tbl,
        nonPag.length ? h('p', { class: 'note' }, 'Da incassare: ' + nonPag.length + (nonPag.length === 1 ? ' denuncia' : ' denunce') + ' non pagat' + (nonPag.length === 1 ? 'a' : 'e') + ' (' + nonPag.map((x) => x.anno).join(', ') + ') · ' + L.eur(r2(nonPag.reduce((t, x) => t + (+x.importo || 0), 0)))) : null);
    };
    const side = (title, content) => h('section', { class: 'az-side' }, h('div', { class: 'az-h' }, h('h3', {}, title)), content);
    const cli = cl ? [line('👤', 'Cliente', ENT.clienti.title(cl)), line('✉️', 'Email', cl.email, 'mailto:'), line('📱', 'Telefono', cl.telefono, 'tel:')].filter(Boolean) : [];
    const dati = [line('📅', 'Scadenza', p.scadenza ? L.fmtDate(p.scadenza) : ''), line('📝', 'Descrizione', p.descrizione), isApi && line('🐝', 'Codice apistico', cl && cl.codApistico), line('📬', 'Cartella cloud', (doc.find((x) => x.tipo === 'Cartella cloud') || {}).titolo)].filter(Boolean);
    return h('div', { class: 'az pr' }, h('p', {}, h('a', { href: '#/professione/pratiche' }, '← Pratiche')),
      h('div', { class: 'az-top' }, h('div', {}, h('h2', {}, '📁 ' + (p.tipo || 'Pratica')), h('div', { class: 'vtags' }, tag(p.stato || 'Da avviare', PCL[p.stato] || ''), cl && h('span', { class: 'pill' }, ENT.clienti.title(cl)), p.scadenza && tag('scade ' + L.fmtDate(p.scadenza), !done && p.scadenza < T ? 'warn' : ''))),
        h('div', { class: 'bar' }, btn('✏️ Modifica', () => openForm('pratiche', p), ''))),
      h('div', { class: 'bar az-act' }, done ? btn('↩ Riapri', () => { p.stato = 'In corso'; p.updated = NOW(); save(); route(); }, '') : btn('✓ Consegnata', () => { p.stato = 'Consegnata'; p.updated = NOW(); save(); route(); }, 'pri'),
        btn('⧉ Duplica', () => duplicaPratica(p), ''),
        btn('🧾 Crea fattura', () => openForm('fatture', null, { cliente: p.cliente || undefined, importo: e.residuo > 0 ? e.residuo : undefined, descrizione: p.tipo }), ''),
        cl && cl.email && h('a', { class: 'btnlink', href: gmailCompose(cl.email, p.tipo || ''), target: '_blank', rel: 'noopener' }, '✉️ Scrivi (Gmail)')),
      tiles([['Compenso', L.eur(e.compenso)], ['Spese da rimborsare', L.eur(e.speseR)], ['Incassato', L.eur(e.incassato)], ['Residuo', L.eur(e.residuo), e.residuo > 0 && done]]),
      e.dovuto > 0 ? h('div', {}, h('div', { class: 'sp-bar' }, h('i', { style: 'width:' + pct + '%' })), h('p', { class: 'note' }, 'Dovuto ' + L.eur(e.dovuto) + ' (compenso + spese da rimborsare) · incassato ' + Math.round(pct) + '%' + (e.speseC ? ' · spese a tuo carico ' + L.eur(e.speseC) : '') + (e.residuo < 0 ? ' · incassato oltre il dovuto di ' + L.eur(-e.residuo) : ''))) : h('p', { class: 'note' }, 'Inserisci il compenso da «Modifica» (o accetta un preventivo) per vedere il residuo.'),
      h('div', { class: 'az-cols' },
        h('div', { class: 'az-main' },
          isApi ? apiSec() : null,
          sec('Pagamenti', pag.length, [btn('+ Acconto', () => prePag('Acconto'), ''), btn('+ Parziale', () => prePag('Pagamento parziale'), ''), btn('+ Saldo', () => prePag('Saldo', e.residuo), 'pri')], pagList),
          sec('Spese', spe.length, btn('+ Spesa', () => openForm('spesePratica', null, { pratica: id }), ''), speList),
          sec('Preventivi', prev.length, btn('+ Preventivo', () => openForm('preventivi', null, { pratica: id }), ''), preList),
          sec('Documenti e cartelle cloud', doc.length, [btn('📁 Collega cartella', () => openForm('documenti', null, { pratica: id, tipo: 'Cartella cloud' }), 'pri'), btn('+ Documento', () => openForm('documenti', null, { pratica: id, tipo: 'Documento' }), '')], docList)),
        h('aside', { class: 'az-aside' }, cli.length ? side('Cliente', h('div', { class: 'az-card' }, cli)) : null, dati.length ? side('Dati pratica', h('div', { class: 'az-card' }, dati)) : null, p.note ? side('Note', h('p', { class: 'az-note' }, p.note)) : null)));
  }

  function viewAzienda(id) {
    const a = byId('aziende', id);
    if (!a) return h('div', { class: 'empty' }, 'Azienda non trovata.');
    const T = L.today();
    const isp = rows('ispezioni').filter((i) => i.azienda === id);
    const appunti = rows('promemoria').filter((p) => p.azienda === id);
    const att = rows('attivita').filter((x) => x.azienda === id);
    const next = isp.filter((i) => (i.data && i.data >= T || daFissare(i)) && i.stato !== 'Svolta').sort((x, y) => x.data.localeCompare(y.data))[0];
    const open = appunti.filter((p) => p.stato !== 'Fatto').sort((x, y) => (x.data || '9').localeCompare(y.data || '9'));
    const lastDone = isp.filter((i) => i.stato === 'Svolta' || (i.data && i.data < T)).sort((x, y) => (y.data || '').localeCompare(x.data || ''))[0];
    const lastContact = att.filter((x) => x.tipo !== 'Nota').sort((x, y) => (y.data || '').localeCompare(x.data || ''))[0];
    const stage = open.length ? ['Da contattare', 'warn'] : next ? ['Ispezione programmata', 'info'] : lastDone ? ['Ispezione svolta', 'ok'] : ['Nessuna attività', ''];
    const tel = a.telefono || a.fisso;
    const line = (ico, l, v, href) => v ? h('div', { class: 'az-l' }, h('span', { class: 'az-i' }, ico), h('div', {}, h('small', {}, l), href ? h('a', { href: href + v }, v) : h('span', {}, v))) : null;
    const place = [a.ubicazione, [a.comune, a.provincia && '(' + a.provincia + ')'].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const contacts = [line('✉️', 'Email', a.email, 'mailto:'), line('📱', 'Cellulare', a.telefono, 'tel:'), line('☎️', 'Telefono fisso', a.fisso, 'tel:')].filter(Boolean);
    const dati = [line('🆔', 'Codice operatore', a.codice), line('💶', 'Importo ispezione', a.importo !== undefined && a.importo !== '' ? L.eur(+a.importo) : ''), line('📍', 'Ubicazione', place), line('🧑‍🔧', 'Tecnico', a.tecnico)].filter(Boolean);
    const card = (title, content, action) => h('section', { class: 'az-side' }, h('div', { class: 'az-h' }, h('h3', {}, title), action || null), content);
    // prossima azione
    const nx = open[0] ? { ico: '🔔', t: open[0].titolo, d: open[0].data, go: () => openForm('promemoria', open[0]) } : next ? { ico: '📋', t: 'Ispezione' + (next.destinazione ? ' – ' + next.destinazione : ''), d: daFissare(next) ? '' : next.data, w: daFissare(next) ? ['da fissare', entroTxt(next)].filter(Boolean).join(' · ') : '', go: () => openForm('ispezioni', next) } : null;
    const banner = nx ? h('div', { class: 'az-next', tabindex: '0', onclick: nx.go }, h('span', { class: 'az-i' }, nx.ico), h('div', {}, h('small', {}, 'Prossima azione'), h('b', {}, nx.t)), h('span', { class: 'az-when' + (nx.d && nx.d < T ? ' late' : '') }, nx.d ? L.fmtDate(nx.d) : (nx.w || 'senza data'))) : null;
    // timeline unificata
    const ICO = { Contattata: '✅', 'Ispezione fissata': '📅', Chiamata: '📞', Email: '✉️', Messaggio: '💬', Visita: '🚗', Nota: '📝' };
    const items = [];
    for (const x of att) items.push({ k: 'c', d: x.data, ico: ICO[x.tipo] || '📝', t: x.tipo, x: x.testo, go: () => openForm('attivita', x) });
    for (const i of isp) items.push({ k: 'i', d: daFissare(i) ? '' : i.data, w: daFissare(i) ? ['da fissare', entroTxt(i)].filter(Boolean).join(' · ') : '', ico: '📋', t: 'Ispezione' + ([i.partenza, i.destinazione].filter(Boolean).length ? ' · ' + [i.partenza, i.destinazione].filter(Boolean).join(' → ') : ''), x: [i.dataCarico ? 'Carico ' + L.fmtDate(i.dataCarico) : '', i.periodo ? lab('periodi', i.periodo) : ''].filter(Boolean).join(' · '), st: i.stato, go: () => openForm('ispezioni', i) });
    for (const p of appunti) items.push({ k: 'a', d: p.data, ico: p.stato === 'Fatto' ? '✅' : '🔔', t: p.titolo, x: (p.note || '').split('\n').slice(1).join(' · '), st: p.stato === 'Fatto' ? 'Fatto' : 'Aperto', go: () => openForm('promemoria', p) });
    items.sort((x, y) => (y.d || '9999').localeCompare(x.d || '9999'));
    const flt = ui.azf || '';
    const FL = [['', 'Tutto'], ['c', 'Contatti'], ['i', 'Ispezioni'], ['a', 'Appunti']];
    const shown = items.filter((x) => !flt || x.k === flt);
    const mkTl = (arr) => arr.length ? h('div', { class: 'tl' }, arr.map((x) => h('div', { class: 'tl-i' + (x.d && x.d > T ? ' fut' : ''), tabindex: '0', onclick: x.go },
      h('span', { class: 'tl-dot' }, x.ico), h('div', { class: 'tl-b' }, h('div', { class: 'tl-t' }, h('b', {}, x.t), x.st && tag(x.st, CL[x.st] || (x.st === 'Aperto' ? 'warn' : ''))), h('small', {}, (x.d ? L.fmtDate(x.d) : (x.w || 'senza data')) + (x.x ? ' · ' : ''), x.x || ''))))) : h('p', { class: 'note' }, 'Nessuna attività registrata.');
    const tl = mkTl(shown);
    // nota spese per ispezione
    const ispAll = isp.slice().sort((x, y) => (y.data || '').localeCompare(x.data || ''));
    const eurTxt = (n) => L.eur(n);
    const notaBox = h('div', {});
    const drawNota = () => {
      const cs = [];
      const cards = ispAll.map((x) => {
        const out = { rimb: h('b', {}), somma: h('b', {}), tot: h('b', { class: 'tot' }), tot2: h('b', { class: 'tot' }) };
        const upd = () => { const c = ispCalc(x); out.tot2.textContent = eurTxt(c.tot); out.rimb.textContent = eurTxt(c.rimb); out.somma.textContent = eurTxt(c.somma); out.tot.textContent = eurTxt(c.tot); imp.value = c.imp; totAll(); };
        const touch = () => { if (!x.periodo) { const pid = periodoPerData(x.data); if (pid) { x.periodo = pid; per.value = pid; } } x.updated = NOW(); save(); upd(); };
        const num = (k, l, step) => h('label', { class: 'nf' }, h('small', {}, l), h('input', { type: 'number', inputmode: 'decimal', step, min: '0', value: x[k] == null || x[k] === '' ? '' : x[k], onchange: (e) => { const v = e.target.value.replace(',', '.'); x[k] = v === '' ? '' : Number(v); touch(); } }));
        const txt = (k, l, ph) => h('label', { class: 'nf w2' }, h('small', {}, l), h('input', { type: 'text', value: x[k] || '', placeholder: ph || '', onchange: (e) => { x[k] = e.target.value.trim(); touch(); } }));
        const per = h('select', { onchange: (e) => { x.periodo = e.target.value; touch(); } }, h('option', { value: '' }, '— nessuno —'), rows('periodi').slice().sort((p, q) => (q.avvio || '').localeCompare(p.avvio || '')).map((p) => h('option', { value: p.id }, lab('periodi', p.id)))); per.value = x.periodo || '';
        const comp = h('select', { onchange: (e) => { x.complessita = e.target.value; if (L.TARIFFE[x.complessita] != null) x.compenso = L.TARIFFE[x.complessita]; touch(); } }, h('option', { value: '' }, '—'), Object.keys(L.TARIFFE).map((k) => h('option', { value: k }, k + ' (' + L.TARIFFE[k] + ' €)'))); comp.value = x.complessita || '';
        const imp = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: importoOf(x), onchange: (e) => { const v = e.target.value.replace(',', '.'); if (v === '') delete x.compenso; else x.compenso = Number(v); touch(); } });
        const c0 = ispCalc(x); out.rimb.textContent = eurTxt(c0.rimb); out.somma.textContent = eurTxt(c0.somma); out.tot.textContent = eurTxt(c0.tot); out.tot2.textContent = eurTxt(c0.tot); cs.push(x);
        const aperta = ispAll.length === 1 || x.stato === 'Programmata' || (x.data || '') >= T;
        return h('details', { class: 'ns', open: aperta ? '' : null }, h('summary', { class: 'ns-h' }, h('b', {}, daFissare(x) ? 'Data da fissare' : x.data ? L.fmtDate(x.data) : 'senza data'), daFissare(x) && h('span', { class: 'note' }, entroTxt(x)), tag(x.stato, CL[x.stato]), h('span', { class: 'ns-sum1' }, out.tot2), x.periodo && h('a', { href: '#/ispezioni/periodo/' + x.periodo, class: 'note' }, 'periodo'), h('a', { href: '#', class: 'note', onclick: (e) => { e.preventDefault(); openForm('ispezioni', x); } }, 'modifica')),
          h('div', { class: 'ns-g' }, txt('partenza', 'Partenza', db.settings.partenza || ''), txt('destinazione', 'Destinazione', a.comune || ''), num('km', 'Km percorsi', '1'), num('kmExtra', 'Km extra', '1'), num('altreSpese', 'Autostrada / altre spese €', '0.01'),
            h('label', { class: 'nf' }, h('small', {}, 'Complessità'), comp), h('label', { class: 'nf' }, h('small', {}, 'Importo ispezione €'), imp), h('label', { class: 'nf w2' }, h('small', {}, 'Periodo ispettivo (la nota spese confluisce qui)'), per)),
          h('div', { class: 'ns-t' }, h('span', {}, 'Rimborso km ', out.rimb), h('span', {}, 'Somma rimborso ', out.somma), h('span', {}, 'Totale ', out.tot)));
      });
      const tot = h('div', { class: 'ns-sum' });
      const totAll = () => { const t = cs.reduce((s, x) => s + ispCalc(x).tot, 0); tot.textContent = cs.length > 1 ? 'Totale complessivo ' + eurTxt(r2(t)) : ''; };
      totAll();
      notaBox.replaceChildren(...(cards.length ? cards : [h('p', { class: 'note' }, 'Nessuna ispezione: usa “+ Ispezione” per aggiungerla e inserire km e autostrada.')]), tot);
    };
    drawNota();
    const notaRowsAz = () => { const l = ispAll.filter((i) => i.stato !== 'Programmata' || (+i.km || 0) + (+i.kmExtra || 0) + (+i.altreSpese || 0) > 0); return (l.length ? l : ispAll).slice().sort((x, y) => (x.data || '').localeCompare(y.data || '')).map((i) => ({ operatore: a.ragione || '', codice: a.codice || '', data: i.data, partenza: i.partenza || db.settings.partenza || '', destinazione: i.destinazione || a.comune || '', km: i.km, kmExtra: i.kmExtra, altre: i.altreSpese, complessita: i.complessita || '', importo: importoOf(i) })); };
    const tab = ui.azt || 'riep', TABS = [['riep', 'Riepilogo'], ['nota', 'Nota spese · ' + ispAll.length], ['att', 'Attività · ' + items.length]];
    const tabs = h('div', { class: 'chips az-tabs' }, TABS.map(([k, l]) => h('a', { class: 'chip' + (tab === k ? ' on' : ''), href: '#', onclick: (e) => { e.preventDefault(); ui.azt = k; route(); } }, l)));
    const notaTab = h('div', {}, h('div', { class: 'az-h' }, h('h3', {}, 'Nota spese'), h('div', { class: 'bar' }, btn('+ Ispezione', () => openForm('ispezioni', null, { azienda: id, periodo: periodoPerData(L.today()) || undefined }), ''), btn('⬇️ Scarica Excel', () => scaricaNota(notaRowsAz()), 'pri'))), notaBox);
    const attTab = h('div', {}, h('div', { class: 'az-h' }, h('h3', {}, 'Attività', h('span', { class: 'az-n' }, items.length)), h('div', { class: 'bar' }, btn('📝 Nota', () => openForm('attivita', null, { azienda: id, tipo: 'Nota' }), ''))),
      h('div', { class: 'chips' }, FL.map(([k, l]) => h('a', { class: 'chip' + (flt === k ? ' on' : ''), href: '#', onclick: (e) => { e.preventDefault(); ui.azf = k; route(); } }, l))), tl);
    const riepTab = h('div', { class: 'az-cols' },
      h('div', { class: 'az-main' }, h('div', { class: 'az-h' }, h('h3', {}, 'Ultime attività'), items.length > 4 ? h('a', { href: '#', class: 'note', onclick: (e) => { e.preventDefault(); ui.azt = 'att'; route(); } }, 'vedi tutte (' + items.length + ')') : null), mkTl(items.slice(0, 4))),
      h('aside', { class: 'az-aside' },
        card('Contatti', contacts.length ? h('div', { class: 'az-card' }, contacts) : h('p', { class: 'note' }, 'Aggiungi email e telefoni da “Modifica”.')),
        card('Dati azienda', dati.length ? h('div', { class: 'az-card' }, dati) : h('p', { class: 'note' }, '—')),
        a.note && card('Note', h('p', { class: 'az-note' }, a.note))));
    return h('div', { class: 'az' }, h('p', {}, h('a', { href: '#/ispezioni/aziende' }, '← Aziende')),
      h('div', { class: 'az-top' }, h('div', {}, h('h2', {}, '🏢 ' + a.ragione), h('div', { class: 'vtags' }, tag(stage[0], stage[1]), a.codice && h('span', { class: 'pill' }, a.codice), a.comune && h('span', { class: 'pill' }, a.comune + (a.provincia ? ' (' + a.provincia + ')' : '')), lastContact && h('span', { class: 'pill' }, 'ultimo contatto ' + L.fmtDate(lastContact.data)))),
        h('div', { class: 'bar' }, btn('✏️ Modifica', () => openForm('aziende', a), ''))),
      h('div', { class: 'bar az-act' }, tel && h('a', { class: 'btnlink pri', href: 'tel:' + tel }, '📞 Chiama'), a.email && h('a', { class: 'btnlink', href: gmailCompose(a.email), target: '_blank', rel: 'noopener' }, '✉️ Scrivi'), h('a', { class: 'btnlink', href: gmailSearch(a.email ? 'from:' + a.email + ' OR to:' + a.email : '"' + a.ragione + '"'), target: '_blank', rel: 'noopener' }, '🔍 Mail'),
        h('span', { class: 'az-sep' }), btn('✅ Contattata il…', () => openStatoRapido(a, 'contattata'), ''), btn('📅 Ispezione fissata il…', () => openStatoRapido(a, 'fissata'), ''), btn('🔔 Da richiamare', () => openAppuntoContatto(a), '')),
      banner, tabs, tab === 'nota' ? notaTab : tab === 'att' ? attTab : riepTab);
  }

  /* ---------- Nota spese ispettori (modello EcoGruppo) ---------- */
  const loadNotaTemplate = () => new Promise((ok, ko) => {
    if (window.NOTA_TEMPLATE) return ok();
    const sc = document.createElement('script'); sc.src = 'nota-template.js'; sc.onload = ok; sc.onerror = () => ko(new Error('Modello non disponibile (sei offline?)'));
    document.head.append(sc);
  });

  /* ---------- Calendario Apple: abbonamento automatico (file .ics su Supabase Storage) ---------- */
  const uidOf = (s) => { try { return JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || ''; } catch (e) { return ''; } };
  const feedUrl = () => { const s = getSession(), u = s && uidOf(s); return u ? cfg.supabaseUrl + '/storage/v1/object/public/calendario/' + u + '.ics' : ''; };
  const djb = (t) => { let x = 5381; for (let i = 0; i < t.length; i++) x = ((x << 5) + x + t.charCodeAt(i)) | 0; return String(x); };
  function feedICS() {
    const from = L.addDays(L.today(), -14);
    const ev = allEvents().filter((e) => !e.done && synced(e.entKey) && e.date >= from).sort(cmpEv);
    return L.buildICS(ev, Object.assign(icsOpts(), { name: 'Gestionale Agronomo' })).replace('METHOD:PUBLISH', 'METHOD:PUBLISH\r\nX-PUBLISHED-TTL:PT1H\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H');
  }
  async function putFeed(text, retried) {
    let s = getSession(); if (!s) throw new Error('Non collegato');
    if (s.expires_at - 60 < Date.now() / 1000) { await refresh(); s = getSession(); }
    const res = await fetch(cfg.supabaseUrl + '/storage/v1/object/calendario/' + uidOf(s) + '.ics', { method: 'POST',
      headers: { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'text/calendar', 'x-upsert': 'true', 'cache-control': 'max-age=60' }, body: text });
    if (res.status === 401 && !retried) { await refresh(); return putFeed(text, true); }
    if (!res.ok) throw new Error((await res.text()).slice(0, 160) || 'Errore ' + res.status);
  }
  async function publishFeed(manual) {
    if (!cfg.on || !getSession() || !db.settings.calFeed) return;
    try {
      const ics = feedICS(), hash = djb(ics.replace(/DTSTAMP:\S+/g, ''));
      if (!manual && db.meta.feedHash === hash) return;
      await putFeed(ics); db.meta.feedHash = hash; db.meta.feedAt = new Date().toISOString(); persist();
      if (manual) { toast('Calendario aggiornato'); route(); }
    } catch (e) {
      const m = /bucket|not found|policy|row-level|403|404/i.test(e.message) ? 'manca la configurazione su Supabase (script calendario.sql)' : e.message;
      db.meta.feedAt = ''; if (manual) toast('Calendario non aggiornato: ' + m); setStatus('☁️ ⚠️', 'Calendario: ' + m);
    }
  }
  function calendarSection() {
    const box = h('div', {}, h('h3', {}, 'Calendario Apple (automatico)'));
    const s = cfg.on && getSession();
    if (!s) { box.append(h('p', { class: 'note' }, 'Accedi alla sincronizzazione (qui sopra) per attivare l\'abbonamento al Calendario.')); return box; }
    const on = !!db.settings.calFeed, url = feedUrl();
    box.append(h('p', { class: 'note' }, 'Le scadenze (ispezioni, trattamenti, manutenzioni, impegni…) compaiono in Calendario e si aggiornano da sole. Le fatture restano escluse.'),
      h('div', { class: 'bar' }, btn(on ? 'Disattiva' : 'Attiva abbonamento', () => { db.settings.calFeed = !on; save(); if (!on) publishFeed(true); route(); }, on ? '' : 'pri')));
    if (on) {
      const inp = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Link del calendario' });
      box.append(h('div', { class: 'fld' }, h('label', {}, 'Link del calendario'), inp),
        h('div', { class: 'bar' },
          h('a', { class: 'btn pri', href: url.replace(/^https:/, 'webcal:') }, '📲 Abbonati in Calendario'),
          btn('Copia link', async () => { try { await navigator.clipboard.writeText(url); toast('Link copiato'); } catch (e) { inp.select(); toast('Seleziona e copia'); } }, ''),
          btn('Aggiorna ora', () => publishFeed(true), ''),
          btn('🔍 Verifica link', async () => {
            try {
              const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' }), t = await r.text();
              if (r.ok && /^BEGIN:VCALENDAR/.test(t.trim())) toast('Link OK: ' + (t.match(/BEGIN:VEVENT/g) || []).length + ' scadenze pubblicate');
              else if (r.status === 400 || r.status === 404) toast('File non trovato: tocca «Aggiorna ora» e, se resta così, esegui calendario.sql su Supabase');
              else toast('Il link risponde ' + r.status + (r.ok ? ' ma non è un calendario valido' : ''));
            } catch (e) { toast('Link non raggiungibile: ' + e.message); }
          }, '')),
        h('p', { class: 'note' }, db.meta.feedAt ? 'Ultimo aggiornamento: ' + new Date(db.meta.feedAt).toLocaleString('it-IT') + '.' : 'Non ancora pubblicato: se resta così esegui lo script calendario.sql su Supabase (vedi README).'),
        h('p', { class: 'note' }, 'iPhone: tocca "Abbonati". Mac: Calendario → File → Nuovo abbonamento a calendario → incolla il link (se webcal:// dà errore, usa «Copia link» e incolla l\'indirizzo https://). Chi ha il link può leggere le scadenze: non condividerlo. L\'app aggiorna il file a ogni sincronizzazione; Calendario lo rilegge ogni tanto (circa ogni ora).'));
    }
    return box;
  }

  /* ---------- Promemoria Apple ---------- */
  function showReminders(events) {
    const text = L.remindersText(events), dlg = document.getElementById('dlg'); dlg.replaceChildren();
    const ta = h('textarea', { readonly: true, style: 'min-height:200px' }); ta.value = text;
    const sc = 'shortcuts://run-shortcut?name=' + encodeURIComponent('Scadenze in Promemoria') + '&input=text&text=' + encodeURIComponent(text);
    dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, '🔔 Scadenze per Promemoria'), ta,
      h('div', { class: 'bar' }, h('a', { class: 'btn pri', href: sc }, '▶ Invia a Promemoria'),
        navigator.share && btn('Condividi…', async () => { try { await navigator.share({ text }); } catch (e) { /* annullato */ } }, ''),
        btn('Copia', async () => { try { await navigator.clipboard.writeText(text); toast('Copiato'); } catch (e) { ta.select(); toast('Seleziona e copia'); } }, '')),
      h('details', {}, h('summary', {}, 'Prima volta: crea il Comando Rapido (1 minuto)'),
        h('ol', { class: 'note' },
          h('li', {}, 'App Comandi → + → nome: Scadenze in Promemoria.'),
          h('li', {}, 'Aggiungi "Ricevi Testo da Input rapido".'),
          h('li', {}, 'Aggiungi "Dividi testo" (a capo).'),
          h('li', {}, 'Aggiungi "Ripeti con ciascuno": dentro, "Ricava date dall\'input" e poi "Aggiungi nuovo promemoria" con titolo = Elemento ripetuto e data = Date.'),
          h('li', {}, 'Da ora "Invia a Promemoria" crea un promemoria per ogni riga, con la scadenza.'))),
      h('div', { class: 'dlg-btns' }, h('button', { type: 'button', onclick: () => dlg.close() }, 'Chiudi'))));
    dlg.showModal();
  }

  /* ---------- Ripristino / cancellazione (coerenti con la sincronizzazione) ---------- */
  function restoreFrom(o) {
    const old = db; const now = new Date().toISOString(); const nd = normalize(o); const keep = new Set();
    for (const ek of Object.keys(ENT)) for (const r of nd.data[ek]) { r.updated = now; keep.add(r.id); }
    nd.meta = { lastPull: old.meta.lastPull, lastPush: '', lastSync: old.meta.lastSync, deleted: old.meta.deleted.filter((d) => !keep.has(d.id)) };
    for (const ek of Object.keys(ENT)) if (synced(ek)) for (const r of old.data[ek]) if (!keep.has(r.id)) nd.meta.deleted.push({ id: r.id, entity: ek, updated: now });
    db = nd;
  }
  function clearAll() {
    for (const ek of Object.keys(ENT)) for (const r of rows(ek)) tombstone(ek, r.id);
    db = normalize({ meta: db.meta });
  }

  /* ---------- Sincronizzazione (Supabase via REST, nessuna libreria) ---------- */
  const SESS = KEY + ':session';
  const ts = (s) => Date.parse(s) || 0;
  const getSession = () => { try { return JSON.parse(localStorage.getItem(SESS)); } catch (e) { return null; } };
  const setSession = (s) => { if (s) localStorage.setItem(SESS, JSON.stringify(s)); else localStorage.removeItem(SESS); };
  let syncing = false, again = false, syncT;
  function setStatus(txt, title) { const el = document.getElementById('sync'); if (el) { el.textContent = txt; el.title = title || ''; } }
  const toSession = (j, email) => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600), email: email || (j.user && j.user.email) || '' });
  async function authFetch(path, body) {
    const res = await fetch(cfg.supabaseUrl + path, { method: 'POST', headers: { apikey: cfg.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error_description || j.msg || j.message || 'Errore ' + res.status), { http: true });
    return j;
  }
  async function login(email, password) { setSession(toSession(await authFetch('/auth/v1/token?grant_type=password', { email, password }), email)); }
  async function refresh() {
    const s = getSession(); if (!s) throw new Error('Non collegato');
    try { setSession(toSession(await authFetch('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token }), s.email)); }
    catch (e) { if (e.http) { setSession(null); setStatus('☁️ Accedi', 'Sessione scaduta: accedi di nuovo'); } throw e; }
  }
  async function api(method, path, body, headers, retried) {
    let s = getSession(); if (!s) throw new Error('Non collegato');
    if (s.expires_at - 60 < Date.now() / 1000) { await refresh(); s = getSession(); }
    const res = await fetch(cfg.supabaseUrl + path, { method, headers: Object.assign({ apikey: cfg.supabaseKey, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, headers), body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && !retried) { await refresh(); return api(method, path, body, headers, true); }
    if (!res.ok) throw new Error((await res.text()).slice(0, 200) || 'Errore ' + res.status);
    return (res.headers.get('content-type') || '').includes('json') ? res.json() : null;
  }
  function applyRemote(r, pulled) {
    if (!ENT[r.entity] || !synced(r.entity)) return false;
    const list = rows(r.entity); const i = list.findIndex((x) => x.id === r.id); const rt = ts(r.updated);
    if (i >= 0 && ts(list[i].updated) >= rt) return false;
    const ti = db.meta.deleted.findIndex((d) => d.id === r.id);
    if (ti >= 0) { if (ts(db.meta.deleted[ti].updated) >= rt) return false; db.meta.deleted.splice(ti, 1); }
    if (r.deleted) { if (i >= 0) { list.splice(i, 1); return true; } return false; }
    const rec = Object.assign({}, r.data, { id: r.id, updated: new Date(rt).toISOString() });
    pulled[r.id] = rec.updated;
    if (i >= 0) list[i] = rec; else list.push(rec);
    return true;
  }
  async function syncNow(manual) {
    if (!cfg.on || !getSession()) return;
    if (syncing) { again = true; return; }
    if (navigator.onLine === false) { setStatus('☁️ offline', 'Nessuna rete: sincronizzo appena torna'); return; }
    syncing = true; setStatus('⏳', 'Sincronizzazione in corso…');
    try {
      let since = db.meta.lastPull, max = since, changed = false; const pulled = {};
      for (;;) { // 1) scarica le novità (le modifiche più recenti vincono)
        const q = '/rest/v1/records?select=id,entity,data,updated,deleted,synced_at&order=synced_at.asc&limit=1000' + (since ? '&synced_at=gte.' + encodeURIComponent(since) : '');
        const batch = await api('GET', q);
        for (const r of batch) { if (applyRemote(r, pulled)) changed = true; if (!max || ts(r.synced_at) > ts(max)) max = r.synced_at; }
        if (batch.length < 1000 || max === since) break;
        since = max;
      }
      db.meta.lastPull = max;
      const t0 = new Date().toISOString(); const lp = ts(db.meta.lastPush); const out = []; // 2) invia le modifiche locali
      for (const ek of Object.keys(ENT)) if (synced(ek)) for (const r of rows(ek)) if (ts(r.updated) > lp && pulled[r.id] !== r.updated) out.push({ id: r.id, entity: ek, data: r, updated: r.updated, deleted: false });
      const tombs = db.meta.deleted.slice();
      for (const d of tombs) out.push({ id: d.id, entity: d.entity, data: {}, updated: d.updated, deleted: true });
      for (let i = 0; i < out.length; i += 200) await api('POST', '/rest/v1/records?on_conflict=id', out.slice(i, i + 200), { Prefer: 'resolution=merge-duplicates,return=minimal' });
      db.meta.deleted = db.meta.deleted.filter((d) => !tombs.includes(d));
      db.meta.lastPush = t0; db.meta.lastSync = new Date().toISOString();
      setStatus('☁️ ✓', 'Sincronizzato alle ' + new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }));
      publishFeed(false);
      if (changed) route();
    } catch (e) {
      if (getSession()) setStatus('☁️ ⚠️', 'Sincronizzazione non riuscita: ' + e.message);
      if (manual) toast('Sincronizzazione non riuscita: ' + e.message);
    } finally {
      persist(); syncing = false;
      if (again) { again = false; setTimeout(() => syncNow(false), 500); }
    }
  }
  function scheduleSync() { if (!cfg.on || !getSession()) return; clearTimeout(syncT); syncT = setTimeout(() => syncNow(false), 1500); }
  function startSync() {
    const el = document.getElementById('sync');
    if (!cfg.on) { if (el) el.hidden = true; return; }
    const go = () => (getSession() ? syncNow(true) : (location.hash = '#/impostazioni'));
    el.addEventListener('click', go); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    window.addEventListener('online', () => syncNow(false));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(false); });
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(false); }, 60000);
    if (getSession()) syncNow(false); else setStatus('☁️ Accedi', 'Tocca per accedere e sincronizzare');
  }
  function syncSection() {
    const box = h('div', {}, h('h3', {}, 'Sincronizzazione tra dispositivi'));
    if (!cfg.on) { box.append(h('p', { class: 'note' }, 'Non attiva: mancano indirizzo e chiave del progetto in config.js (vedi README).')); return box; }
    const s = getSession();
    if (!s) {
      const em = h('input', { type: 'email', id: 'sy-e', autocomplete: 'username' });
      const pw = h('input', { type: 'password', id: 'sy-p', autocomplete: 'current-password' });
      box.append(h('div', { class: 'set' }, h('div', { class: 'fld' }, h('label', { for: 'sy-e' }, 'Email'), em), h('div', { class: 'fld' }, h('label', { for: 'sy-p' }, 'Password'), pw)),
        h('div', { class: 'bar' }, btn('Accedi e sincronizza', async () => {
          try { await login(em.value.trim(), pw.value); toast('Accesso eseguito'); route(); await syncNow(true); } catch (e) { toast('Accesso non riuscito: ' + e.message); }
        }, 'pri')));
    } else {
      box.append(h('p', { class: 'note' }, 'Collegato come ' + s.email + (db.meta.lastSync ? '. Ultima sincronizzazione: ' + new Date(db.meta.lastSync).toLocaleString('it-IT') : '') + '.'),
        h('div', { class: 'bar' }, btn('🔄 Sincronizza ora', () => syncNow(true), 'pri'), btn('Esci', () => { setSession(null); setStatus('☁️ Accedi', 'Tocca per accedere'); route(); }, '')));
    }
    const loc = cfg.localOnly.map((k) => ENT[k] && ENT[k].label).filter(Boolean).join(', ');
    if (loc) box.append(h('p', { class: 'note' }, 'Solo su questo dispositivo, mai sincronizzati: ' + loc + '.'));
    return box;
  }

  /* ---------- Router ---------- */
  function renderNav(cur) {
    document.getElementById('nav').replaceChildren(...MODS.map((m) => h('a', { href: '#/' + m.id, class: m.id === cur ? 'on' : '' }, h('span', { class: 'i' }, m.icon), m.label)));
  }
  let lastMod = '';
  // collegamento automatico: #/scuola/appunti/nuovo?titolo=…&link=…&classe=3ª A&materia=…&argomento=…&tipo=…
  function importaAppunto() {
    const m = /^#\/scuola\/appunti\/nuovo\?(.*)$/.exec(location.hash || ''); if (!m) return;
    const q = new URLSearchParams(m[1]), g = (k) => (q.get(k) || '').trim().slice(0, 300);
    history.replaceState(null, '', '#/scuola/appunti');
    const link = g('link'); if (!/^https:\/\//i.test(link)) { toast('Link non valido: manca l’indirizzo https'); return; }
    const cn = g('classe'), cl = cn && rows('classi').find((c) => normCl(c.nome) === normCl(cn));
    let r = rows('appunti').find((x) => x.link === link); const nuovo = !r;
    if (!r) { r = { id: uid(), data: L.today() }; rows('appunti').push(r); }
    Object.assign(r, { link, titolo: g('titolo') || r.titolo || '', argomento: g('argomento') || r.argomento || '', materia: g('materia') || r.materia || '', tipo: g('tipo') || r.tipo || 'Appunti', updated: NOW() });
    if (cl) r.classe = cl.id;
    save(); toast(nuovo ? 'Appunti aggiunti: ' + (r.titolo || 'nuova pagina') : 'Appunti aggiornati');
  }
  function route() {
    try { importaAppunto(); } catch (e) { /* non blocca la vista */ }
    try { normTipi(); } catch (e) { /* non blocca la vista */ }
    const [, id = 'oggi', ek, arg] = (location.hash || '#/oggi').split('/');
    const mod = MODS.find((m) => m.id === id) || MODS[0];
    if (lastMod !== mod.id + '/' + (ek || '')) { ui.q = ''; lastMod = mod.id + '/' + (ek || ''); }
    renderNav(mod.id);
    const app = document.getElementById('app');
    app.replaceChildren(mod.id === 'oggi' ? viewOggi() : mod.id === 'impostazioni' ? viewImpostazioni()
      : mod.id === 'scuola' && ek === 'classe' ? viewClasse(arg) : mod.id === 'scuola' && ek === 'correggi' ? viewCorreggi(arg) : mod.id === 'scuola' && ek === 'verbale' ? viewVerbale(arg) : mod.id === 'spese' && ek === 'stipendio' ? ((() => { const [i, d] = String(arg || '').split('_'); history.replaceState(null, '', '#/spese'); setTimeout(() => openStipendioConferma(+i || '', d || ''), 50); })(), viewSpese()) : mod.id === 'spese' && !ek ? viewSpese() : mod.id === 'ispezioni' && ek === 'mappa' ? viewMappa()
      : mod.id === 'ispezioni' && ek === 'periodo' ? viewPeriodo(arg) : mod.id === 'ispezioni' && ek === 'azienda' ? viewAzienda(arg) : mod.id === 'professione' && ek === 'pratica' ? viewPratica(arg) : viewModule(mod, ek));
    fitTables(app);
  }
  // tabelle adattive: a tutta larghezza; su schermi stretti ogni riga diventa una scheda con le etichette delle colonne
  function fitTables(root) {
    for (const t of root.querySelectorAll('table.g:not(.tp):not(.cor)')) {
      const hr = t.querySelector('thead tr:last-child'); if (!hr) continue;
      const labs = [...hr.children].map((x) => x.textContent.trim()); t.classList.add('rs');
      for (const tr of t.querySelectorAll('tbody tr')) [...tr.children].forEach((td, k) => { if (labs[k] && !td.dataset.l) td.dataset.l = labs[k]; });
    }
  }
  document.getElementById('dlg').addEventListener('close', () => document.getElementById('dlg').classList.remove('wide'));
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });
  route();
  startSync();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); }); }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!had || document.getElementById('upd-bar')) return;
      document.body.append(h('div', { id: 'upd-bar', role: 'status' }, h('span', {}, '🔄 Nuova versione disponibile'), h('button', { type: 'button', class: 'pri', onclick: () => location.reload() }, 'Aggiorna'), h('button', { type: 'button', onclick: (e) => e.target.parentNode.remove() }, '✕')));
    });
  }
  window.__gestionale = { publishFeed, feedICS, feedUrl, route, syncNow, login, getSession, get db() { return db; }, seedDemo, ENT };
})();
