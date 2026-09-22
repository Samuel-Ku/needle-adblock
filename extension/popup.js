// Throwaway prototype controls. Session settings and inference live in the background.
const byId = (id) => document.getElementById(id);
const fields = ["enabled", "threshold", "mode", "animation", "toast"];
let tabId;
let polling = false;
let dirtyField = null;
let settings = {};

function showError(message = "") {
  byId("error").textContent = message;
  byId("error").hidden = !message;
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

function renderSettings(next) {
  if (!next) return;
  settings = next;
  for (const key of fields) {
    if (dirtyField === key) continue;
    const field = byId(key);
    if (field.type === "checkbox") field.checked = Boolean(next[key]);
    else field.value = next[key];
  }
  byId("threshold-value").textContent = `${Math.round(Number(byId("threshold").value) * 100)}%`;
}

function renderStatus(status) {
  renderSettings(status.settings);
  const stats = status.stats || {};
  const runtime = status.runtime || { state: "idle" };
  const labels = { idle: "Model not loaded", loading: "Loading local model…", ready: "Local model ready", error: "Model unavailable" };
  byId("runtime-state").textContent = labels[runtime.state] || runtime.state;
  byId("runtime-dot").dataset.state = runtime.state;
  byId("warmup").hidden = runtime.state === "ready";
  byId("warmup").disabled = runtime.state === "loading";
  byId("warmup").textContent = runtime.state === "error" ? "Retry loading model" : "Load model";
  byId("judged").textContent = stats.judged ?? 0;
  byId("pending").textContent = stats.pending ?? 0;
  const highlighted = settings.mode === "highlight";
  byId("affected").textContent = (highlighted ? stats.highlighted : stats.removed) ?? 0;
  byId("affected-label").textContent = highlighted ? "Highlighted" : "Removed";
  byId("state").textContent = JSON.stringify({ tabId, settings, runtime, stats }, null, 2);
  if (runtime.error || stats.lastError || status.error) showError(runtime.error || stats.lastError || status.error);
}

async function refresh() {
  if (polling || tabId === undefined) return;
  polling = true;
  try {
    renderStatus(await send({ type: "needle:status", tabId }));
  } catch (error) {
    showError(error.message);
  } finally {
    polling = false;
  }
}

for (const key of fields) {
  const field = byId(key);
  field.addEventListener("input", () => {
    dirtyField = key;
    if (key === "threshold") byId("threshold-value").textContent = `${Math.round(Number(field.value) * 100)}%`;
  });
  field.addEventListener("change", async () => {
    const value = field.type === "checkbox" ? field.checked : key === "threshold" ? Number(field.value) : field.value;
    try {
      showError();
      const response = await send({ type: "needle:configure", settings: { [key]: value } });
      if (response.error) throw new Error(response.error);
      dirtyField = null;
      renderSettings(response.settings);
      await refresh();
    } catch (error) {
      dirtyField = null;
      showError(error.message);
    }
  });
}

for (const command of ["rescan", "restore", "warmup"]) {
  byId(command).addEventListener("click", async () => {
    const button = byId(command);
    button.disabled = true;
    try {
      showError();
      const response = await send({ type: `needle:${command}`, tabId });
      if (response?.error) throw new Error(response.error);
      await refresh();
    } catch (error) {
      showError(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function initialize() {
  try {
    renderSettings((await send({ type: "needle:settings" })).settings);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    if (tabId === undefined) throw new Error("Open a webpage to inspect it.");
    await refresh();
    setInterval(refresh, 1200);
  } catch (error) {
    showError(error.message);
  }
}

initialize();
