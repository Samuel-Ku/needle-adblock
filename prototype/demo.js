// PROTOTYPE: inspect real local model decisions and reversible page edits.
// This adapter substitutes browser-extension transport only; it does not mock inference.
const byId = (id) => document.getElementById(id);
let settings = { enabled: false, threshold: 0.7, mode: "highlight", animation: true, toast: true };
let runtime = { state: "idle" };
let stats = { candidates: 0, judged: 0, removed: 0, highlighted: 0, pending: 0, lastError: null, elapsedMs: 0, recent: [] };
let scannerState = null;
let worker;
let requestId = 0;
let addedAds = 0;
const pending = new Map();
const contentListeners = new Set();

function showError(message = "") {
  if (byId("error").textContent !== message) byId("error").textContent = message;
  byId("error").hidden = !message;
}

function currentState() {
  return { prototype: true, transport: "browser Worker", settings, runtime, stats, retained: scannerState?.retained || 0, restoreLimit: scannerState?.restoreLimit || 100 };
}

function setText(id, text) {
  if (byId(id).textContent !== text) byId(id).textContent = text;
}

function render() {
  const labels = { idle: "Model not loaded", loading: "Loading Needle3…", ready: "Needle3 ready · local inference", error: "Model unavailable" };
  setText("runtime-label", labels[runtime.state] || runtime.state);
  byId("runtime-dot").dataset.state = runtime.state;
  setText("runtime-detail", runtime.state === "loading" ? "Loading local model files and initializing the browser runtime." : runtime.state === "error" ? "See the error below. No fallback classifier is used." : "No API key. Inference stays in your browser.");
  byId("start").disabled = runtime.state === "loading";
  setText("start", runtime.state === "loading" ? "Loading model…" : runtime.state === "ready" ? "Start scanning" : runtime.state === "error" ? "Retry model & start scanning" : "Load model & start scanning");
  byId("enabled").checked = settings.enabled;
  byId("mode").value = settings.mode;
  if (document.activeElement !== byId("threshold")) byId("threshold").value = settings.threshold;
  setText("threshold-value", `${Math.round(Number(byId("threshold").value) * 100)}%`);
  setText("summary", `${stats.judged} checked · ${stats.highlighted} highlighted · ${stats.removed} removed · ${stats.pending} pending`);
  setText("state", JSON.stringify(currentState(), null, 2));
  if (runtime.error || stats.lastError) showError(runtime.error || stats.lastError);
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../extension/inference-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") return;
    if (data.runtime) runtime = data.runtime;
    if (data.type === "status") {
      render();
      return;
    }
    const request = pending.get(data.id);
    if (request) {
      pending.delete(data.id);
      request.resolve(data);
    }
    render();
  };
  worker.onerror = (event) => {
    const error = event.message || "The inference worker could not start.";
    runtime = { state: "error", error };
    for (const request of pending.values()) request.reject(new Error(error));
    pending.clear();
    worker.terminate();
    worker = null;
    render();
  };
  return worker;
}

function workerRequest(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    try {
      const target = ensureWorker();
      pending.set(id, { resolve, reject });
      target.postMessage({ id, type, ...payload });
    } catch (error) {
      pending.delete(id);
      runtime = { state: "error", error: error.message };
      render();
      reject(error);
    }
  });
}

async function routeMessage(message) {
  if (message.type === "needle:settings") return { settings };
  if (message.type === "needle:stats") {
    stats = message.stats;
    render();
    return { ok: true };
  }
  if (message.type === "needle:judge") {
    try {
      const response = await workerRequest("classify", { candidates: message.candidates });
      if (response.error) showError(response.error);
      return response;
    } catch (error) {
      return { results: [], error: error.message };
    }
  }
  return { error: `Unsupported prototype message: ${message.type}` };
}

// Provide exactly the transport surface used by the shared content script.
window.chrome = {
  ...window.chrome,
  runtime: {
    sendMessage(message, callback) {
      const promise = routeMessage(message);
      if (callback) promise.then(callback, (error) => callback({ error: error.message }));
      return promise;
    },
    onMessage: {
      addListener(listener) { contentListeners.add(listener); },
      removeListener(listener) { contentListeners.delete(listener); },
    },
  },
};

function command(type, extra = {}) {
  let response;
  for (const listener of contentListeners) listener({ type, ...extra }, {}, (value) => { response = value; });
  if (response?.stats) {
    scannerState = response;
    stats = response.stats;
  }
  render();
  return response;
}

function configure(partial) {
  settings = { ...settings, ...partial };
  const response = command("needle:configure", { settings });
  if (response?.settings) settings = response.settings;
  render();
  return currentState();
}

window.addEventListener("needle:state-changed", ({ detail }) => {
  scannerState = detail;
  settings = detail.settings;
  stats = detail.stats;
  render();
});

byId("start").addEventListener("click", async () => {
  showError();
  runtime = { state: "loading" };
  render();
  try {
    const response = await workerRequest("warmup");
    if (response.error || response.runtime?.state === "error") throw new Error(response.error || response.runtime.error);
    runtime = response.runtime || { state: "ready" };
    configure({ enabled: true });
    command("needle:rescan");
  } catch (error) {
    runtime = { state: "error", error: error.message };
    showError(error.message);
  }
  render();
});

byId("enabled").addEventListener("change", (event) => configure({ enabled: event.target.checked }));
byId("mode").addEventListener("change", (event) => configure({ mode: event.target.value }));
byId("threshold").addEventListener("input", (event) => setText("threshold-value", `${Math.round(Number(event.target.value) * 100)}%`));
byId("threshold").addEventListener("change", (event) => configure({ threshold: Number(event.target.value) }));
byId("rescan").addEventListener("click", () => { showError(); command("needle:rescan"); });
byId("restore").addEventListener("click", () => { showError(); command("needle:restore"); });
byId("add").addEventListener("click", () => {
  const card = document.createElement("article");
  card.className = "sponsored-content fixture-ad";
  card.dataset.sponsored = "true";
  card.dataset.fixture = "lazy-ad";
  const label = document.createElement("span");
  label.className = "ad-disclosure";
  label.textContent = "SPONSORED CONTENT";
  const title = document.createElement("h3");
  title.textContent = `A better morning starts here. Offer ${++addedAds}.`;
  const text = document.createElement("p");
  text.textContent = "BrewHouse coffee subscriptions. Freshly roasted beans at your door. Get 30% off your first delivery when you sign up today.";
  const link = document.createElement("a");
  link.href = "https://example.invalid/coffee?utm_source=sponsored";
  link.textContent = "Claim your discount →";
  card.append(label, title, text, link);
  byId("lazy-container").append(card);
  render();
});

byId("newsletter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  setText("newsletter-message", "Demo form checked. Your email was not sent or stored.");
});

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (link && new URL(link.href).hostname === "example.invalid") event.preventDefault();
});

window.NeedlePrototypeDemo = { configure, command, workerRequest, getState: currentState };
render();
const scanner = document.createElement("script");
scanner.src = new URL("../extension/content.js", import.meta.url).href;
scanner.onerror = () => showError("Could not load the shared page scanner. Start the prototype from the project’s local server.");
document.head.append(scanner);
