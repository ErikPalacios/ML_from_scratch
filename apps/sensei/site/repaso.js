/* El repaso de Sensei (/repaso/): las tarjetas del glosario con repetición espaciada, en el sistema de Leitner.
   Cada tarjeta vive en una de cinco cajas y vuelve a los 0, 1, 3, 7 o 16 días según su caja:
     «No me acordé» (1) → caja 1, y vuelve antes de terminar la sesión;
     «Me costó» (2)     → se queda en su caja (una nueva entra a la 1) y vuelve como pronto mañana;
     «Fácil» (3)        → sube una caja (una nueva pasa a la 2).
   Una sesión toma primero las que tocan hoy (la más atrasada primero) y después nuevas en el orden del curso, de 20 en 20.
   Los datos vienen de /repaso/tarjetas.json (los arma tools/build.mjs, con el texto ya en HTML). El avance se guarda en
   localStorage['sensei-repaso'] = { v: 1, c: { <id>: [caja, día en que vuelve] } } y lo que elegiste repasar en
   localStorage['sensei-repaso-sel']. Si el navegador no deja guardar, el repaso funciona igual, sin recordar.
   El día se cuenta en días locales desde 1970, para que «mañana» sea mañana donde estás. */
(function () {
  'use strict';
  var app = document.querySelector('[data-rp]');
  if (!app) return;
  var $ = function (q, el) { return (el || document).querySelector(q); };
  var $$ = function (q, el) { return [].slice.call((el || document).querySelectorAll(q)); };
  var KAV = 'sensei-repaso', KSEL = 'sensei-repaso-sel', KLEIDAS = 'sensei-leidas';
  var INTERVALO = [0, 1, 3, 7, 16];   // días hasta que vuelve, para las cajas 1 a 5
  var POR_SESION = 20;
  var leerJSON = function (k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  var guardarJSON = function (k, o) { try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) {} };
  var diaDe = function (d) { return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 864e5); };
  var hoy = function () { return diaDe(new Date()); };
  var vuelve = function (dias) { return dias <= 0 ? 'Vuelve hoy' : dias === 1 ? 'Vuelve mañana' : 'Vuelve en ' + dias + ' días'; };
  var num = function (n) { return n.toLocaleString('en-US'); };   // 1,025, como en el resto del curso
  var plural = function (n, uno, varios) { return num(n) + ' ' + (n === 1 ? uno : varios); };

  $('[data-rp-sinjs]').hidden = true;
  app.hidden = false;

  // ------------------------------------------------------------ avance y elección (en memoria; se guardan si se puede)
  var AV = leerJSON(KAV);
  if (!AV || typeof AV !== 'object' || !AV.c || typeof AV.c !== 'object') AV = { v: 1, c: {} };
  var guardarAvance = function () { guardarJSON(KAV, AV); if (window.SenseiRepaso) window.SenseiRepaso.pintar(); };
  var estado = function (id) { var s = AV.c[id]; return Array.isArray(s) ? { caja: s[0], dia: s[1] } : null; };

  var D = null, POR_ID = {}, SEL = null;
  var cuenta = $('[data-rp-cuenta]'), empezar = $('[data-rp-empezar]');
  var elegir = $('[data-rp-elegir]'), sesion = $('[data-rp-sesion]'), fin = $('[data-rp-fin]');
  empezar.disabled = true;
  cuenta.textContent = 'Cargando las tarjetas…';

  function leidas() { var a = leerJSON(KLEIDAS); return Array.isArray(a) ? a : []; }

  // las tarjetas elegidas: por lección y, si se pidió, solo de lecciones leídas
  function elegidas() {
    var ls = {}, le = SEL.leidas ? leidas() : null;
    SEL.l.forEach(function (id) { if (!le || le.indexOf(id) >= 0) ls[id] = true; });
    return D.tarjetas.filter(function (t) { return ls[t.l]; });
  }
  var cuesta = function (t) { var s = estado(t.i); return s && s.caja <= 2; };

  // la cola de una sesión: primero las que tocan hoy, luego nuevas; con «me cuestan», solo las de las cajas 1 y 2
  function armarCola() {
    var h = hoy(), ts = elegidas();
    var vencidas = function (lista) {
      return lista.filter(function (t) { var s = estado(t.i); return s && s.dia <= h; })
        .sort(function (a, b) { var A = estado(a.i), B = estado(b.i); return A.dia - B.dia || A.caja - B.caja; });
    };
    var cola;
    if (SEL.cuestan) {
      var dif = ts.filter(cuesta);
      var hoyDif = vencidas(dif);
      cola = hoyDif.concat(dif.filter(function (t) { return hoyDif.indexOf(t) < 0; }).sort(function (a, b) { return estado(a.i).dia - estado(b.i).dia; }));
    } else {
      cola = vencidas(ts).concat(ts.filter(function (t) { return !estado(t.i); }));
    }
    return cola.slice(0, POR_SESION).map(function (t) { return t.i; });
  }

  // ------------------------------------------------------------ elegir qué repasar
  function pintarElegir() {
    var h = hoy(), sel = {};
    SEL.l.forEach(function (id) { sel[id] = true; });
    $$('[data-filtro]').forEach(function (c) { c.checked = !!SEL[c.getAttribute('data-filtro')]; });
    $$('[data-sel-lec]').forEach(function (c) { c.checked = !!sel[c.getAttribute('data-sel-lec')]; });
    D.modulos.forEach(function (m) {
      var mc = $('[data-sel-mod="' + m[0] + '"]'), n = m[3].filter(function (l) { return sel[l]; }).length;
      if (mc) { mc.checked = n === m[3].length; mc.indeterminate = n > 0 && n < m[3].length; }
    });
    // avance por módulo y lo que toca hoy en cada lección
    var av = {}, lec = {};
    D.tarjetas.forEach(function (t) {
      var m = D.lecciones[t.l][2], s = estado(t.i);
      av[m] = av[m] || { n: 0, vistas: 0, firmes: 0 };
      av[m].n++;
      lec[t.l] = lec[t.l] || { n: 0, hoy: 0 };
      lec[t.l].n++;
      if (s) { av[m].vistas++; if (s.caja >= 4) av[m].firmes++; if (s.dia <= h) lec[t.l].hoy++; }
    });
    D.modulos.forEach(function (m) {
      var a = av[m[0]] || { n: 0, vistas: 0, firmes: 0 }, txt = $('[data-av-txt="' + m[0] + '"]');
      if (txt) txt.textContent = a.vistas ? plural(a.vistas, 'visto', 'vistos') + ' · ' + plural(a.firmes, 'firme', 'firmes') : 'ninguno repasado';
      var f = $('[data-av-firme="' + m[0] + '"]'), v = $('[data-av-visto="' + m[0] + '"]');
      if (f) f.style.width = (a.n ? a.firmes / a.n * 100 : 0).toFixed(1) + '%';
      if (v) v.style.width = (a.n ? (a.vistas - a.firmes) / a.n * 100 : 0).toFixed(1) + '%';
    });
    $$('[data-lec-c]').forEach(function (el) { var x = lec[el.getAttribute('data-lec-c')]; if (x) el.textContent = x.n + (x.hoy ? ' · ' + x.hoy + ' hoy' : ''); });

    // la cuenta de lo elegido
    var ts = elegidas(), cola = armarCola();
    var tocan = ts.filter(function (t) { var s = estado(t.i); return s && s.dia <= h; }).length;
    var nuevas = ts.filter(function (t) { return !estado(t.i); }).length;
    var msg, nCuestan = ts.filter(cuesta).length;
    if (!SEL.l.length) msg = 'Elige al menos un módulo o una lección.';
    else if (!ts.length) msg = SEL.leidas
      ? (leidas().length ? 'Ninguna de las lecciones elegidas está marcada como leída.' : 'Todavía no marcas ninguna lección como leída. El botón «Marcar como leída» está al final de cada lección.')
      : 'Las lecciones elegidas todavía no tienen tarjetas.';
    else if (SEL.cuestan) msg = cola.length
      ? 'Elegiste ' + plural(ts.length, 'tarjeta', 'tarjetas') + ' y ' + num(nCuestan) + (nCuestan === 1 ? ' todavía no se te queda' : ' todavía no se te quedan') + '. Esta sesión trae ' + plural(cola.length, 'tarjeta', 'tarjetas') + '.'
      : 'Ninguna de las tarjetas elegidas sigue en las dos primeras cajas: todas las que ya viste subieron a la caja 3 o más arriba.';
    else if (cola.length) {
      var partes = [];
      if (tocan) partes.push(num(tocan) + (tocan === 1 ? ' te toca hoy' : ' te tocan hoy'));
      if (nuevas) partes.push(num(nuevas) + (nuevas === 1 ? ' es nueva' : ' son nuevas'));
      msg = (nuevas === ts.length
        ? (ts.length === 1 ? 'Elegiste 1 tarjeta, nueva.' : 'Elegiste ' + num(ts.length) + ' tarjetas, todas nuevas.')
        : 'Elegiste ' + plural(ts.length, 'tarjeta', 'tarjetas') + ': ' + partes.join(' y ') + '.') +
        ' Esta sesión trae ' + plural(cola.length, 'tarjeta', 'tarjetas') + (tocan && nuevas && cola.length > tocan ? ', primero las de hoy.' : '.');
    } else {
      var prox = ts.map(function (t) { return estado(t.i).dia; }).sort(function (a, b) { return a - b; })[0];
      msg = (ts.length === 1 ? 'Ya viste la tarjeta elegida y hoy no te toca.' : 'Ya viste las ' + num(ts.length) + ' tarjetas elegidas y hoy no te toca ninguna.') + ' La siguiente ' + vuelve(prox - h).toLowerCase() + '.';
    }
    cuenta.textContent = msg;
    empezar.disabled = !cola.length;
  }

  function guardarSel() { guardarJSON(KSEL, SEL); }

  elegir.addEventListener('change', function (ev) {
    var c = ev.target;
    if (c.hasAttribute('data-filtro')) SEL[c.getAttribute('data-filtro')] = c.checked;
    else if (c.hasAttribute('data-sel-mod') || c.hasAttribute('data-sel-lec')) {
      var ids = c.hasAttribute('data-sel-mod') ? D.modulos.filter(function (m) { return m[0] === c.getAttribute('data-sel-mod'); })[0][3] : [c.getAttribute('data-sel-lec')];
      ids.forEach(function (id) { var i = SEL.l.indexOf(id); if (c.checked && i < 0) SEL.l.push(id); if (!c.checked && i >= 0) SEL.l.splice(i, 1); });
    } else return;
    guardarSel();
    pintarElegir();
  });
  elegir.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-sel]');
    if (!b || !D) return;
    SEL.l = b.getAttribute('data-sel') === 'todo' ? Object.keys(D.lecciones) : [];
    guardarSel();
    pintarElegir();
  });

  // ------------------------------------------------------------ la sesión
  var S = null;
  var card = $('[data-rp-card]'), dorso = $('[data-rp-dorso]'), voltearBtn = $('[data-rp-voltear]'), notas = $('[data-rp-notas]');
  var mas = $('[data-rp-mas]'), pregunta = $('[data-rp-pregunta]');

  function iniciar() {
    var cola = armarCola();
    if (!cola.length) return;
    S = { cola: cola, total: cola.length, mostradas: 0, unicas: [], primera: {}, volteada: false, repite: {} };
    elegir.hidden = true; fin.hidden = true; sesion.hidden = false;
    mostrar();
    card.focus();
  }

  function mostrar() {
    var t = POR_ID[S.cola[0]], s = estado(t.i), L = D.lecciones[t.l];
    S.volteada = false;
    $('[data-rp-pos]').textContent = 'Tarjeta ' + (S.mostradas + 1) + ' de ' + S.total;
    $('[data-rp-barra]').style.width = (S.mostradas / S.total * 100).toFixed(1) + '%';
    $('[data-rp-caja]').textContent = S.repite[t.i] ? 'Otra vez' : s ? 'Caja ' + s.caja : 'Nueva';
    $('[data-rp-t]').textContent = t.t;
    var en = $('[data-rp-en]'); en.textContent = t.en || ''; en.hidden = !t.en;
    $('[data-rp-de]').textContent = 'De la lección ' + L[0] + ' · ' + L[1];
    dorso.hidden = true;
    voltearBtn.hidden = false;
    notas.hidden = true;
    pregunta.hidden = true;
  }

  function voltear() {
    if (!S || S.volteada) return;
    var t = POR_ID[S.cola[0]], s = estado(t.i), caja = s ? s.caja : 0;
    S.volteada = true;
    $('[data-rp-corto]').innerHTML = t.c;   // HTML que armó el build a partir del glosario
    var extra = (t.lg ? '<p>' + t.lg + '</p>' : '') + (t.an ? '<p><b>Analogía. </b>' + t.an + '</p>' : '') + (t.ej ? '<p><b>Ejemplo. </b>' + t.ej + '</p>' : '');
    $('[data-rp-mas-in]').innerHTML = extra;
    mas.hidden = !extra;
    mas.open = false;
    var L = D.lecciones[t.l];
    $('[data-rp-ir]').innerHTML = '<a href="/' + t.l + '/#k-' + t.i + '">Leerlo en «' + L[1].replace(/&/g, '&amp;').replace(/</g, '&lt;') + '» →</a><a href="/glosario/#g-' + t.i + '">Verlo en el glosario →</a>';
    // cada botón dice cuándo vuelve la tarjeta y a qué caja va (así «Me costó» y «Fácil» no se ven iguales)
    var c2 = Math.max(1, caja), c3 = Math.min(5, Math.max(1, caja) + 1);
    var aCaja = function (n) { return (!caja ? 'Entra' : n === caja ? 'Se queda' : n > caja ? 'Sube' : 'Regresa') + (n === caja ? ' en la caja ' : ' a la caja ') + n; };
    $('[data-rp-cuando="1"]').innerHTML = 'Vuelve en esta sesión<br>' + aCaja(1);
    $('[data-rp-cuando="2"]').innerHTML = vuelve(Math.max(1, INTERVALO[c2 - 1])) + '<br>' + aCaja(c2);
    $('[data-rp-cuando="3"]').innerHTML = vuelve(INTERVALO[c3 - 1]) + '<br>' + aCaja(c3);
    dorso.hidden = false;
    voltearBtn.hidden = true;
    notas.hidden = false;
    pregunta.hidden = false;
    card.focus();
  }

  function calificar(nota) {
    if (!S || !S.volteada) return;
    var id = S.cola.shift(), s = estado(id), caja = s ? s.caja : 0, h = hoy(), nueva, dia;
    if (nota === 1) { nueva = 1; dia = h; }
    else if (nota === 2) { nueva = Math.max(1, caja); dia = h + Math.max(1, INTERVALO[nueva - 1]); }
    else { nueva = Math.min(5, Math.max(1, caja) + 1); dia = h + INTERVALO[nueva - 1]; }
    AV.c[id] = [nueva, dia];
    guardarAvance();
    if (!(id in S.primera)) { S.primera[id] = nota; S.unicas.push(id); }
    S.mostradas++;
    if (nota === 1) { S.cola.push(id); S.repite[id] = true; S.total++; }
    if (S.cola.length) { mostrar(); card.focus(); } else terminar();
  }

  function terminar() {
    if (!S || !S.unicas.length) { volver(); return; }
    var h = hoy(), n = S.unicas.length, sabia = 0, manana = 0, despues = 0, mods = {};
    S.unicas.forEach(function (id) {
      if (S.primera[id] === 3) sabia++;
      var s = estado(id);
      if (s.dia === h + 1) manana++; else if (s.dia > h + 1) despues++;
      mods[D.lecciones[POR_ID[id].l][2]] = true;
    });
    var li = function (b, txt) { return '<li><b>' + b + '</b><span>' + txt + '</span></li>'; };
    var html = li(n, n === 1 ? 'tarjeta repasada' : 'tarjetas repasadas') +
      li(sabia, sabia === 1 ? 'te salió fácil a la primera' : 'te salieron fáciles a la primera') +
      li(manana, manana === 1 ? 'vuelve mañana' : 'vuelven mañana') +
      li(despues, despues === 1 ? 'vuelve en 3 días o más' : 'vuelven en 3 días o más');
    var av = D.modulos.filter(function (m) { return mods[m[0]]; }).map(function (m) {
      var ts = D.tarjetas.filter(function (t) { return D.lecciones[t.l][2] === m[0]; });
      var vistas = ts.filter(function (t) { return estado(t.i); }).length, firmes = ts.filter(function (t) { var s = estado(t.i); return s && s.caja >= 4; }).length;
      return '<li class="rp-res__mod"><span>' + m[1] + ' · ' + m[2].replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span><span>' + num(vistas) + ' de ' + num(ts.length) + ' vistas · ' + plural(firmes, 'firme', 'firmes') + '</span></li>';
    }).join('');
    $('[data-rp-res]').innerHTML = html + (av ? '<li class="rp-res__h">Tu avance por módulo</li>' + av : '');
    S = null;
    sesion.hidden = true; elegir.hidden = true; fin.hidden = false;
    var otra = armarCola().length;
    $('[data-rp-otra]').hidden = !otra;
    $('[data-rp-otra]').textContent = 'Otra sesión de ' + plural(otra, 'tarjeta', 'tarjetas');
    $('#h-fin').focus();
  }

  function volver() {
    S = null;
    sesion.hidden = true; fin.hidden = true; elegir.hidden = false;
    pintarElegir();
    empezar.focus();
  }

  empezar.addEventListener('click', iniciar);
  voltearBtn.addEventListener('click', voltear);
  notas.addEventListener('click', function (ev) { var b = ev.target.closest && ev.target.closest('[data-nota]'); if (b) calificar(+b.getAttribute('data-nota')); });
  $('[data-rp-terminar]').addEventListener('click', terminar);
  $('[data-rp-otra]').addEventListener('click', iniciar);
  $('[data-rp-volver]').addEventListener('click', volver);
  $('[data-rp-borrar]').addEventListener('click', function () {
    var n = Object.keys(AV.c).length;
    if (!n) { window.alert('Todavía no hay avance del repaso que borrar.'); return; }
    if (!window.confirm('¿Borrar tu avance del repaso? ' + (n === 1 ? 'La tarjeta que ya viste vuelve a ser nueva.' : 'Las ' + num(n) + ' tarjetas que ya viste vuelven a ser nuevas.') + ' Tus lecciones leídas no cambian. No se puede deshacer.')) return;
    AV = { v: 1, c: {} };
    guardarAvance();
    if (D) volver();
  });

  // Espacio voltea; 1, 2 y 3 califican (no mientras escribes ni con teclas modificadoras)
  document.addEventListener('keydown', function (ev) {
    if (!S || sesion.hidden || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var t = ev.target || {}, tag = t.tagName || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || t.isContentEditable) return;
    var pop = $('.g-pop');
    if (pop && !pop.hidden) return;
    if (ev.key === ' ' || ev.key === 'Spacebar') {
      if (!S.volteada) { ev.preventDefault(); voltear(); }
      else if (!/BUTTON|A|SUMMARY/.test(tag)) ev.preventDefault();
    } else if (S.volteada && (ev.key === '1' || ev.key === '2' || ev.key === '3')) { ev.preventDefault(); calificar(+ev.key); }
  });

  // ------------------------------------------------------------ cargar las tarjetas
  fetch('/repaso/tarjetas.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    D = d;
    var globos = {};
    d.tarjetas.forEach(function (t) {
      POR_ID[t.i] = t;
      var L = d.lecciones[t.l];
      globos[t.i] = { t: t.t, en: t.en || '', c: t.c, p: ['/' + t.l + '/', L[1]], f: t.f || null };
    });
    if (window.SenseiGlobo) window.SenseiGlobo.agregar(globos);
    // lo elegido: lo guardado o todo; ?l=<lección> (desde el cierre de una lección) elige solo esa
    var todas = Object.keys(d.lecciones), guardada = leerJSON(KSEL);
    SEL = { l: todas.slice(), leidas: false, cuestan: false };
    if (guardada && Array.isArray(guardada.l)) SEL = { l: guardada.l.filter(function (id) { return d.lecciones[id]; }), leidas: !!guardada.leidas, cuestan: !!guardada.cuestan };
    var pedida = new URLSearchParams(location.search).get('l');
    if (pedida && d.lecciones[pedida]) {
      SEL = { l: [pedida], leidas: false, cuestan: false };
      guardarSel();
      var det = $('[data-mod="' + d.lecciones[pedida][2] + '"] details');
      if (det) det.open = true;
    }
    pintarElegir();
  }).catch(function () {
    cuenta.textContent = 'No se pudieron cargar las tarjetas. Revisa tu conexión y vuelve a abrir la página: después de la primera visita, el repaso abre sin conexión.';
  });
})();
