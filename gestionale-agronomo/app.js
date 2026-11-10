/* Gestionale Agronomo — PWA senza dipendenze. Dati solo nel dispositivo (localStorage). */
(() => {
  'use strict';
  const L = window.Lib;
  const KEY = 'gestionale-agronomo:v1';
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  // Configurazione sincronizzazione (config.js). Le schede in localOnly non lasciano mai il dispositivo.
  const cfg = Object.assign({ supabaseUrl: '', supabaseKey: '', localOnly: ['fatture', 'studenti', 'valutazioni'] }, window.GESTIONALE_CONFIG);
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

  const defParts = () => [{ id: 'p1', name: 'Vero o falso', max: 6 }, { id: 'p2', name: 'Risposta multipla', max: 6 },
    { id: 'p3', name: 'Aperta 1', max: 8 }, { id: 'p4', name: 'Aperta 2', max: 8 }, { id: 'p5', name: 'Aperta 3', max: 8 }];
  const maxTot = (v) => (v.parti || []).reduce((a, p) => a + (+p.max || 0), 0);
  const fmt1 = (n) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

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
        { k: 'parti', l: 'Parti e punti massimi', t: 'parts' },
        { k: 'vmin', l: 'Voto minimo (con 0 punti)', t: 'number', step: '0.5', def: 3 },
        { k: 'vmax', l: 'Voto massimo (con tutti i punti)', t: 'number', step: '0.5', def: 9 },
        { k: 'note', l: 'Note', t: 'textarea' }],
      title: (r) => (r.titolo || 'Verifica') + (r.classe ? ' – ' + lab('classi', r.classe) : ''),
      cols: ['data'],
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
    { id: 'ispezioni', label: 'Ispezioni', icon: '📋', ents: ['ispezioni', 'aziende'] },
    { id: 'professione', label: 'Professione', icon: '💼', ents: ['pratiche', 'clienti', 'fatture'] },
    { id: 'scuola', label: 'Scuola', icon: '🎓', ents: ['impegni', 'classi', 'verifiche'] },
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
      } else if (f.t === 'parts') {
        const parts = (Array.isArray(val) && val.length ? val : defParts()).map((p) => Object.assign({}, p));
        el = h('div', { class: 'parts' }); el.partsData = parts;
        const draw = () => el.replaceChildren(...parts.map((p, i) => h('div', { class: 'part' },
          h('input', { type: 'text', value: p.name, 'aria-label': 'Nome parte', oninput: (e) => { p.name = e.target.value; } }),
          h('input', { type: 'number', step: '0.25', min: '0', value: p.max, 'aria-label': 'Punti massimi', oninput: (e) => { p.max = parseFloat(e.target.value.replace(',', '.')) || 0; } }),
          btn('✕', () => { if (parts.length > 1) { parts.splice(i, 1); draw(); } }))),
        btn('+ Aggiungi parte', () => { parts.push({ id: uid(), name: 'Parte ' + (parts.length + 1), max: 5 }); draw(); }));
        draw();
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
        if (!confirm(ent.deleteWarn || 'Eliminare questo elemento?')) return;
        if (ent.onDelete) ent.onDelete(r); tombstone(ek, r.id); db.data[ek] = rows(ek).filter((x) => x.id !== r.id); save(); close(); route(); toast('Eliminato');
      } }, 'Elimina'),
      h('button', { type: 'button', onclick: close }, 'Annulla'),
      h('button', { type: 'submit', class: 'pri' }, 'Salva')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      for (const f of ent.fields) {
        const el = inputs[f.k];
        let v = f.t === 'checkbox' ? el.checked : f.t === 'parts' ? el.partsData.map((p) => ({ id: p.id, name: String(p.name).trim() || 'Parte', max: Number(p.max) || 0 })) : el.value.trim();
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
    scuola: () => [['Classi', rows('classi').length], ['Studenti', rows('studenti').length], ['Verifiche', rows('verifiche').length]],
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
        if (a.go) { location.hash = a.go(r); return; }
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
  const votoCls = (x) => (x === null ? 'na' : x >= 6 ? 'ok' : 'ko');
  const votoEl = (x) => h('span', { class: 'voto ' + votoCls(x) }, x === null ? '—' : fmt1(x));

  function viewClasse(id) {
    const c = byId('classi', id);
    if (!c) return h('div', { class: 'empty' }, 'Classe non trovata.');
    const studs = studentsOf(id);
    const vers = rows('verifiche').filter((v) => v.classe === id).sort((a, b) => (a.data || '').localeCompare(b.data || ''));
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
      }, 'pri'), btn('+ Verifica per questa classe', () => openForm('verifiche', null, { classe: id }), '')));
    const root = h('div', {}, h('p', {}, h('a', { href: '#/scuola/classi' }, '← Classi')), h('h2', {}, '👥 ' + ENT.classi.title(c)), addBox);
    if (!studs.length) { root.append(h('div', { class: 'empty' }, 'Nessuno studente. Incolla l\'elenco qui sopra.')); return root; }
    const head = h('tr', {}, h('th', {}, 'Studente'), h('th', {}, 'H / DSA'),
      vers.map((v) => h('th', {}, h('a', { href: '#/scuola/correggi/' + v.id }, v.titolo || 'Verifica'), h('div', { class: 'note' }, L.fmtDate(v.data)))), h('th', {}, 'Media'), h('th', {}));
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
      const bk = [['< 5', 0, 5], ['5–5,9', 5, 6], ['6–6,9', 6, 7], ['7–7,9', 7, 8], ['8–10', 8, 11]];
      const ko = done.filter((x) => x.eff < 6).length;
      statsBox.replaceChildren(
        tiles([['Corrette', done.length + ' / ' + studs.length], ['Media', avg === null ? '—' : fmt1(avg)], ['Insufficienti', ko, ko > 0], ['Voti finali', all.filter((x) => x.fin !== null).length + ' / ' + studs.length]]),
        h('p', { class: 'note' }, 'Distribuzione: ' + bk.map((b) => b[0] + ': ' + done.filter((x) => x.eff >= b[1] && x.eff < b[2]).length).join(' · ')));
    };
    const updateRow = (st) => {
      const t = refs.get(st.id), cv = calcVal(v, valOf(vid, st.id));
      t.tot.textContent = cv.any ? fmt1(cv.tot) : ''; t.hyp.replaceChildren(votoEl(cv.hyp));
    };
    const head = h('tr', {}, h('th', {}, 'Studente'), parts.map((p) => h('th', {}, p.name, h('div', { class: 'note' }, 'max ' + L.num(p.max)))),
      h('th', {}, 'Punti', h('div', { class: 'note' }, '/ ' + L.num(m))), h('th', {}, 'Voto ipotetico'), h('th', {}, 'Voto finale'));
    const body = studs.map((st) => {
      const val = valOf(vid, st.id) || {}, ass = !!val.assente;
      const tot = h('td', { class: 'tot' }), hyp = h('td'); refs.set(st.id, { tot, hyp });
      const rec = h('input', { type: 'date', class: 'rec', 'aria-label': 'Data recupero di ' + st.nome, value: val.rec || '',
        onchange: (e) => { const x = ensure(st.id); x.rec = e.target.value; x.updated = NOW(); save(); } });
      const nm = h('td', { class: 'nm' }, st.nome + (st.tag ? ' (' + st.tag + ')' : ''),
        h('div', {}, btn(ass ? 'Assente' : 'Presente', () => { const x = ensure(st.id); x.assente = !x.assente; x.updated = NOW(); save(); route(); }), ass && rec));
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
        return h('td', {}, inp);
      });
      const fin = h('input', { class: 'score', type: 'number', inputmode: 'decimal', step: '0.5', min: '0', max: '10', 'aria-label': 'Voto finale di ' + st.nome });
      if (typeof val.final === 'number') fin.value = val.final;
      fin.addEventListener('input', () => {
        const raw = fin.value.replace(',', '.'), x = ensure(st.id);
        if (raw === '') x.final = ''; else { const n = parseFloat(raw); if (isFinite(n) && n >= 0) x.final = Math.min(n, 10); }
        x.updated = NOW(); save(); updateRow(st); renderStats();
      });
      return h('tr', {}, nm, pc, tot, hyp, h('td', {}, fin));
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
    const root = h('div', {}, h('p', {}, h('a', { href: '#/scuola/verifiche' }, '← Verifiche')), h('h2', {}, '✏️ ' + ENT.verifiche.title(v)),
      h('p', { class: 'note' }, L.fmtDate(v.data) + ' · ' + L.num(m) + ' punti · voto = ' + fmt1(r.min) + ' + punti ÷ ' + L.num(m) + ' × ' + fmt1(r.max - r.min) + ' (da ' + fmt1(r.min) + ' a ' + fmt1(r.max) + '). Si salva da solo.'),
      h('div', { class: 'bar' }, btn('Modifica struttura', () => openForm('verifiche', v), ''), btn('Copia risultati', copy, ''),
        h('a', { class: 'btn', href: '#/scuola/classe/' + v.classe }, 'Studenti della classe')), statsBox);
    if (!studs.length) { root.append(h('div', { class: 'empty' }, 'Questa classe non ha ancora studenti: aggiungili da “Studenti della classe”.')); return root; }
    root.append(h('div', { class: 'scroll' }, h('table', { class: 'g' }, h('thead', {}, head), h('tbody', {}, body))));
    studs.forEach(updateRow); renderStats();
    return root;
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
    const [, id = 'oggi', ek, arg] = (location.hash || '#/oggi').split('/');
    const mod = MODS.find((m) => m.id === id) || MODS[0];
    if (lastMod !== mod.id + '/' + (ek || '')) { ui.q = ''; lastMod = mod.id + '/' + (ek || ''); }
    renderNav(mod.id);
    const app = document.getElementById('app');
    app.replaceChildren(mod.id === 'oggi' ? viewOggi() : mod.id === 'impostazioni' ? viewImpostazioni()
      : mod.id === 'scuola' && ek === 'classe' ? viewClasse(arg) : mod.id === 'scuola' && ek === 'correggi' ? viewCorreggi(arg) : viewModule(mod, ek));
  }
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });
  route();
  startSync();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__gestionale = { route, syncNow, login, getSession, get db() { return db; }, seedDemo, ENT };
})();
