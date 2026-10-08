import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
const r = await build({ entryPoints: ['src/client/main.ts'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, loader: { '.json': 'json' }, logLevel: 'error' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('tools/template.html', 'utf8').replace('/*JS*/', () => js);
writeFileSync('Project-Beta.html', html);
console.log('Project-Beta.html', (html.length / 1024).toFixed(0), 'Ko');

// serveur de parties : un seul fichier Node autonome (le module « ws » est inclus)
await build({ entryPoints: ['server/serveur.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node18', outfile: 'serveur.cjs', logLevel: 'error' });
console.log('serveur.cjs OK');
