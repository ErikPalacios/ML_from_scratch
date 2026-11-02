#!/usr/bin/env node
// Uploads dist/ to the Vercel project «tablero-ml-demo» (static; no Functions, no database).
// First time: run `npx vercel link --yes --project tablero-ml-demo` in this folder (writes .vercel/, git ignores it).
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const link = join(ROOT, '.vercel', 'project.json');
if (!existsSync(link)) { console.error('[deploy] missing .vercel/project.json: run `npx vercel link --yes --project tablero-ml-demo` first.'); process.exit(1); }
const { projectId, orgId } = JSON.parse(readFileSync(link, 'utf8'));
execFileSync('npx', ['vercel', 'deploy', 'dist', '--prod', '--yes'], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, VERCEL_PROJECT_ID: projectId, VERCEL_ORG_ID: orgId },
});
