// Compile un fichier TypeScript avec esbuild (JSON inclus) puis l'exécute avec node.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const entry = process.argv[2];
const args = process.argv.slice(3);
const dir = mkdtempSync(path.join(tmpdir(), 'rts-'));
const out = path.join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, loader: { '.json': 'json' }, logLevel: 'error' });
const r = spawnSync(process.execPath, [out, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
