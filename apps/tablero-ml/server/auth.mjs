/* Acceso al tablero. Nada de esto guarda secretos en el repo: todo sale de variables de entorno.
   - APP_PASSWORD: la única contraseña. El login la compara en tiempo constante y, si acierta, deja una cookie de sesión.
   - SESSION_SECRET (≥ 32 caracteres): firma la cookie con HMAC-SHA256. Cambiarlo cierra todas las sesiones.
   - API_TOKEN (≥ 32 caracteres): el token de Claude Code, por `Authorization: Bearer …`. Tiene permisos acotados
     (no borra ni reordena pasos, ni borra o reemplaza proyectos).
   La cookie es `__Host-tablero`: HttpOnly (el JavaScript de la página no la lee), Secure, SameSite=Strict y Path=/. */
import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';

export const COOKIE = '__Host-tablero';
export const SESSION_DAYS = 60;
const MIN_SECRET = 32;

const sha = (s) => createHash('sha256').update(String(s)).digest();
// Compara dos textos en tiempo constante (los hashes tienen el mismo largo aunque los textos no).
export const safeEqual = (a, b) => timingSafeEqual(sha(a), sha(b));
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (secret, payload) => b64u(createHmac('sha256', secret).update(payload).digest());

export function configProblems(env) {
  const p = [];
  if (!env.APP_PASSWORD || env.APP_PASSWORD.length < 12) p.push('APP_PASSWORD missing (12+ characters; 4 or more random words work well)');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < MIN_SECRET) p.push(`SESSION_SECRET missing (${MIN_SECRET}+ characters)`);
  return p;
}

export function makeSession(env, now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const payload = `v1.${exp}.${b64u(randomBytes(12))}`;
  return `${payload}.${sign(env.SESSION_SECRET, payload)}`;
}

export function verifySession(env, value, now = Date.now()) {
  if (!value || typeof value !== 'string' || value.length > 200 || !env.SESSION_SECRET) return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const payload = parts.slice(0, 3).join('.');
  if (!safeEqual(sign(env.SESSION_SECRET, payload), parts[3])) return false;
  return Number(parts[1]) * 1000 > now;
}

export function sessionCookie(value) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function readCookie(request, name = COOKIE) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

// ¿Quién llama? 'web' (cookie válida), 'claude' (token válido) o null.
export function whoIs(env, request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    return env.API_TOKEN && env.API_TOKEN.length >= MIN_SECRET && safeEqual(t, env.API_TOKEN) ? 'claude' : null;
  }
  return verifySession(env, readCookie(request)) ? 'web' : null;
}

export const checkPassword = (env, given) => typeof given === 'string' && given.length <= 200 && safeEqual(given, env.APP_PASSWORD || '');

// La IP para limitar intentos de login: Vercel pone la del visitante en x-forwarded-for / x-real-ip.
export function clientIp(request) {
  const xff = request.headers.get('x-forwarded-for');
  return (xff ? xff.split(',')[0] : request.headers.get('x-real-ip') || 'local').trim().slice(0, 64);
}
