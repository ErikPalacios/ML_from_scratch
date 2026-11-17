// El Chromium con el que se graban las capturas. CHROME=<ruta> para usar otro.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const CANDIDATOS = [
  process.env.CHROME,
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export async function abrir() {
  const executablePath = CANDIDATOS.find((c) => existsSync(c));
  return chromium.launch(executablePath ? { executablePath } : {});
}
