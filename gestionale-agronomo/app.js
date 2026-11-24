/* Gestionale Agronomo — PWA senza dipendenze. Dati solo nel dispositivo (localStorage). */
(() => {
  'use strict';
  const L = window.Lib;
  const KEY = 'gestionale-agronomo:v1';
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  // Configurazione sincronizzazione (config.js). Le schede in localOnly non lasciano mai il dispositivo.
  const cfg = Object.assign({ supabaseUrl: '', supabaseKey: '', localOnly: ['fatture', 'studenti', 'valutazioni', 'verbali', 'movimenti', 'ricorrenti'] }, window.GESTIONALE_CONFIG);
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

  const gmailSearch = (q) => 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(q);
  const gmailCompose = (to, subj) => 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to) + (subj ? '&su=' + encodeURIComponent(subj) : '');
  const gmailActions = [{ label: '✉️ Scrivi (Gmail)', show: (r) => !!r.email, href: (r) => gmailCompose(r.email) }, { label: '🔍 Mail in Gmail', show: (r) => !!(r.email || r.nome || r.ragione), href: (r) => gmailSearch(r.email ? 'from:' + r.email + ' OR to:' + r.email : '"' + (r.nome || r.ragione) + '"') }];
  const SP_CAT = ['Spesa alimentare','Carburante','Manutenzione veicoli','Assicurazione/Bollo','Casa/Utenze','Telefono/Internet','Farmacia','Salute','Abbigliamento','Bar','Ristoranti/Svago','Regali','Libri/Cultura','Figlie','Abbonamenti','Rate/Finanziamenti','Tasse/Imposte','Altro'];
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
    piano: { label: 'Piano', one: 'voce del piano', order: { k: 'updated', dir: -1 }, fields: [], title: (r) => lab('aziende', r.azienda), cols: [] },
    ispezioni: {
      label: 'Tutte le ispezioni', one: 'ispezione', order: { k: 'data', dir: -1 },
      fields: [
        { k: 'data', l: 'Data ispezione', t: 'date', req: 1, def: 'today' },
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
      cols: ['data', 'tipo', 'stato', 'pagamento'],
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
      title: (r) => r.nome, cols: ['telefono', 'email'], actions: gmailActions,
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
    { id: 'ispezioni', label: 'Ispezioni', icon: '📋', ents: ['periodi', 'aziende', 'ispezioni'] },
    { id: 'professione', label: 'Professione', icon: '💼', ents: ['pratiche', 'clienti', 'fatture'] },
    { id: 'scuola', label: 'Scuola', icon: '🎓', ents: ['impegni', 'classi', 'verifiche', 'verbali', 'docenti', 'cattedre'] },
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
  const CL = { Programmata: 'info', Svolta: 'ok', 'Verbale da consegnare': 'warn', Chiusa: 'ok', 'Da registrare': 'info', Registrato: 'warn', Pagato: 'ok' };
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
  const ui = { azf: '', com: '', q: '', showDone: false, per: '', mat: '' };
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

  const open1 = (ek, r) => { if (ENT[ek].detail) location.hash = ENT[ek].detail(r); else openForm(ek, r); };
  function card(ek, r) {
    const ent = ENT[ek]; const done = ent.isDone && ent.isDone(r);
    const meta = [...ent.cols.map((k) => { const f = fieldOf(ent, k); const v = disp(f, r[k]); return v ? (f.t === 'checkbox' ? f.l : v) : null; }).filter(Boolean), ...(ent.extra ? ent.extra(r) : [])];
    const evs = eventsOf(ek, r);
    const next = !done && evs.filter((e) => !e.info || e.date >= L.today()).sort(cmpEv)[0];
    return h('article', { class: 'card' + (done ? ' done' : ''), tabindex: '0', onclick: () => open1(ek, r),
      onkeydown: (e) => { if (e.key === 'Enter') open1(ek, r); } },
    h('div', { class: 'card-t' }, ent.title(r) || '(senza titolo)'),
    h('div', { class: 'card-m' }, meta.join(' · ')),
    h('div', { class: 'card-a' },
      next && relBadge(next.date),
      (ent.actions || []).filter((a) => a.show(r)).map((a) => btn(a.label, () => {
        if (a.href) { window.open(a.href(r), '_blank', 'noopener'); return; }
        if (a.go) { location.hash = a.go(r); return; }
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
      let list = rows(ek).filter((r) => ui.showDone || !(ent.isDone && ent.isDone(r)));
      if (ek === 'aziende' && ui.com) list = list.filter((r) => (r.comune || '') === ui.com);
      if (toks.length) list = list.filter((r) => { const hay = nz(ent.title(r) + ' ' + ent.fields.map((f) => disp(f, r[f.k])).join(' ')); return toks.every((t) => hay.includes(t)); });
      const { k, dir } = ent.order;
      list.sort((a, b) => {
        const av = a[k] || '', bv = b[k] || '';
        if (!av && bv) return 1; if (av && !bv) return -1;
        return String(av).localeCompare(String(bv), 'it') * dir;
      });
      listEl.replaceChildren(...(list.length ? list.map((r) => card(ek, r)) : [h('div', { class: 'empty' }, rows(ek).length ? 'Nessun risultato.' : 'Ancora nessun dato. Premi “+ Nuovo”.')]));
    };
    const bar = h('div', { class: 'bar' },
      h('input', { type: 'search', placeholder: ek === 'aziende' ? 'Cerca per nome o comune…' : 'Cerca in ' + ent.label.toLowerCase() + '…', 'aria-label': 'Cerca', value: ui.q, oninput: (e) => { ui.q = e.target.value; fill(); } }),
      ek === 'aziende' && (() => { const cs = [...new Set(rows('aziende').map((r) => r.comune).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'it')); if (!cs.length) return null;
        const s = h('select', { 'aria-label': 'Filtra per comune', onchange: (e) => { ui.com = e.target.value; fill(); } }, h('option', { value: '' }, 'Tutti i comuni'), cs.map((c) => h('option', { value: c }, c))); s.value = cs.includes(ui.com) ? ui.com : ''; if (s.value !== ui.com) ui.com = s.value; return s; })(),
      ent.isDone && h('label', {}, h('input', { type: 'checkbox', checked: ui.showDone, onchange: (e) => { ui.showDone = e.target.checked; fill(); } }), 'Mostra completati'),
      btn('+ Nuovo', () => openForm(ek), 'pri'));
    fill();
    return h('div', {}, bar, listEl);
  }

  function viewModule(mod, ek) {
    ek = mod.ents.includes(ek) ? ek : mod.ents[0];
    const body = ek === 'periodi' ? viewPeriodi() : viewList(ek);
    const extra = mod.id === 'scuola' && ek === 'classi' && CLASSI_STD.some((n) => !rows('classi').some((c) => normCl(c.nome) === normCl(n)))
      ? h('div', { class: 'bar' }, btn('➕ Crea classi 3°A 3°B 4°A 4°B 5°A 5°B', creaClassi, 'pri')) : mod.id === 'scuola' && ek === 'verifiche' ? h('div', { class: 'bar' }, btn('📥 Importa verifica', () => openImportVerifica(), 'pri'))
        : mod.id === 'scuola' && ek === 'verbali' ? h('div', { class: 'bar' }, rows('classi').filter((c) => c.coordinatore).map((c) => btn('+ Verbale CdC ' + c.nome, () => newVerbale('Consiglio di classe', c.id), 'pri')), btn('+ Verbale Dipartimento', () => newVerbale('Dipartimento Scienze Agrarie'), ''), h('span', { class: 'note' }, 'Prima inserisci i docenti e le cattedre (schede “Docenti” e “Consigli di classe”). Spunta “Sono il coordinatore” nella tua classe.')) : null;
    return h('div', {}, h('h2', {}, mod.icon + ' ' + mod.label),
      SUMMARY[mod.id] && tiles(SUMMARY[mod.id]()),
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
  function newVerbale(tipo, classe) {
    const prev = rows('verbali').filter((x) => x.tipo === tipo && (tipo !== 'Consiglio di classe' || x.classe === classe)).sort((a, b) => (b.data || '').localeCompare(a.data || ''))[0];
    const base = prev || rows('verbali').slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''))[0] || {};
    const me = rows('docenti').find((d) => /mutti/i.test(d.nome));
    const v = { id: uid(), tipo, classe: tipo === 'Consiglio di classe' ? (classe || '') : '', numero: prev ? (Number(prev.numero) || 0) + 1 : 1, data: L.today(), ora: base.ora || '', oraFine: '', luogo: base.luogo || "nell'aula-informatica",
      segretario: base.segretario || '', coordinatore: base.coordinatore || (me ? me.id : ''), presidente: base.presidente || '', intest1: base.intest1 || 'ITAS "VINCENZO LUPARIA"', intest2: base.intest2 || 'Via Luparia, 14 - ROSIGNANO M.TO (AL) - FRAZ. SAN MARTINO',
      istituto: base.istituto || 'Istituto Superiore “V. LUPARIA”', citta: base.citta || 'SAN MARTINO DI ROSIGNANO', assenti: [], odg: [], updated: NOW() };
    rows('verbali').push(v); save(); location.hash = '#/scuola/verbale/' + v.id; route();
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
      body.append(h('div', { class: 'sp-ban' }, h('div', {}, h('b', {}, 'Nuovo periodo. '), 'Inserisci lo stipendio per far partire il conteggio.'), h('div', { class: 'bar' }, d, im, btn('Registra stipendio', () => { const v = +String(im.value).replace(',', '.'); if (!d.value || !(v > 0)) return toast('Data e importo'); mov.push({ id: uid(), tipo: 'Entrata', data: d.value, importo: r2(v), descrizione: 'Stipendio', categoria: 'Stipendio', metodo: 'Bonifico', veicolo: '', updated: NOW() }); save(); route(); }, 'pri'))));
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
    if (ds && catSel) ds.addEventListener('change', () => { if (SP.tipo === 'Uscita' && /gasolio|benzina|carburante|diesel/i.test(ds.value)) { catSel.value = 'Carburante'; catSel.dispatchEvent(new Event('change')); if (!vei.value) vei.value = 'Nissan'; } });
    body.append(h('h3', {}, 'Aggiungi movimento'), seg, h('div', { class: 'sp-form' }, fl('Data', dt), fl('Importo €', im), fl('Descrizione', ds, 'w2'), catSel && fl('Categoria', catSel), veiFld, met && fl('Pagamento', met)),
      h('div', { class: 'bar' }, btn('Aggiungi', () => {
        const v = +String(im.value).replace(',', '.'); if (!dt.value || !ds.value.trim() || !(v > 0)) return toast('Servono data, descrizione e importo');
        mov.push({ id: uid(), tipo: SP.tipo, data: dt.value, importo: r2(v), descrizione: ds.value.trim(), categoria: SP.tipo === 'Prelievo' ? 'Prelievo contanti' : catSel.value, metodo: SP.tipo === 'Prelievo' ? 'Contanti' : met.value, veicolo: veiFld && !veiFld.hidden ? vei.value : '', updated: NOW() });
        save(); if (spPer(dt.value) !== SP.per) SP.per = spPer(dt.value); route(); toast('Aggiunto'); }, 'pri')));
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
  const MAP = { f: 'tutte', geoBusy: false };
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
      listEl.replaceChildren(...pts.sort((x, y) => (x.comune || '').localeCompare(y.comune || '', 'it') || x.ragione.localeCompare(y.ragione, 'it')).map((a) => h('div', { class: 'row', tabindex: '0', onclick: () => { if (map) { map.setView([a.lat, a.lng], 14); window.scrollTo(0, 0); } } }, h('span', { class: 't' }, a.ragione, h('div', { class: 'note' }, [a.ubicazione, a.comune].filter(Boolean).join(', '))), prog.has(a.id) ? h('span', { class: 'tag' }, '📅 ' + L.fmtDate(prog.get(a.id))) : null, h('a', { href: gmaps(a, true), target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, '➜'))));
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
      h('div', { class: 'note' }, '🟢 ispezione programmata · 🔵 altre aziende. Tocca un pin per scheda, Google Maps e indicazioni.'), mapEl, h('h3', {}, 'Elenco'), listEl);
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

  function viewAzienda(id) {
    const a = byId('aziende', id);
    if (!a) return h('div', { class: 'empty' }, 'Azienda non trovata.');
    const T = L.today();
    const isp = rows('ispezioni').filter((i) => i.azienda === id);
    const appunti = rows('promemoria').filter((p) => p.azienda === id);
    const att = rows('attivita').filter((x) => x.azienda === id);
    const next = isp.filter((i) => i.data && i.data >= T && i.stato !== 'Svolta').sort((x, y) => x.data.localeCompare(y.data))[0];
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
    const nx = open[0] ? { ico: '🔔', t: open[0].titolo, d: open[0].data, go: () => openForm('promemoria', open[0]) } : next ? { ico: '📋', t: 'Ispezione' + (next.destinazione ? ' – ' + next.destinazione : ''), d: next.data, go: () => openForm('ispezioni', next) } : null;
    const banner = nx ? h('div', { class: 'az-next', tabindex: '0', onclick: nx.go }, h('span', { class: 'az-i' }, nx.ico), h('div', {}, h('small', {}, 'Prossima azione'), h('b', {}, nx.t)), h('span', { class: 'az-when' + (nx.d && nx.d < T ? ' late' : '') }, nx.d ? L.fmtDate(nx.d) : 'senza data')) : null;
    // timeline unificata
    const ICO = { Contattata: '✅', 'Ispezione fissata': '📅', Chiamata: '📞', Email: '✉️', Messaggio: '💬', Visita: '🚗', Nota: '📝' };
    const items = [];
    for (const x of att) items.push({ k: 'c', d: x.data, ico: ICO[x.tipo] || '📝', t: x.tipo, x: x.testo, go: () => openForm('attivita', x) });
    for (const i of isp) items.push({ k: 'i', d: i.data, ico: '📋', t: 'Ispezione' + ([i.partenza, i.destinazione].filter(Boolean).length ? ' · ' + [i.partenza, i.destinazione].filter(Boolean).join(' → ') : ''), x: 'Carico ' + (i.dataCarico ? L.fmtDate(i.dataCarico) : '—') + (i.periodo ? ' · ' + lab('periodi', i.periodo) : ''), st: i.stato, go: () => openForm('ispezioni', i) });
    for (const p of appunti) items.push({ k: 'a', d: p.data, ico: p.stato === 'Fatto' ? '✅' : '🔔', t: p.titolo, x: (p.note || '').split('\n').slice(1).join(' · '), st: p.stato === 'Fatto' ? 'Fatto' : 'Aperto', go: () => openForm('promemoria', p) });
    items.sort((x, y) => (y.d || '9999').localeCompare(x.d || '9999'));
    const flt = ui.azf || '';
    const FL = [['', 'Tutto'], ['c', 'Contatti'], ['i', 'Ispezioni'], ['a', 'Appunti']];
    const shown = items.filter((x) => !flt || x.k === flt);
    const tl = shown.length ? h('div', { class: 'tl' }, shown.map((x) => h('div', { class: 'tl-i' + (x.d && x.d > T ? ' fut' : ''), tabindex: '0', onclick: x.go },
      h('span', { class: 'tl-dot' }, x.ico), h('div', { class: 'tl-b' }, h('div', { class: 'tl-t' }, h('b', {}, x.t), x.st && tag(x.st, CL[x.st] || (x.st === 'Aperto' ? 'warn' : ''))), h('small', {}, (x.d ? L.fmtDate(x.d) : 'senza data') + (x.x ? ' · ' : ''), x.x || ''))))) : h('p', { class: 'note' }, 'Nessuna attività registrata.');
    // nota spese per ispezione
    const ispAll = isp.slice().sort((x, y) => (y.data || '').localeCompare(x.data || ''));
    const eurTxt = (n) => L.eur(n);
    const notaBox = h('div', {});
    const drawNota = () => {
      const cs = [];
      const cards = ispAll.map((x) => {
        const out = { rimb: h('b', {}), somma: h('b', {}), tot: h('b', { class: 'tot' }) };
        const upd = () => { const c = ispCalc(x); out.rimb.textContent = eurTxt(c.rimb); out.somma.textContent = eurTxt(c.somma); out.tot.textContent = eurTxt(c.tot); imp.value = c.imp; totAll(); };
        const touch = () => { if (!x.periodo) { const pid = periodoPerData(x.data); if (pid) { x.periodo = pid; per.value = pid; } } x.updated = NOW(); save(); upd(); };
        const num = (k, l, step) => h('label', { class: 'nf' }, h('small', {}, l), h('input', { type: 'number', inputmode: 'decimal', step, min: '0', value: x[k] == null || x[k] === '' ? '' : x[k], onchange: (e) => { const v = e.target.value.replace(',', '.'); x[k] = v === '' ? '' : Number(v); touch(); } }));
        const txt = (k, l, ph) => h('label', { class: 'nf w2' }, h('small', {}, l), h('input', { type: 'text', value: x[k] || '', placeholder: ph || '', onchange: (e) => { x[k] = e.target.value.trim(); touch(); } }));
        const per = h('select', { onchange: (e) => { x.periodo = e.target.value; touch(); } }, h('option', { value: '' }, '— nessuno —'), rows('periodi').slice().sort((p, q) => (q.avvio || '').localeCompare(p.avvio || '')).map((p) => h('option', { value: p.id }, lab('periodi', p.id)))); per.value = x.periodo || '';
        const comp = h('select', { onchange: (e) => { x.complessita = e.target.value; if (L.TARIFFE[x.complessita] != null) x.compenso = L.TARIFFE[x.complessita]; touch(); } }, h('option', { value: '' }, '—'), Object.keys(L.TARIFFE).map((k) => h('option', { value: k }, k + ' (' + L.TARIFFE[k] + ' €)'))); comp.value = x.complessita || '';
        const imp = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: importoOf(x), onchange: (e) => { const v = e.target.value.replace(',', '.'); if (v === '') delete x.compenso; else x.compenso = Number(v); touch(); } });
        const c0 = ispCalc(x); out.rimb.textContent = eurTxt(c0.rimb); out.somma.textContent = eurTxt(c0.somma); out.tot.textContent = eurTxt(c0.tot); cs.push(x);
        return h('div', { class: 'ns' }, h('div', { class: 'ns-h' }, h('b', {}, x.data ? L.fmtDate(x.data) : 'senza data'), tag(x.stato, CL[x.stato]), x.periodo && h('a', { href: '#/ispezioni/periodo/' + x.periodo, class: 'note' }, '→ vai al periodo'), h('a', { href: '#', class: 'note', onclick: (e) => { e.preventDefault(); openForm('ispezioni', x); } }, 'modifica scheda')),
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
    return h('div', { class: 'az' }, h('p', {}, h('a', { href: '#/ispezioni/aziende' }, '← Aziende')),
      h('div', { class: 'az-top' }, h('div', {}, h('h2', {}, '🏢 ' + a.ragione), h('div', { class: 'vtags' }, tag(stage[0], stage[1]), a.codice && h('span', { class: 'pill' }, a.codice), a.comune && h('span', { class: 'pill' }, a.comune), lastContact && h('span', { class: 'pill' }, 'ultimo contatto ' + L.fmtDate(lastContact.data)))),
        h('div', { class: 'bar' }, btn('✏️ Modifica', () => openForm('aziende', a), ''))),
      h('div', { class: 'bar az-act' }, tel && h('a', { class: 'btnlink pri', href: 'tel:' + tel }, '📞 Chiama'), a.email && h('a', { class: 'btnlink', href: gmailCompose(a.email), target: '_blank', rel: 'noopener' }, '✉️ Scrivi (Gmail)'), h('a', { class: 'btnlink', href: gmailSearch(a.email ? 'from:' + a.email + ' OR to:' + a.email : '"' + a.ragione + '"'), target: '_blank', rel: 'noopener' }, '🔍 Mail in Gmail'),
        btn('📝 Nota', () => openForm('attivita', null, { azienda: id, tipo: 'Nota' }), '')),
      h('div', { class: 'az-quick' }, btn('✅ Contattata il…', () => openStatoRapido(a, 'contattata'), 'pri'), btn('📅 Ispezione fissata il…', () => openStatoRapido(a, 'fissata'), 'pri'), btn('🔔 Da richiamare', () => openAppuntoContatto(a), '')),
      banner,
      h('div', { class: 'az-cols' },
        h('div', { class: 'az-main' }, h('div', { class: 'az-h' }, h('h3', {}, 'Nota spese'), h('div', { class: 'bar' }, btn('+ Ispezione', () => openForm('ispezioni', null, { azienda: id, periodo: periodoPerData(L.today()) || undefined }), ''), btn('⬇️ Scarica Excel', () => scaricaNota(notaRowsAz()), 'pri'))), notaBox, h('div', { class: 'az-h' }, h('h3', {}, 'Attività', h('span', { class: 'az-n' }, items.length))),
          h('div', { class: 'chips' }, FL.map(([k, l]) => h('a', { class: 'chip' + (flt === k ? ' on' : ''), href: '#', onclick: (e) => { e.preventDefault(); ui.azf = k; route(); } }, l))), tl),
        h('aside', { class: 'az-aside' },
          card('Contatti', contacts.length ? h('div', { class: 'az-card' }, contacts) : h('p', { class: 'note' }, 'Aggiungi email e telefoni da “Modifica”.')),
          card('Dati azienda', dati.length ? h('div', { class: 'az-card' }, dati) : h('p', { class: 'note' }, '—')),
          a.note && card('Note', h('p', { class: 'az-note' }, a.note)),
          )));
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
          btn('Aggiorna ora', () => publishFeed(true), '')),
        h('p', { class: 'note' }, db.meta.feedAt ? 'Ultimo aggiornamento: ' + new Date(db.meta.feedAt).toLocaleString('it-IT') + '.' : 'Non ancora pubblicato: se resta così esegui lo script calendario.sql su Supabase (vedi README).'),
        h('p', { class: 'note' }, 'iPhone: tocca "Abbonati". Mac: Calendario → File → Nuovo abbonamento a calendario → incolla il link. Chi ha il link può leggere le scadenze: non condividerlo. L\'app aggiorna il file a ogni sincronizzazione; Calendario lo rilegge ogni tanto (circa ogni ora).'));
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
  function route() {
    const [, id = 'oggi', ek, arg] = (location.hash || '#/oggi').split('/');
    const mod = MODS.find((m) => m.id === id) || MODS[0];
    if (lastMod !== mod.id + '/' + (ek || '')) { ui.q = ''; lastMod = mod.id + '/' + (ek || ''); }
    renderNav(mod.id);
    const app = document.getElementById('app');
    app.replaceChildren(mod.id === 'oggi' ? viewOggi() : mod.id === 'impostazioni' ? viewImpostazioni()
      : mod.id === 'scuola' && ek === 'classe' ? viewClasse(arg) : mod.id === 'scuola' && ek === 'correggi' ? viewCorreggi(arg) : mod.id === 'scuola' && ek === 'verbale' ? viewVerbale(arg) : mod.id === 'spese' && !ek ? viewSpese() : mod.id === 'ispezioni' && ek === 'mappa' ? viewMappa()
      : mod.id === 'ispezioni' && ek === 'periodo' ? viewPeriodo(arg) : mod.id === 'ispezioni' && ek === 'azienda' ? viewAzienda(arg) : viewModule(mod, ek));
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
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });
  route();
  startSync();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__gestionale = { publishFeed, feedICS, feedUrl, route, syncNow, login, getSession, get db() { return db; }, seedDemo, ENT };
})();
