// Syntax and packaging checks only: the interactive fixtures provide prototype validation.
import { readFile, access, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
for (const folder of ['extension', 'scripts', 'prototype']) {
  for (const name of await readdir(new URL(`${folder}/`, root))) {
    if (!/\.(js|mjs)$/.test(name)) continue;
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(`${folder}/${name}`, root))], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
const manifest = JSON.parse(await readFile(new URL('extension/manifest.json', root)));
const assets = [manifest.background.service_worker, manifest.action.default_popup, 'offscreen.html', 'offscreen.js', 'inference-worker.js', 'vendor/needle.mjs', 'vendor/needle.wasm', 'vendor/needle3.cact', 'vendor/LICENSE-Needle.txt', ...manifest.content_scripts.flatMap(item => [...item.js, ...item.css])];
await Promise.all(assets.map(name => access(new URL(`extension/${name}`, root))));
console.log('JavaScript syntax and unpacked extension assets are valid.');
