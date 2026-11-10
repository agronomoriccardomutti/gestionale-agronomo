/* Gestionale Agronomo — PWA senza dipendenze. Dati solo nel dispositivo (localStorage). */
(() => {
  'use strict';
  const L = window.Lib;
  const KEY = 'gestionale-agronomo:v1';
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  // Configurazione sincronizzazione (config.js). Le schede in localOnly non lasciano mai il dispositivo.
  const cfg = Object.assign({ supabaseUrl: '', supabaseKey: '', localOnly: ['fatture'] }, window.GESTIONALE_CONFIG);
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
  const STATI_PRATICA = ['Da avviare', 'In corso', 'In attesa', 'Consegnata', 'Chiusa'];
  const lab = (ek, id) => { const r = id && rows(ek).find((x) => x.id === id); return r ? ENT[ek].title(r) : ''; };
  const prodottiMagazzino = () => rows('magazzino').map((r) => r.prodotto).filter(Boolean);

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
        { k: 'ragione', l: 'Ragione sociale', t: 'text', req: 1 },
        { k: 'comune', l: 'Comune / località', t: 'text' },
        { k: 'cuaa', l: 'CUAA / P.IVA', t: 'text' },
        { k: 'referente', l: 'Referente', t: 'text' },
        { k: 'telefono', l: 'Telefono', t: 'tel' },
        { k: 'colture', l: 'Colture / attività', t: 'text' },
        { k: 'scadCert', l: 'Scadenza certificato', t: 'date' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => r.ragione, cols: ['comune', 'referente', 'telefono', 'scadCert'],
      events: (r) => (r.scadCert ? [{ date: r.scadCert, info: 1, title: 'Scade certificato: ' + r.ragione }] : []),
    },
    ispezioni: {
      label: 'Ispezioni', one: 'ispezione', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'data', l: 'Data ispezione', t: 'date', req: 1, def: 'today' },
        { k: 'ora', l: 'Ora', t: 'time' },
        { k: 'azienda', l: 'Azienda', t: 'ref', to: 'aziende' },
        { k: 'tipo', l: 'Tipo', t: 'select', opts: ['Annuale', 'Supplementare', 'A sorpresa', 'Controllo documentale'] },
        { k: 'norma', l: 'Norma / schema', t: 'select', opts: ['Reg. UE 848/2018', 'SQNPI', 'Altro'] },
        { k: 'stato', l: 'Stato', t: 'select', opts: ['Programmata', 'Eseguita', 'Verbale da consegnare', 'Chiusa'], def: 'Programmata', req: 1 },
        { k: 'scadVerbale', l: 'Scadenza consegna verbale', t: 'date' },
        { k: 'km', l: 'Km percorsi', t: 'number', step: '1' },
        { k: 'compenso', l: 'Compenso (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => (r.azienda ? lab('aziende', r.azienda) : 'Ispezione'),
      cols: ['data', 'tipo', 'norma', 'stato'],
      isDone: (r) => r.stato === 'Chiusa',
      events: (r) => {
        const az = r.azienda ? lab('aziende', r.azienda) : '';
        const comune = r.azienda ? ((rows('aziende').find((x) => x.id === r.azienda) || {}).comune || '') : '';
        const out = [];
        if (r.stato === 'Programmata' && r.data) out.push({ date: r.data, time: r.ora, durationMin: 180, title: 'Ispezione ' + az, location: comune, description: [r.tipo, r.norma].filter(Boolean).join(' – ') });
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
        { k: 'nome', l: 'Nome / ragione sociale', t: 'text', req: 1 },
        { k: 'telefono', l: 'Telefono', t: 'tel' },
        { k: 'email', l: 'Email', t: 'email' },
        { k: 'cfpiva', l: 'C.F. / P.IVA', t: 'text' },
        { k: 'indirizzo', l: 'Indirizzo', t: 'text' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => r.nome, cols: ['telefono', 'email'],
    },
    pratiche: {
      label: 'Pratiche', one: 'pratica', order: { k: 'scadenza', dir: 1 },
      fields: [
        { k: 'cliente', l: 'Cliente', t: 'ref', to: 'clienti' },
        { k: 'tipo', l: 'Tipo pratica', t: 'text', req: 1, list: ['PAC / domanda unica', 'PSR', 'Catasto', 'Estimo', 'Piano fitosanitario (PAN)', 'Progetto verde / giardino', 'Coordinamento sicurezza', 'Formazione', 'Consulenza', 'Altro'] },
        { k: 'descrizione', l: 'Descrizione', t: 'text' },
        { k: 'scadenza', l: 'Scadenza', t: 'date' },
        { k: 'stato', l: 'Stato', t: 'select', opts: STATI_PRATICA, def: 'Da avviare', req: 1 },
        { k: 'compenso', l: 'Compenso (€)', t: 'number', step: '0.01', fmt: 'eur' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => (r.tipo || 'Pratica') + (r.cliente ? ' – ' + lab('clienti', r.cliente) : ''),
      cols: ['descrizione', 'scadenza', 'stato', 'compenso'],
      isDone: (r) => r.stato === 'Consegnata' || r.stato === 'Chiusa',
      events: (r) => (r.scadenza ? [{ date: r.scadenza, title: 'Pratica ' + r.tipo + (r.cliente ? ' – ' + lab('clienti', r.cliente) : ''), description: r.descrizione }] : []),
      actions: [{ label: '✓ Consegnata', show: (r) => !['Consegnata', 'Chiusa'].includes(r.stato), run: (r) => { r.stato = 'Consegnata'; } }],
    },
    fatture: {
      label: 'Fatture', one: 'fattura', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'numero', l: 'Numero', t: 'text', req: 1 },
        { k: 'data', l: 'Data fattura', t: 'date', req: 1, def: 'today' },
        { k: 'cliente', l: 'Cliente', t: 'ref', to: 'clienti' },
        { k: 'importo', l: 'Importo (€)', t: 'number', step: '0.01', req: 1, fmt: 'eur' },
        { k: 'scadPag', l: 'Scadenza pagamento', t: 'date' },
        { k: 'incassata', l: 'Incassata', t: 'checkbox' },
        { k: 'dataIncasso', l: 'Data incasso', t: 'date' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => 'Fattura ' + (r.numero || '') + (r.cliente ? ' – ' + lab('clienti', r.cliente) : ''),
      cols: ['data', 'importo', 'scadPag', 'incassata'],
      isDone: (r) => !!r.incassata,
      events: (r) => (!r.incassata && r.scadPag ? [{ date: r.scadPag, title: 'Incasso fattura ' + r.numero + ' (' + L.eur(r.importo) + ')' + (r.cliente ? ' – ' + lab('clienti', r.cliente) : '') }] : []),
      actions: [{ label: '€ Incassata', show: (r) => !r.incassata, run: (r) => { r.incassata = true; r.dataIncasso = L.today(); } }],
    },
    classi: {
      label: 'Classi', one: 'classe', order: { k: 'nome', dir: 1 },
      fields: [
        { k: 'nome', l: 'Classe', t: 'text', req: 1 },
        { k: 'scuola', l: 'Scuola', t: 'text' },
        { k: 'materia', l: 'Materia / indirizzo', t: 'text' },
        { k: 'ore', l: 'Ore settimanali', t: 'number', step: '1' },
        { k: 'coordinatore', l: 'Sono il coordinatore', t: 'checkbox' },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => r.nome + (r.scuola ? ' – ' + r.scuola : ''), cols: ['materia', 'ore', 'coordinatore'],
    },
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
    { id: 'ispezioni', label: 'Ispezioni', icon: '📋', ents: ['ispezioni', 'aziende'] },
    { id: 'professione', label: 'Professione', icon: '💼', ents: ['pratiche', 'clienti', 'fatture'] },
    { id: 'scuola', label: 'Scuola', icon: '🎓', ents: ['impegni', 'classi'] },
    { id: 'promemoria', label: 'Promemoria', icon: '🔔', ents: ['promemoria'] },
    { id: 'impostazioni', label: 'Impostazioni', icon: '⚙️' },
  ];

  /* ---------- Stato e persistenza ---------- */
  function normalize(o) {
    o = o && typeof o === 'object' ? o : {};
    o.version = 1;
    o.settings = Object.assign({ alarmDays: 1, alarmTime: '09:00', durationMin: 60, soglia: 85000 }, o.settings);
    o.data = o.data && typeof o.data === 'object' ? o.data : {};
    o.meta = Object.assign({ lastPull: '', lastPush: '', lastSync: '', deleted: [] }, o.meta);
    if (!Array.isArray(o.meta.deleted)) o.meta.deleted = [];
    const now = new Date().toISOString();
    for (const k of Object.keys(ENT)) {
      o.data[k] = Array.isArray(o.data[k]) ? o.data[k] : [];
      for (const r of o.data[k]) if (!r.updated) r.updated = now;
    }
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
    if (isNew) for (const f of ent.fields) if (r[f.k] == null && f.def != null) r[f.k] = f.def === 'today' ? L.today() : f.def;
    const dlg = document.getElementById('dlg'); dlg.replaceChildren();
    const inputs = {};
    const form = h('form', { class: 'dlg-in', method: 'dialog' }, h('h2', {}, (isNew ? 'Nuovo: ' : 'Modifica: ') + ent.one));
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
      } else if (f.t === 'checkbox') { el = h('input', { type: 'checkbox', name: f.k }); el.checked = !!val; }
      else {
        el = h('input', { type: f.t === 'number' ? 'number' : f.t, name: f.k, step: f.step, inputmode: f.t === 'number' ? 'decimal' : null, autocomplete: 'off' });
        el.value = val != null ? val : '';
        const list = f.list || (f.listFn && f.listFn());
        if (list && list.length) {
          const id = 'dl-' + f.k; el.setAttribute('list', id);
          form.append(h('datalist', { id }, [...new Set(list)].map((o) => h('option', { value: o }))));
        }
      }
      inputs[f.k] = el;
      form.append(h('div', { class: 'fld' }, h('label', { for: 'f-' + f.k }, f.l + (f.req ? ' *' : '')), (el.id = 'f-' + f.k, el)));
    }
    const close = () => dlg.close();
    form.append(h('div', { class: 'dlg-btns' },
      !isNew && h('button', { type: 'button', class: 'del', onclick: () => {
        if (!confirm('Eliminare questo elemento?')) return;
        tombstone(ek, r.id); db.data[ek] = rows(ek).filter((x) => x.id !== r.id); save(); close(); route(); toast('Eliminato');
      } }, 'Elimina'),
      h('button', { type: 'button', onclick: close }, 'Annulla'),
      h('button', { type: 'submit', class: 'pri' }, 'Salva')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      for (const f of ent.fields) {
        const el = inputs[f.k];
        let v = f.t === 'checkbox' ? el.checked : el.value.trim();
        if (f.t === 'number') v = v === '' ? '' : Number(v);
        if (f.req && (v === '' || v == null)) { el.focus(); return toast('Compila: ' + f.l); }
        r[f.k] = v;
      }
      r.updated = new Date().toISOString();
      const i = rows(ek).findIndex((x) => x.id === r.id);
      if (i >= 0) rows(ek)[i] = r; else rows(ek).push(r);
      save(); close(); route(); toast('Salvato');
    });
    dlg.append(form); dlg.showModal();
  }

  function showText(title, text) {
    const dlg = document.getElementById('dlg'); dlg.replaceChildren();
    const ta = h('textarea', { readonly: true, style: 'min-height:220px' }); ta.value = text;
    dlg.append(h('div', { class: 'dlg-in' }, h('h2', {}, title), ta,
      h('p', { class: 'note' }, 'Incolla nell\'app Promemoria: di norma crea una voce per ogni riga.'),
      h('div', { class: 'dlg-btns' },
        h('button', { type: 'button', onclick: () => dlg.close() }, 'Chiudi'),
        h('button', { type: 'button', class: 'pri', onclick: async () => {
          try { await navigator.clipboard.writeText(text); toast('Copiato'); } catch (e) { ta.select(); toast('Seleziona e copia'); }
        } }, 'Copia'))));
    dlg.showModal();
  }

  /* ---------- Viste ---------- */
  const ui = { q: '', showDone: false };
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
    professione: () => {
      const y = year(); const f = rows('fatture');
      const inc = sum(f.filter((r) => r.incassata && (r.dataIncasso || '').startsWith(y)), 'importo');
      const soglia = +db.settings.soglia || 85000;
      return [['Incassato ' + y, L.eur(inc)], ['Da incassare', L.eur(sum(f.filter((r) => !r.incassata), 'importo'))], ['Soglia forfettario', Math.round(inc / soglia * 100) + '%', inc / soglia > 0.9]];
    },
  };

  function card(ek, r) {
    const ent = ENT[ek]; const done = ent.isDone && ent.isDone(r);
    const meta = [...ent.cols.map((k) => { const f = fieldOf(ent, k); const v = disp(f, r[k]); return v ? (f.t === 'checkbox' ? f.l : v) : null; }).filter(Boolean), ...(ent.extra ? ent.extra(r) : [])];
    const evs = eventsOf(ek, r);
    const next = !done && evs.filter((e) => !e.info || e.date >= L.today()).sort(cmpEv)[0];
    return h('article', { class: 'card' + (done ? ' done' : ''), tabindex: '0', onclick: () => openForm(ek, r),
      onkeydown: (e) => { if (e.key === 'Enter') openForm(ek, r); } },
    h('div', { class: 'card-t' }, ent.title(r) || '(senza titolo)'),
    h('div', { class: 'card-m' }, meta.join(' · ')),
    h('div', { class: 'card-a' },
      next && relBadge(next.date),
      (ent.actions || []).filter((a) => a.show(r)).map((a) => btn(a.label, () => {
        const i = rows(ek).findIndex((x) => x.id === r.id); const copy = Object.assign({}, rows(ek)[i]);
        a.run(copy); copy.updated = new Date().toISOString(); rows(ek)[i] = copy; save(); route();
      })),
      evs.length > 0 && btn('📅 Calendario', () => exportICS(evs, ek + '-' + (ent.title(r) || 'evento').replace(/[^\w]+/g, '_').slice(0, 30) + '.ics'))));
  }

  function viewList(ek) {
    const ent = ENT[ek]; const listEl = h('div', { class: 'list' });
    const fill = () => {
      const q = ui.q.toLowerCase();
      let list = rows(ek).filter((r) => ui.showDone || !(ent.isDone && ent.isDone(r)));
      if (q) list = list.filter((r) => (ent.title(r) + ' ' + ent.fields.map((f) => disp(f, r[f.k])).join(' ')).toLowerCase().includes(q));
      const { k, dir } = ent.order;
      list.sort((a, b) => {
        const av = a[k] || '', bv = b[k] || '';
        if (!av && bv) return 1; if (av && !bv) return -1;
        return String(av).localeCompare(String(bv), 'it') * dir;
      });
      listEl.replaceChildren(...(list.length ? list.map((r) => card(ek, r)) : [h('div', { class: 'empty' }, rows(ek).length ? 'Nessun risultato.' : 'Ancora nessun dato. Premi “+ Nuovo”.')]));
    };
    const bar = h('div', { class: 'bar' },
      h('input', { type: 'search', placeholder: 'Cerca in ' + ent.label.toLowerCase() + '…', 'aria-label': 'Cerca', value: ui.q, oninput: (e) => { ui.q = e.target.value; fill(); } }),
      ent.isDone && h('label', {}, h('input', { type: 'checkbox', checked: ui.showDone, onchange: (e) => { ui.showDone = e.target.checked; fill(); } }), 'Mostra completati'),
      btn('+ Nuovo', () => openForm(ek), 'pri'));
    fill();
    return h('div', {}, bar, listEl);
  }

  function viewModule(mod, ek) {
    ek = mod.ents.includes(ek) ? ek : mod.ents[0];
    return h('div', {}, h('h2', {}, mod.icon + ' ' + mod.label),
      SUMMARY[mod.id] && tiles(SUMMARY[mod.id]()),
      mod.ents.length > 1 && h('div', { class: 'chips' }, mod.ents.map((k) => h('a', { class: 'chip' + (k === ek ? ' on' : ''), href: '#/' + mod.id + '/' + k }, ENT[k].label))),
      viewList(ek));
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
        btn('🔔 Elenco per Promemoria', () => { const f = open.filter((e) => e.date >= t); f.length ? showText('Elenco per Promemoria', L.remindersText(f)) : toast('Nessuna scadenza'); }, '')));
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
        set('soglia', 'Soglia ricavi forfettario (€)', 'number', { min: 0, step: 1000 })),
      h('p', { class: 'note' }, 'Gli eventi esportati hanno un identificativo stabile: se li reimporti dopo averli modificati, il Calendario li aggiorna invece di duplicarli.'),
      syncSection(),
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
  function route() {
    const [, id = 'oggi', ek] = (location.hash || '#/oggi').split('/');
    const mod = MODS.find((m) => m.id === id) || MODS[0];
    if (lastMod !== mod.id + '/' + (ek || '')) { ui.q = ''; lastMod = mod.id + '/' + (ek || ''); }
    renderNav(mod.id);
    const app = document.getElementById('app');
    app.replaceChildren(mod.id === 'oggi' ? viewOggi() : mod.id === 'impostazioni' ? viewImpostazioni() : viewModule(mod, ek));
  }
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });
  route();
  startSync();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__gestionale = { route, syncNow, login, getSession, get db() { return db; }, seedDemo, ENT };
})();
