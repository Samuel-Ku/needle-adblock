import { DEFAULTS, normalizeSettings } from './settings.js';

let creatingOffscreen;
let settingsQueue = Promise.resolve();
const tabJobs = new Set();

async function getSettings() {
  const { settings } = await chrome.storage.session.get('settings');
  return normalizeSettings(settings || DEFAULTS);
}

async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen.html');
  if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['WORKERS'],
      justification: 'Run packaged Needle3 WebAssembly in a dedicated worker for local DOM classification.',
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function infer(type, candidates) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'needle:offscreen', type, candidates });
}

async function tabMessage(tabId, message) {
  if (!Number.isInteger(tabId)) throw new Error('Open a regular web page first.');
  try { return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }); }
  catch { throw new Error('Reload the web page after loading the extension. Browser settings pages are unsupported.'); }
}

async function route(message, sender) {
  if (message.type === 'needle:settings') return { settings: await getSettings() };
  if (message.type === 'needle:judge') {
    if (!sender.tab || sender.frameId !== 0) throw new Error('Only the top page can request classification.');
    if (!(await getSettings()).enabled) return { results: [] };
    if (!Array.isArray(message.candidates) || message.candidates.length > 12) throw new Error('Invalid candidate batch.');
    const jobKey = `${sender.tab.id}:${sender.documentId}`;
    if (tabJobs.has(jobKey)) throw new Error('This document already has a pending batch.');
    tabJobs.add(jobKey);
    try { return await infer('classify', message.candidates); }
    finally { tabJobs.delete(jobKey); }
  }
  if (message.type === 'needle:stats') {
    if (!sender.tab || sender.frameId !== 0) return {};
    const stats = message.stats;
    await chrome.storage.session.set({ [`tab:${sender.tab.id}`]: { stats, documentId: sender.documentId } });
    const count = (stats.removed || 0) + (stats.highlighted || 0);
    await chrome.action.setBadgeText({ tabId: sender.tab.id, text: count ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#27624b' });
    return {};
  }
  // Settings and commands come from extension pages, never from page content.
  if (sender.url !== chrome.runtime.getURL('popup.html')) throw new Error('Open the extension popup to change settings.');
  if (message.type === 'needle:configure') {
    const update = settingsQueue.then(async () => {
      const settings = normalizeSettings({ ...await getSettings(), ...message.settings });
      await chrome.storage.session.set({ settings });
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'needle:configure', settings }, { frameId: 0 })));
      return { settings };
    });
    settingsQueue = update.catch(() => {});
    return update;
  }
  if (message.type === 'needle:warmup') return infer('warmup');
  if (message.type === 'needle:status') {
    const settings = await getSettings();
    const key = `tab:${message.tabId}`;
    const stored = (await chrome.storage.session.get(key))[key];
    let runtime = { state: 'idle' };
    if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
      runtime = (await chrome.runtime.sendMessage({ target: 'needle:offscreen', type: 'status' }))?.runtime || runtime;
    }
    return { settings, stats: stored?.stats || {}, runtime };
  }
  if (['needle:rescan', 'needle:restore'].includes(message.type)) return tabMessage(message.tabId, { type: message.type });
  throw new Error('Unknown request.');
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.target === 'needle:offscreen' || !message.type?.startsWith('needle:')) return;
  route(message, sender).then(reply, error => reply({ error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove(`tab:${tabId}`));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') {
    chrome.storage.session.remove(`tab:${tabId}`);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
});
