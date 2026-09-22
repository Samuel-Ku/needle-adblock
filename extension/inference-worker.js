import createNeedle from './vendor/needle.mjs';
import { createClassifier } from './needle-runtime.js';
import { TOOLS, describeCandidate, interpret } from './classification.js';

let classifier;
let loading;
let queue = Promise.resolve();
let runtime = { state: 'idle' };
function status(state, error) {
  runtime = { state, ...(error ? { error } : {}) };
  postMessage({ type: 'status', runtime });
}

async function asset(name) {
  const response = await fetch(new URL(`vendor/${name}`, import.meta.url));
  if (!response.ok) throw new Error(`Missing ${name}. Run npm run setup first.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function load() {
  if (classifier) return classifier;
  if (loading) return loading;
  status('loading');
  loading = (async () => {
    const [wasmBinary, weights] = await Promise.all([asset('needle.wasm'), asset('needle3.cact')]);
    const engine = await createNeedle({ wasmBinary });
    const address = engine._malloc(weights.byteLength);
    if (!address) throw new Error('Unable to allocate model memory.');
    try {
      engine.HEAPU8.set(weights, address);
      if (engine._needle_load(address, BigInt(weights.byteLength)) < 0) throw new Error('Needle rejected the model weights.');
    } finally { engine._free(address); }
    classifier = createClassifier(engine, TOOLS, describeCandidate);
    status('ready');
    return classifier;
  })().catch(error => { status('error', error.message); throw error; }).finally(() => { loading = null; });
  return loading;
}

onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const started = performance.now();
    postMessage({ type: 'progress', id: data.id });
    try {
      const model = await load();
      if (data.type === 'warmup') { postMessage({ id: data.id, runtime }); return; }
      if (data.type !== 'classify' || !Array.isArray(data.candidates) || data.candidates.length > 12) throw new Error('Invalid classification request.');
      const results = [];
      for (const candidate of data.candidates) {
        postMessage({ type: 'progress', id: data.id });
        try { results.push({ id: candidate.id, ...interpret(model.classify(candidate)) }); }
        catch (error) { results.push({ id: candidate.id, label: 'uncertain', confidence: null, error: error.message }); }
      }
      postMessage({ id: data.id, results, elapsedMs: Math.round(performance.now() - started) });
    } catch (error) { postMessage({ id: data.id, error: error.message, runtime }); }
  });
};
