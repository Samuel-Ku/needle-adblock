// THROWAWAY: interactively inspect actual local model decisions; no persistence.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createClassifier } from '../extension/needle-runtime.js';
import { TOOLS, describeCandidate, interpret } from '../extension/classification.js';

const vendor = new URL('../extension/vendor/', import.meta.url);
const sandbox = { require: createRequire(import.meta.url), process, console, WebAssembly, TextDecoder, TextEncoder, performance, setTimeout, clearTimeout, Buffer, __dirname: fileURLToPath(vendor), __filename: fileURLToPath(new URL('needle.js', vendor)), module: { exports: {} } };
vm.runInNewContext(await readFile(new URL('needle.js', vendor), 'utf8'), sandbox);
const engine = await sandbox.createNeedle({ wasmBinary: await readFile(new URL('needle.wasm', vendor)) });
const weights = await readFile(new URL('needle3.cact', vendor));
const pointer = engine._malloc(weights.length);
engine.HEAPU8.set(weights, pointer);
const loaded = engine._needle_load(pointer, BigInt(weights.length));
engine._free(pointer);
if (loaded < 0) throw new Error('Model load failed.');
const classifier = createClassifier(engine, TOOLS, describeCandidate);
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const state = { model: 'Cactus-Compute/needle3', threshold: 0.7, input: null, decision: null, action: 'keep', raw: null };
const examples = [
  'Sponsored. SuperVPN. Protect your connection today. Get 60% off. Shop now.',
  'City council approves new public park. Residents welcome more green space.',
  'An investigation into how advertising influences journalism.',
  'Subscribe to our free weekly newsletter.',
];
let index = 0;
try {
  while (true) {
    if (process.stdout.isTTY) console.clear();
    console.log('NEEDLE ADBLOCK — THROWAWAY LOGIC PROTOTYPE\n');
    console.log(JSON.stringify(state, null, 2));
    console.log('\n[e] next example   [t 0.8] threshold   [q] quit   Or enter element text');
    const input = (await terminal.question('> ')).trim();
    if (input === 'q') break;
    if (/^t /.test(input)) {
      const value = Number(input.slice(2));
      if (Number.isFinite(value)) state.threshold = Math.min(.95, Math.max(.3, value));
    } else if (input) {
      state.input = input === 'e' ? examples[index++ % examples.length] : input;
      state.raw = classifier.classify({ text: state.input });
      state.decision = interpret(state.raw);
    }
    state.action = state.decision?.label === 'ad' && state.decision.confidence >= state.threshold ? 'would remove' : 'keep';
  }
} finally { terminal.close(); classifier.dispose(); }
