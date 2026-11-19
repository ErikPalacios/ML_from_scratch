/* TrueML · piezas de interfaz compartidas (sin dependencias). Fuente única: apps/trueml; sync.mjs la copia a cada app.
   Tres piezas, cada una se activa con atributos en la etiqueta raíz (o llamando a su función desde la app):
     1. Volver      data-tm-herramienta="Sensei" data-tm-inicio="/"   → botón «Volver a TrueML» (+ «‹ Sensei» si no estás en su portada)
                    data-tm-portada="https://…" (por defecto la portada de TrueML) · data-tm-sin-volver (no mostrarlo)
     2. Avance      data-tm-avance="section.sec"                       → «Marcar como leída» al final de cada sección y un tanque que se llena
                    data-tm-clave="sensei" (prefijo del almacenamiento) · data-tm-avance-pagina="id" (por defecto la ruta)
                    data-tm-tanque-en="selector" (después de qué elemento va el tanque; por defecto, después del título)
     3. Notas       data-tm-notas="main"                               → selecciona texto → color → nota; queda subrayado y guardado
   API para apps que pintan por JavaScript (la Ronda):
     TrueMLAvance.init({secciones, clave, pagina, tanque}) · TrueMLAvance.resumen() · evento «tm-avance» en document
     TrueMLNotas.init({raiz, clave, pagina:()=>id, url:()=>ruta, adaptador:{listar,poner,quitar}, boton:false}) · TrueMLNotas.aplicar()
   Todo se guarda en este navegador (localStorage); si no se puede, la página sigue funcionando sin guardar. */
(function () {
  'use strict';
  var root = document.documentElement;
  var tiene = function (n) { return root.hasAttribute('data-tm-' + n); };
  var attr = function (n, d) { var v = root.getAttribute('data-tm-' + n); return v == null ? d : v; };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var leer = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var guardar = function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  var json = function (k, d) { try { var v = JSON.parse(leer(k)); return v == null ? d : v; } catch (e) { return d; } };
  function h(tag, props, hijos) {
    var e = document.createElement(tag);
    for (var k in (props || {})) {
      if (k === 'class') e.className = props[k]; else if (k === 'html') e.innerHTML = props[k];
      else if (k === 'text') e.textContent = props[k]; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), props[k]);
      else if (props[k] != null) e.setAttribute(k, props[k]);
    }
    [].concat(hijos || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  var SVG = function (d, w) { return '<svg viewBox="0 0 16 16" width="' + (w || 16) + '" height="' + (w || 16) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var PORTADA = 'https://trueml.app/';

  // ================================================================ 1 · volver a TrueML
  function volver() {
    if (tiene('sin-volver') || $('.tm-dock')) return;
    var portada = attr('portada', PORTADA), herramienta = attr('herramienta', ''), inicio = attr('inicio', '');
    var mini = '<span class="tm-mini" aria-hidden="true">' + ['contenedor', 'orquestacion', 'monitoreo', 'api', 'modelo', 'datos'].map(function (id) { return '<i class="tm-mini-' + id + '"></i>'; }).join('') + '</span>';
    var dock = h('nav', { class: 'tm-dock', 'aria-label': 'Volver' });
    dock.appendChild(h('a', { class: 'tm-volver', href: portada, 'aria-label': 'Volver a la portada de TrueML, todas las herramientas', html:
      '<span class="tm-volver__flecha">' + SVG('<path d="M10 3 5 8l5 5"/>', 16) + '</span>' +
      '<span class="tm-volver__txt"><small>Volver a</small><b>TrueML</b></span>' + mini }));
    if (herramienta && inicio) {
      var aqui = location.pathname.replace(/index\.html$/, '').replace(/\/+$/, '') || '/';
      var dest = ''; try { dest = new URL(inicio, location.href).pathname.replace(/index\.html$/, '').replace(/\/+$/, '') || '/'; } catch (e) { dest = inicio; }
      if (aqui !== dest) dock.appendChild(h('a', { class: 'tm-inicio', href: inicio, 'aria-label': 'Ir a la portada de ' + herramienta, html: SVG('<path d="M10 3 5 8l5 5"/>', 14) + '<span></span>' }));
      var s = $('.tm-inicio span', dock); if (s) s.textContent = herramienta;
    }
    document.body.appendChild(dock);
    // en el celular se esconde al bajar y vuelve al subir, para no estorbar la lectura
    var y0 = window.scrollY, tic = false;
    window.addEventListener('scroll', function () {
      if (tic) return; tic = true;
      requestAnimationFrame(function () {
        var y = window.scrollY, ang = window.matchMedia('(max-width: 640px)').matches;
        if (ang && y > 160 && y > y0 + 6) dock.classList.add('is-oculto'); else if (y < y0 - 6 || y <= 160 || !ang) dock.classList.remove('is-oculto');
        y0 = y; tic = false;
      });
    }, { passive: true });
  }

  // ================================================================ 2 · avance de lectura (tanque)
  var AV = { cfg: null, secs: [], tanques: [] };
  function avanceDatos(clave) { var d = json(clave, null); return d && d.p ? d : { v: 1, p: {} }; }
  var ICO_OK = SVG('<path d="m3.5 8.5 3 3 6-7"/>', 13);

  function tanqueHtml(grande) {
    return h('div', { class: 'tm-tanque' + (grande ? ' tm-tanque--grande' : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, [
      h('div', { class: 'tm-tanque__vaso', 'aria-hidden': 'true' }, [h('div', { class: 'tm-tanque__liquido' }), h('div', { class: 'tm-tanque__marcas' })]),
      h('span', { class: 'tm-tanque__txt' })
    ]);
  }
  function pintarTanque(t, leidas, total, etiqueta) {
    var pct = total ? Math.round(leidas / total * 100) : 0;
    var liq = $('.tm-tanque__liquido', t), vaso = $('.tm-tanque__vaso', t), marcas = $('.tm-tanque__marcas', t);
    t.setAttribute('aria-valuenow', String(pct)); t.setAttribute('aria-label', leidas + ' de ' + total + ' ' + etiqueta);
    t.classList.toggle('is-lleno', total > 0 && leidas === total);
    vaso.style.setProperty('--tm-tw', Math.max(vaso.clientWidth, 120) + 'px'); liq.style.setProperty('--tm-tw', Math.max(vaso.clientWidth, 120) + 'px');
    liq.style.width = pct + '%'; liq.style.backgroundSize = Math.max(vaso.clientWidth, 120) + 'px 100%';
    if (marcas.childNodes.length !== total) { marcas.innerHTML = ''; for (var i = 0; i < Math.min(total, 40); i++) marcas.appendChild(document.createElement('i')); }
    $('.tm-tanque__txt', t).innerHTML = '<b>' + leidas + '/' + total + '</b> ' + etiqueta + (total > 0 && leidas === total ? ' · ¡completo!' : '');
  }

  function avance(o) {
    o = o || {};
    var sel = o.secciones || attr('avance', '');
    if (!sel) return;
    var secs = $$(sel).filter(function (s) { return s.id; });
    AV.cfg = { clave: (o.clave || attr('clave', 'tm')) + '-secciones', pagina: o.pagina || attr('avance-pagina', location.pathname), sel: sel };
    AV.secs = secs; AV.tanques = [];
    if (!secs.length) return;
    var C = AV.cfg;
    function leidasAhora() { var p = avanceDatos(C.clave).p[C.pagina]; return p ? p.l.filter(function (id) { return secs.some(function (s) { return s.id === id; }); }) : []; }
    secs.forEach(function (s) {
      if ($('.tm-sec-foot', s)) return;
      var b = h('button', { type: 'button', class: 'tm-leer', 'aria-pressed': 'false', 'data-tm-sec': s.id, html: '<span class="tm-leer__ico">' + ICO_OK + '</span><span class="tm-leer__t">Marcar como leída</span>' });
      s.appendChild(h('footer', { class: 'tm-sec-foot tm-ui' }, b));
    });
    var tanque = tanqueHtml(false);
    var en = o.tanque || attr('tanque-en', '');
    var donde = (en ? $(en) : null) || (function () { var t = $('main h1, h1'); return t ? (t.closest('header') || t) : null; })();
    if (donde && !$('.tm-tanque', donde.parentNode)) donde.parentNode.insertBefore(tanque, donde.nextSibling);
    AV.tanques.push(tanque);
    $$('[data-tm-tanque]').forEach(function (p) { var t = tanqueHtml(p.hasAttribute('data-grande')); p.appendChild(t); AV.tanques.push(t); });
    function pintar() {
      var l = leidasAhora();
      secs.forEach(function (s) {
        var si = l.indexOf(s.id) >= 0, b = $('.tm-leer[data-tm-sec="' + s.id + '"]', s);
        s.classList.toggle('is-leida-tm', si);
        if (b) { b.setAttribute('aria-pressed', String(si)); $('.tm-leer__t', b).textContent = si ? 'Leída' : 'Marcar como leída'; }
      });
      AV.tanques.forEach(function (t) { pintarTanque(t, l.length, secs.length, 'secciones leídas'); });
      $$('[data-tm-avance-n]').forEach(function (e) { e.textContent = l.length + '/' + secs.length; });
      document.dispatchEvent(new CustomEvent('tm-avance', { detail: { pagina: C.pagina, leidas: l.length, total: secs.length, completa: l.length === secs.length } }));
    }
    document.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest('.tm-leer');
      if (!b || !AV.secs.length) return;
      var id = b.getAttribute('data-tm-sec'), d = avanceDatos(C.clave), p = d.p[C.pagina] || (d.p[C.pagina] = { l: [], t: secs.length, at: 0 });
      var i = p.l.indexOf(id); if (i >= 0) p.l.splice(i, 1); else p.l.push(id);
      p.t = secs.length; p.at = Date.now();
      guardar(C.clave, JSON.stringify(d));
      pintar();
    });
    window.addEventListener('storage', function (e) { if (e.key === C.clave) pintar(); });
    window.addEventListener('resize', function () { AV.tanques.forEach(function (t) { var l = leidasAhora(); pintarTanque(t, l.length, secs.length, 'secciones leídas'); }); });
    pintar();
  }
  /** { <página>: {leidas, total} } de todo lo que se ha abierto en este navegador. */
  function resumen() {
    var C = AV.cfg || { clave: attr('clave', 'tm') + '-secciones' }, out = {}, p = avanceDatos(C.clave).p;
    for (var k in p) out[k] = { leidas: p[k].l.length, total: p[k].t || 0 };
    return out;
  }

  // ================================================================ 3 · notas subrayadas
  var N = { cfg: null, notas: [], bar: null, pop: null, panel: null, btn: null, sel: null };
  var COLORES = [['1', 'Amarillo'], ['2', 'Verde'], ['3', 'Azul'], ['4', 'Naranja'], ['5', 'Violeta']];
  function adaptadorLocal(clave) {
    return {
      listar: function () { var d = json(clave, null); return d && d.n ? d.n : []; },
      poner: function (n) { var l = this.listar(), i = l.map(function (x) { return x.id; }).indexOf(n.id); if (i >= 0) l[i] = n; else l.push(n); guardar(clave, JSON.stringify({ v: 1, n: l })); },
      quitar: function (id) { guardar(clave, JSON.stringify({ v: 1, n: this.listar().filter(function (x) { return x.id !== id; }) })); }
    };
  }
  var nuevoId = function () { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
  var recorta = function (s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  // todos los nodos de texto de la raíz, con su posición en el texto completo (igual que Range.toString)
  function nodos(raiz) {
    var w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, null), out = [], pos = 0, n;
    while ((n = w.nextNode())) { out.push({ nodo: n, ini: pos, fin: pos + n.data.length }); pos += n.data.length; }
    return { lista: out, texto: out.map(function (e) { return e.nodo.data; }).join('') };
  }
  function posicion(raiz, cont, off) { var r = document.createRange(); r.selectNodeContents(raiz); try { r.setEnd(cont, off); } catch (e) { return -1; } return r.toString().length; }

  function buscar(texto, n) {
    var q = n.cita, i = texto.indexOf(q), mejor = -1, puntos = -1;
    while (i >= 0) {
      var p = 0;
      if (n.antes && texto.slice(Math.max(0, i - n.antes.length), i) === n.antes) p += 2; else if (n.antes && texto.slice(Math.max(0, i - n.antes.length), i).slice(-12) === n.antes.slice(-12)) p += 1;
      if (n.despues && texto.slice(i + q.length, i + q.length + n.despues.length) === n.despues) p += 2; else if (n.despues && texto.slice(i + q.length, i + q.length + 12) === n.despues.slice(0, 12)) p += 1;
      if (p > puntos) { puntos = p; mejor = i; }
      i = texto.indexOf(q, i + 1);
    }
    return mejor;
  }
  var SIN_MARCA = { UL: 1, OL: 1, TABLE: 1, TBODY: 1, THEAD: 1, TFOOT: 1, TR: 1, COLGROUP: 1, SELECT: 1, DL: 1 };
  function envolver(raiz, ini, fin, n) {
    var tot = nodos(raiz).lista, hechos = 0;
    tot.forEach(function (e) {
      var a = Math.max(ini, e.ini) - e.ini, b = Math.min(fin, e.fin) - e.ini;
      if (a >= b || !e.nodo.parentNode) return;
      var par = e.nodo.parentNode;
      if (SIN_MARCA[par.nodeName] || (par.closest && par.closest('svg, script, style, textarea, .tm-ui'))) return;
      if (!/\S/.test(e.nodo.data.slice(a, b))) return;
      var r = document.createRange(); r.setStart(e.nodo, a); r.setEnd(e.nodo, b);
      var m = h('mark', { class: 'tm-sub' + (n.texto ? ' is-con-nota' : ''), 'data-id': n.id, 'data-c': n.color || '1', tabindex: '0', role: 'button', 'aria-label': 'Nota subrayada' + (n.texto ? ': ' + recorta(n.texto, 60) : '') });
      try { r.surroundContents(m); hechos++; } catch (er) {}
    });
    return hechos;
  }
  function limpiar(raiz) {
    $$('mark.tm-sub', raiz).forEach(function (m) { var p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); p.normalize(); });
  }
  function aplicar() {
    var C = N.cfg; if (!C) return;
    var raiz = C.raiz(); if (!raiz) return;
    limpiar(raiz);
    var pag = C.pagina();
    N.notas = C.adaptador.listar().filter(function (n) { return n.pagina === pag; });
    N.notas.forEach(function (n) {
      var base = nodos(raiz), i = buscar(base.texto, n);
      n.huerfana = i < 0 || !envolver(raiz, i, i + n.cita.length, n);
    });
    actualizarBoton();
    var ir = null; try { ir = sessionStorage.getItem('tm-ir'); } catch (e) {}
    if (ir) { try { sessionStorage.removeItem('tm-ir'); } catch (e) {} irA(ir); }
  }
  function irA(id) {
    var m = $('mark.tm-sub[data-id="' + id + '"]'); if (!m) return;
    m.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $$('mark.tm-sub[data-id="' + id + '"]').forEach(function (x) { x.classList.add('is-activa'); setTimeout(function () { x.classList.remove('is-activa'); }, 1300); });
  }

  function ocultarBar() { if (N.bar) { N.bar.remove(); N.bar = null; } }
  function cerrarPop() { if (N.pop) { N.pop.remove(); N.pop = null; } }
  function colocarEn(el, rect, abajo) {
    var ancho = el.offsetWidth, alto = el.offsetHeight, sx = window.scrollX, sy = window.scrollY, vw = document.documentElement.clientWidth;
    var x = Math.min(Math.max(8, rect.left + rect.width / 2 - ancho / 2), vw - ancho - 8) + sx;
    var y = abajo ? rect.bottom + 10 : rect.top - alto - 10;
    if (!abajo && rect.top - alto - 10 < 8) y = rect.bottom + 10;
    el.style.left = x + 'px'; el.style.top = (y + sy) + 'px';
  }

  function seleccionActual() {
    var C = N.cfg, s = window.getSelection(); if (!C || !s || s.isCollapsed || !s.rangeCount) return null;
    var raiz = C.raiz(), r = s.getRangeAt(0); if (!raiz || !raiz.contains(r.commonAncestorContainer)) return null;
    var ancla = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode;
    if (ancla.closest && ancla.closest('.tm-ui, .tm-pop, .tm-bar, .tm-notas, input, textarea, button, svg, [data-tm-nonota]')) return null;
    var ini = posicion(raiz, r.startContainer, r.startOffset), fin = posicion(raiz, r.endContainer, r.endOffset);
    if (ini < 0 || fin <= ini) return null;
    var base = nodos(raiz).texto, cita = base.slice(ini, fin), lead = cita.length - cita.replace(/^\s+/, '').length, trail = cita.length - cita.replace(/\s+$/, '').length;
    ini += lead; fin -= trail; cita = base.slice(ini, fin);
    if (cita.length < 2 || cita.length > 1500) return null;
    return { ini: ini, fin: fin, cita: cita, antes: base.slice(Math.max(0, ini - 32), ini), despues: base.slice(fin, fin + 32), rect: r.getBoundingClientRect() };
  }

  function mostrarBar() {
    var sel = seleccionActual();
    if (!sel) { ocultarBar(); return; }
    if (N.pop) return;
    N.sel = sel; ocultarBar();
    var bar = h('div', { class: 'tm-bar tm-ui', role: 'toolbar', 'aria-label': 'Subrayar y anotar' }, [h('span', { class: 'tm-bar__lbl', text: 'Nota' })].concat(COLORES.map(function (c) {
      return h('button', { type: 'button', class: 'tm-color', 'data-c': c[0], 'aria-label': 'Subrayar en ' + c[1].toLowerCase() + ' y escribir una nota', title: c[1] });
    })));
    bar.addEventListener('mousedown', function (e) { e.preventDefault(); });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.tm-color'); if (!b) return;
      crearNota(b.getAttribute('data-c'));
    });
    document.body.appendChild(bar); N.bar = bar;
    var tactil = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    colocarEn(bar, sel.rect, tactil);
  }

  function crearNota(color) {
    var C = N.cfg, s = N.sel; if (!s) return;
    var n = { id: nuevoId(), pagina: C.pagina(), url: C.url(), color: color, cita: s.cita, antes: s.antes, despues: s.despues, texto: '', creada: Date.now(), editada: Date.now() };
    var sec = null; try { var raiz = C.raiz(), t = nodos(raiz).lista.filter(function (e) { return e.fin >= s.ini; })[0]; sec = t && t.nodo.parentNode.closest('section[id], [data-sec]'); } catch (e) {}
    if (sec) n.seccion = sec.id || sec.getAttribute('data-sec') || '';
    C.adaptador.poner(n);
    var sx = window.getSelection(); if (sx) sx.removeAllRanges();
    ocultarBar(); N.sel = null;
    aplicar();
    var m = $('mark.tm-sub[data-id="' + n.id + '"]');
    abrirPop(n.id, m ? m.getBoundingClientRect() : s.rect);
  }

  function abrirPop(id, rect) {
    cerrarPop(); ocultarBar();
    var C = N.cfg, n = C.adaptador.listar().filter(function (x) { return x.id === id; })[0]; if (!n) return;
    var ta = h('textarea', { rows: '3', placeholder: 'Escribe tu nota (opcional)…', 'aria-label': 'Tu nota' }); ta.value = n.texto || '';
    var color = n.color;
    var cita = h('blockquote', { class: 'tm-pop__cita', text: recorta(n.cita, 160) }); cita.style.setProperty('--tm-c', 'var(--tm-n' + color + ')');
    var colores = h('div', { class: 'tm-pop__colores', role: 'group', 'aria-label': 'Color' }, COLORES.map(function (c) {
      return h('button', { type: 'button', class: 'tm-color', 'data-c': c[0], 'aria-pressed': String(c[0] === color), 'aria-label': c[1], title: c[1] });
    }));
    colores.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.tm-color'); if (!b) return;
      color = b.getAttribute('data-c'); cita.style.setProperty('--tm-c', 'var(--tm-n' + color + ')');
      $$('.tm-color', colores).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
    function guardarYCerrar() {
      n.texto = ta.value.trim(); n.color = color; n.editada = Date.now();
      C.adaptador.poner(n); cerrarPop(); aplicar();
    }
    var pop = h('div', { class: 'tm-pop tm-ui', role: 'dialog', 'aria-label': 'Nota subrayada' }, [
      cita, ta, colores,
      h('div', { class: 'tm-pop__fila' }, [
        h('button', { type: 'button', class: 'tm-btn tm-btn--peligro', text: 'Quitar', onclick: function () { C.adaptador.quitar(n.id); cerrarPop(); aplicar(); } }),
        h('span', { class: 'tm-sp' }),
        h('button', { type: 'button', class: 'tm-btn', text: 'Cerrar', onclick: function () { cerrarPop(); } }),
        h('button', { type: 'button', class: 'tm-btn tm-btn--pri', text: 'Guardar', onclick: guardarYCerrar })
      ])
    ]);
    pop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); cerrarPop(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) guardarYCerrar();
    });
    document.body.appendChild(pop); N.pop = pop;
    colocarEn(pop, rect, true);
    ta.focus({ preventScroll: true });
  }

  // ---- botón flotante «Notas» y panel
  function actualizarBoton() {
    if (!N.btn) return;
    var c = $('b', N.btn); if (c) c.textContent = String(N.notas.length);
    if (N.panel) pintarPanel();
  }
  var panelTab = 'pagina';
  function pintarPanel() {
    var C = N.cfg, lista = $('.tm-notas__lista', N.panel); lista.innerHTML = '';
    var todas = C.adaptador.listar(), pag = C.pagina();
    var vista = (panelTab === 'pagina' ? todas.filter(function (n) { return n.pagina === pag; }) : todas).slice().sort(function (a, b) { return (b.editada || 0) - (a.editada || 0); });
    $$('.tm-notas__tabs button', N.panel).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tab') === panelTab)); });
    if (!vista.length) {
      lista.appendChild(h('div', { class: 'tm-notas__vacio', html: '<b>' + (panelTab === 'pagina' ? 'Aún no subrayas nada aquí' : 'Todavía no tienes notas') + '</b>Selecciona un texto mientras lees, elige un color y escribe lo que quieras recordar. Queda subrayado y guardado en este navegador.' }));
    }
    vista.forEach(function (n) {
      var aqui = n.pagina === pag;
      var it = h('button', { type: 'button', class: 'tm-nota', 'data-c': n.color || '1' }, [
        h('q', { text: recorta(n.cita, 200) }),
        n.texto ? h('p', { text: n.texto }) : null,
        h('small', { text: (aqui ? '' : (n.titulo || n.pagina) + ' · ') + new Date(n.editada || n.creada).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) + (n.huerfana ? ' · el texto cambió' : '') })
      ]);
      it.addEventListener('click', function () {
        if (aqui) { cerrarPanel(); irA(n.id); }
        else { try { sessionStorage.setItem('tm-ir', n.id); } catch (e) {} location.href = n.url || n.pagina; }
      });
      lista.appendChild(it);
    });
  }
  function cerrarPanel() { if (N.panel) { N.panel.remove(); N.panel = null; } }
  function abrirPanel() {
    if (N.panel) return;
    var C = N.cfg;
    var p = h('aside', { class: 'tm-notas tm-ui', 'aria-label': 'Mis notas' }, [
      h('div', { class: 'tm-notas__cab' }, [h('h2', { text: 'Mis notas' }), h('button', { type: 'button', class: 'tm-notas__x', 'aria-label': 'Cerrar', html: '×', onclick: cerrarPanel })]),
      h('div', { class: 'tm-notas__tabs' }, [h('button', { type: 'button', 'data-tab': 'pagina', text: 'Esta página' }), h('button', { type: 'button', 'data-tab': 'todas', text: 'Todas' })]),
      h('div', { class: 'tm-notas__lista' }),
      h('div', { class: 'tm-notas__pie' }, [
        h('button', { type: 'button', class: 'tm-btn', text: 'Copiar como texto', onclick: function (e) {
          var b = e.currentTarget, txt = C.adaptador.listar().map(function (n) { return '> ' + n.cita + (n.texto ? '\n' + n.texto : '') + '\n(' + (n.titulo || n.pagina) + ')'; }).join('\n\n');
          (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { b.textContent = 'Copiado'; }, function () { b.textContent = 'No se pudo copiar'; });
        } }),
        h('span', { text: 'Tus notas se guardan solo en este navegador.' })
      ])
    ]);
    p.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-tab]'); if (t) { panelTab = t.getAttribute('data-tab'); pintarPanel(); } });
    p.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarPanel(); });
    document.body.appendChild(p); N.panel = p; pintarPanel();
    $('.tm-notas__x', p).focus();
  }

  function notas(o) {
    o = o || {};
    var sel = o.raiz || attr('notas', '');
    if (!sel && !o.raiz) return;
    var clave = (o.clave || attr('clave', 'tm')) + '-notas';
    N.cfg = {
      raiz: typeof sel === 'function' ? sel : function () { return typeof sel === 'string' ? $(sel) : sel; },
      pagina: o.pagina || function () { return location.pathname; },
      url: o.url || function () { return location.pathname + location.search; },
      adaptador: o.adaptador || adaptadorLocal(clave)
    };
    if (N.iniciado) { aplicar(); return; }
    N.iniciado = true;
    if (o.boton !== false) {
      N.btn = h('button', { type: 'button', class: 'tm-notas-btn tm-ui', 'aria-label': 'Abrir mis notas', html: '<i></i><span>Notas</span><b>0</b>', onclick: abrirPanel });
      document.body.appendChild(N.btn);
      var dock = $('.tm-dock'); if (dock) dock.classList.add('tm-con-notas');
    }
    var espera = null;
    function evaluar() { clearTimeout(espera); espera = setTimeout(mostrarBar, 30); }
    document.addEventListener('mouseup', function (e) { if (e.target.closest && e.target.closest('.tm-ui')) return; evaluar(); });
    document.addEventListener('keyup', function (e) { if (e.shiftKey || /Arrow|Home|End/.test(e.key)) evaluar(); });
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      document.addEventListener('selectionchange', function () { clearTimeout(espera); espera = setTimeout(function () { if (!N.pop) mostrarBar(); }, 450); });
    }
    document.addEventListener('mousedown', function (e) {
      if (N.bar && !e.target.closest('.tm-bar')) ocultarBar();
      if (N.pop && !e.target.closest('.tm-pop') && !e.target.closest('mark.tm-sub')) cerrarPop();
    });
    document.addEventListener('click', function (e) {
      var m = e.target.closest && e.target.closest('mark.tm-sub'); if (!m || e.target.closest('a')) return;
      var s = window.getSelection(); if (s && !s.isCollapsed) return;
      abrirPop(m.getAttribute('data-id'), m.getBoundingClientRect());
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('mark.tm-sub')) { e.preventDefault(); abrirPop(e.target.getAttribute('data-id'), e.target.getBoundingClientRect()); }
      if (e.key === 'Escape') { ocultarBar(); cerrarPop(); }
    });
    window.addEventListener('storage', function (e) { if (e.key === clave) aplicar(); });
    aplicar();
  }

  window.TrueMLPiezas = { volver: volver };
  window.TrueMLAvance = { init: avance, resumen: resumen };
  window.TrueMLNotas = { init: notas, aplicar: aplicar, abrirPanel: abrirPanel };

  function arrancar() {
    volver();
    if (tiene('avance')) avance();
    if (tiene('notas')) notas();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
})();
