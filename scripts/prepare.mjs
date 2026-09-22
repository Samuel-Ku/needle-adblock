import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Pinned official release; executable assets are packaged, never downloaded by the extension.
const revision = 'b274efcb211a9eef48c9a88da4b43bd569696a39';
const base = `https://huggingface.co/Cactus-Compute/needle3/resolve/${revision}/`;
const destination = new URL('../extension/vendor/', import.meta.url);
const files = [
  ['wasm/needle.js', 'needle.js', 'd00ec67ec7e03e4720dfc6c3dad95a0540afd00169a983ce3fabcd7aeaa0fa93'],
  ['wasm/needle.wasm', 'needle.wasm', '77c6a38cacb8efbeebfd5202082ba9a0850a7c3066db40d4d0e80509cd137d9b'],
  ['needle3.cact', 'needle3.cact', 'c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38'],
  ['LICENSE', 'LICENSE-Needle.txt', null],
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(destination, { recursive: true });
for (const [remote, local, sha] of files) {
  const target = new URL(local, destination);
  const cached = await readFile(target).catch(() => null);
  if (cached && (!sha || digest(cached) === sha)) continue;
  console.log(`Downloading official Needle3 asset: ${local}`);
  const response = await fetch(base + remote, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`${local}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha && digest(bytes) !== sha) throw new Error(`Integrity check failed: ${local}`);
  const partial = new URL(`${local}.partial`, destination);
  await writeFile(partial, bytes);
  await rename(partial, target);
}
const source = await readFile(new URL('needle.js', destination), 'utf8');
await writeFile(new URL('needle.mjs', destination), `${source}\nexport default createNeedle;\n`);
console.log(`Needle3 ready. Load unpacked extension from ${fileURLToPath(new URL('../extension/', import.meta.url))}`);
