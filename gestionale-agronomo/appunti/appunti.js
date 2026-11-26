// Spunta degli argomenti da usare per la verifica. Salvata nel browser (stessa origine del gestionale),
// la lista in Scuola → Appunti mostra gli argomenti scelti.
(function () {
  var K = 'gestionale-verifica-appunti', page = location.pathname.split('/').pop().replace(/\.html$/, '');
  function load() { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(K, JSON.stringify(o)); } catch (e) {} }
  var st = load(), cur = st[page] || [];
  var bar = document.createElement('div'); bar.className = 'vf-sum';
  var nav = document.querySelector('nav.toc'); if (nav) nav.after(bar);
  function sum() { bar.textContent = cur.length ? '🎯 Per la verifica: ' + cur.length + (cur.length === 1 ? ' argomento scelto' : ' argomenti scelti') : '🎯 Spunta «Usa per la verifica» sugli argomenti da inserire nella verifica.'; }
  document.querySelectorAll('main h2[id]').forEach(function (h) {
    if (h.id === 'errori') return;
    var l = document.createElement('label'); l.className = 'vf';
    var c = document.createElement('input'); c.type = 'checkbox'; c.checked = cur.indexOf(h.id) >= 0;
    function paint() { h.classList.toggle('vf-on', c.checked); }
    c.onchange = function () {
      var s = load(), a = (s[page] || []).filter(function (x) { return x !== h.id; });
      if (c.checked) a.push(h.id);
      if (a.length) s[page] = a; else delete s[page];
      save(s); cur = a; paint(); sum();
    };
    l.appendChild(c); l.appendChild(document.createTextNode(' 🎯 Usa per la verifica'));
    h.after(l); paint();
  });
  sum();
})();
