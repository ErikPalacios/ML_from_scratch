import { Config } from '@remotion/cli/config';
import { existsSync } from 'node:fs';

// Chromium de Playwright ya descargado (evita bajar otro); si no está, Remotion usa el suyo.
const chrome = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
if (existsSync(chrome)) Config.setBrowserExecutable(chrome);
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setConcurrency(6);
