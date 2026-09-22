let worker;
const pending = new Map();
let nextId = 0;
let runtime = { state: 'idle' };

function startWorker() {
  if (worker) return;
  worker = new Worker(new URL('inference-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'status') { runtime = data.runtime; return; }
    const request = pending.get(data.id);
    if (!request) return;
    if (data.type === 'progress') {
      clearTimeout(request.timer);
      request.timer = setTimeout(() => stopWorker('Local inference timed out. Try warming up again.'), 120_000);
      return;
    }
    clearTimeout(request.timer);
    pending.delete(data.id);
    request.resolve(data);
  };
  worker.onerror = event => stopWorker(event.message || 'Inference worker failed.');
}

function stopWorker(error) {
  worker?.terminate(); worker = null;
  runtime = { state: 'error', error };
  for (const request of pending.values()) {
    clearTimeout(request.timer); request.resolve({ error, runtime });
  }
  pending.clear();
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'needle:offscreen') return;
  if (message.type === 'status') { reply({ runtime }); return; }
  startWorker();
  const id = ++nextId;
  // Queued requests do not time out while another tab is making progress.
  pending.set(id, { resolve: reply, timer: null });
  worker.postMessage({ id, type: message.type, candidates: message.candidates });
  return true;
});
