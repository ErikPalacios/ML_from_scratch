/* El «servidor» del tablero dentro del navegador, como el de la demo pública del tablero (apps/tablero-demo,
   demo-boot.js): guarda el documento en localStorage y aplica cada cambio con el mismo motor (ops + validación).
   Nada sale de este navegador. Cuando haya cuentas, estas mismas funciones mandan las ops a la API en lugar de
   guardarlas aquí; el documento y las ops no cambian.
     leer()            → el tablero (migrado)
     cambiar(ops)      → { tablero, rechazadas }
     reemplazar(doc)   → el tablero nuevo (restaurar un respaldo)
     borrar()          → un tablero vacío */
import { migrar, nuevoTablero, validar, aplicar, APP } from './modelo.mjs';

const CLAVE = 'dojo-tablero';
let memoria = null; // si localStorage está bloqueado, el tablero vive mientras la página esté abierta

export function crearAlmacen(plantilla, storage = globalThis.localStorage) {
  const guardar = (doc) => {
    try { storage.setItem(CLAVE, JSON.stringify(doc)); memoria = null; } catch { memoria = doc; }
    return doc;
  };
  const leer = () => {
    if (memoria) return migrar(memoria, plantilla);
    try {
      const d = JSON.parse(storage.getItem(CLAVE));
      if (d && d.app === APP) return migrar(d, plantilla);
    } catch { /* primera visita o almacenamiento bloqueado */ }
    return nuevoTablero(plantilla);
  };
  return {
    leer,
    persistente: () => { try { storage.setItem(CLAVE + ':prueba', '1'); storage.removeItem(CLAVE + ':prueba'); return true; } catch { return false; } },
    cambiar(ops) {
      const cur = leer();
      const res = aplicar(cur, ops);
      if (!res.applied) return { tablero: cur, rechazadas: res.rejected };
      res.project.rev = cur.rev + 1;
      return { tablero: guardar(res.project), rechazadas: res.rejected };
    },
    reemplazar(doc) {
      const d = migrar(doc, plantilla);
      const errores = validar(d);
      if (errores.length) throw new Error(`El respaldo no es válido: ${errores.slice(0, 3).join('; ')}`);
      d.rev = leer().rev + 1;
      return guardar(d);
    },
    borrar() { try { storage.removeItem(CLAVE); } catch { /* nada */ } memoria = null; return guardar(nuevoTablero(plantilla)); },
  };
}
