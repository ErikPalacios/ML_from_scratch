// La única Vercel Function del tablero: vercel.json manda aquí todo /api/* (con la ruta en ?__route=).
// Toda la lógica vive en server/handler.mjs, que también usan tools/dev.mjs y los tests.
import { handle } from '../server/handler.mjs';
import { storeFromEnv } from '../server/store.mjs';

const store = storeFromEnv(process.env);

export default {
  fetch(request) {
    return handle(request, { env: process.env, store });
  },
};
