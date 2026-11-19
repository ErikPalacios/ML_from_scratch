// La mudanza a trueml.app (noviembre de 2026). Cada herramienta vivía en una dirección *.vercel.app y su avance
// (localStorage) se queda pegado a esa dirección: el navegador no lo comparte con el dominio nuevo. Esta página lo
// lleva de una a otra sin que la persona haga nada.
//
//   En la dirección vieja: vercel.json manda cada visita a /mudanza.html?a=<ruta>. Aquí se junta todo el localStorage
//   y se va a https://<nuevo>/mudanza.html#a=<ruta>&d=<datos>. El fragmento (#) nunca sale del navegador.
//   En la dirección nueva: se guardan las claves que todavía no existan (lo nuevo no se pisa) y se sigue a <ruta>.
//
// Los buscadores y las vistas previas de redes no pasan por aquí: vercel.json les da un 301 directo.
// Fuente: apps/trueml/mudanza.js (se copia con node apps/trueml/sync.mjs).
(function () {
  var DESTINOS = {
    'ml-desde-cero.vercel.app': 'https://trueml.app',
    'sensei-ml.vercel.app': 'https://sensei.trueml.app',
    'taller-ai-engineer.vercel.app': 'https://dojo.trueml.app',
    'ronda-diseno-ml.vercel.app': 'https://ronda.trueml.app',
    'cheat-sheets-ml.vercel.app': 'https://hojas.trueml.app',
    'atlas-arquitecturas.vercel.app': 'https://atlas.trueml.app',
    'laboratorio-transformer.vercel.app': 'https://transformer.trueml.app',
    'tablero-ml-demo.vercel.app': 'https://tablero.trueml.app'
  };

  // Solo rutas de este mismo sitio ("/algo"), nunca "//otro-sitio" ni "https://…".
  function rutaSegura(r) { return typeof r === 'string' && r.charAt(0) === '/' && r.charAt(1) !== '/' && r.charAt(1) !== '\\' ? r : '/'; }

  function aBase64(texto) {
    var bytes = new TextEncoder().encode(texto), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function deBase64(b64) {
    var bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  var destino = DESTINOS[location.hostname];
  if (destino) {
    // Dirección vieja: empacar y mandar.
    // El navegador conserva el #… de la URL original al pasar por la redirección (la Ronda y el Atlas lo usan): va con la ruta.
    var ruta = rutaSegura(new URLSearchParams(location.search).get('a')) + location.hash;
    var datos = {}, hay = false;
    try {
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); datos[k] = localStorage.getItem(k); hay = true; }
    } catch (e) { hay = false; }
    location.replace(hay ? destino + '/mudanza.html#a=' + encodeURIComponent(ruta) + '&d=' + aBase64(JSON.stringify(datos)) : destino + ruta);
    return;
  }

  // Dirección nueva: desempacar y seguir.
  var p = new URLSearchParams(location.hash.slice(1));
  var siguiente = rutaSegura(p.get('a'));
  try {
    var recibidos = JSON.parse(deBase64(p.get('d') || ''));
    for (var clave in recibidos) {
      if (Object.prototype.hasOwnProperty.call(recibidos, clave) && localStorage.getItem(clave) === null) localStorage.setItem(clave, String(recibidos[clave]));
    }
  } catch (e) { /* sin datos o datos rotos: se sigue igual */ }
  location.replace(siguiente);
})();
