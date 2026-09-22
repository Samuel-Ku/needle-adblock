/* PROTOTYPE: can a local semantic judge remove an ad card while preserving its feed? */
(() => {
  if (window.__needleContentPrototype) return;
  window.__needleContentPrototype = true;

  const DEFAULTS = { enabled: true, threshold: 0.7, mode: 'remove', animation: true, toast: true };
  const AD_TOKEN = /(?:^|[\s_-])(?:ads?|advert(?:isement|ising)?|sponsor(?:ed)?|banner)(?:$|[\s_\d-])|(?:adslot|adunit|adcontainer|adwrapper)/i;
  const AD_LABEL = /^(?:sponsored(?: content| post| by .{1,60})?|advertisement|advertising|advert|paid (?:content|post|partnership|placement)|partner offer|promoted|anzeige|werbung|реклама|спонсоровано|рекламний матеріал)\s*[:·]?$/i;
  const NETWORK = /(?:^|\.)(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adnxs\.com|amazon-adsystem\.com|taboola\.com|outbrain\.com|criteo\.com|adsrvr\.org)$/i;
  const SELECTOR = 'iframe, ins, [data-ad], [data-ad-slot], [data-ad-client], [data-ad-unit], [data-sponsored], [id*="ad-" i], [class*="ad-" i], [id*="ads" i], [class*="ads" i], [id*="advert" i], [class*="advert" i], [id*="sponsor" i], [class*="sponsor" i], [class*="banner" i], [aria-label]';
  const MAX_RETAINED = 100;
  let settings = { ...DEFAULTS };
  let epoch = 0;
  let sequence = 0;
  let queue = [];
  let busy = false;
  let scanTimer;
  let toastTimer;
  let seen = new WeakMap();
  const retained = new Map();
  const highlights = new Set();
  const animations = new Map();
  const stats = { candidates: 0, judged: 0, removed: 0, highlighted: 0, pending: 0, lastError: null, elapsedMs: 0, recent: [] };

  function send(message) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => { if (!done) { done = true; resolve(value); } };
      try {
        const result = chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          finish(error ? { error: error.message } : response);
        });
        if (result?.then) result.then(finish, (error) => finish({ error: error.message }));
      } catch (error) { finish({ error: error.message }); }
    });
  }

  function getState() {
    return { settings: { ...settings }, stats: { ...stats, recent: [...stats.recent] }, retained: retained.size, restoreLimit: MAX_RETAINED };
  }

  function publish() {
    stats.highlighted = highlights.size;
    // In-flight entries are included until their response is received.
    send({ type: 'needle:stats', stats: getState().stats });
    window.dispatchEvent(new CustomEvent('needle:state-changed', { detail: getState() }));
  }

  function remember(entry) {
    stats.recent.unshift(entry);
    stats.recent.length = Math.min(stats.recent.length, 12);
  }

  function host(value) {
    try { return new URL(value, location.href).hostname; } catch { return ''; }
  }

  function own(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element && element.closest?.('#needle-prototype-toast,[data-needle-prototype-ui]');
  }

  function textOf(node) {
    const text = typeof node.innerText === 'string' ? node.innerText : node.textContent || '';
    return text.replace(/\s+/g, ' ').trim();
  }

  function safe(node) {
    if (!(node instanceof HTMLElement) || !node.isConnected || own(node)) return false;
    if (node.matches('html,body,main,nav,header,footer,h1,form,input,textarea,select,button') || node.isContentEditable) return false;
    if (node.closest('nav,[contenteditable]:not([contenteditable="false"])') || node.querySelector('main,h1,form,input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[data-needle-prototype-ui]')) return false;
    if (textOf(node).length > 1800 || node.querySelectorAll('*').length > 120) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8 || rect.height > 1400) return false;
    if (rect.width > innerWidth * 0.85 && rect.height > innerHeight * 0.85 && !node.matches('iframe,ins')) return false;
    return getComputedStyle(node).visibility !== 'hidden';
  }

  function hasSignal(node) {
    const tokens = `${node.id} ${node.className} ${node.getAttribute('aria-label') || ''}`;
    return node.matches('[data-ad],[data-ad-slot],[data-ad-client],[data-ad-unit],[data-sponsored]') || AD_TOKEN.test(tokens);
  }

  function adLabels(node) {
    const labels = [node, ...node.querySelectorAll('span,small,p,div,a,label')].filter((item) =>
      item.childElementCount <= 2 && textOf(item).length < 90 && AD_LABEL.test(textOf(item)));
    // A nested span and its parent describe the same label; count only the leaf.
    return labels.filter((item) => !labels.some((other) => other !== item && item.contains(other)));
  }

  function adNetwork(node) {
    return [node, ...node.querySelectorAll('a[href],iframe[src]')].some((item) =>
      NETWORK.test(host(item.getAttribute('href') || item.getAttribute('src') || '')));
  }

  function cardFor(node, label = false) {
    // The candidate may already be the complete card; never widen it into a sidebar.
    if (hasSignal(node) && node.querySelector('img,iframe,video,h2,h3,h4,strong')) return node;
    let choice = node;
    let cursor = node.parentElement;
    for (let depth = 0; cursor && depth < 4; depth++, cursor = cursor.parentElement) {
      if (!safe(cursor)) break;
      const cards = cursor.querySelectorAll('article,[data-ad],[data-ad-slot],[data-sponsored]');
      if (cards.length > 1 || cursor.querySelectorAll('li').length > 1 || cursor.querySelectorAll('h2,h3,h4').length > 2 || adLabels(cursor).length > 1) break;
      const isCard = cursor.matches('article,aside,figure') || /(?:^|[\s_-])(?:card|teaser|tile|promo)(?:$|[\s_-])/i.test(cursor.className) || hasSignal(cursor);
      const hasCreative = cursor.querySelector('img,iframe,video,h2,h3,h4');
      if (isCard || (label && hasCreative && cursor.querySelector('a[href],iframe,ins'))) choice = cursor;
      // A recognized card is the useful removal boundary; don't climb into the feed.
      if (isCard && hasCreative) break;
    }
    return choice;
  }

  function describe(node) {
    const rect = node.getBoundingClientRect();
    const links = [...node.querySelectorAll('a[href]')];
    if (node.matches('a[href]')) links.unshift(node);
    const frames = node.matches('iframe') ? [node] : [...node.querySelectorAll('iframe')];
    const linkHosts = [...new Set(links.map((link) => host(link.href)).filter(Boolean))].slice(0, 6);
    const frameHost = frames.map((frame) => host(frame.src)).filter(Boolean).join(', ').slice(0, 200);
    const labels = adLabels(node).map(textOf);
    const sizes = [[300, 250], [336, 280], [728, 90], [970, 90], [970, 250], [160, 600], [300, 600], [320, 50]];
    const attributes = {};
    for (const attr of node.attributes) {
      if (/^(?:data-(?:ad|sponsor)|aria-label|role)/i.test(attr.name)) attributes[attr.name] = attr.value.slice(0, 120);
    }
    return {
      id: `needle-${++sequence}`, tag: node.tagName.toLowerCase(), elementId: node.id.slice(0, 150),
      classes: [...node.classList].filter((name) => name !== 'needle-prototype-highlight').join(' ').slice(0, 250), label: [...new Set(labels)].slice(0, 3).join(' / '),
      text: textOf(node).slice(0, 1400), linkHosts, frameHost,
      alt: [...node.querySelectorAll('img[alt]')].slice(0, 3).map((img) => img.alt).join(' / ').slice(0, 250),
      attributes, shape: { width: Math.round(rect.width), height: Math.round(rect.height) },
      standardSize: sizes.some(([w, h]) => Math.abs(rect.width - w) < 12 && Math.abs(rect.height - h) < 12),
      adNetwork: [...linkHosts, ...frames.map((frame) => host(frame.src))].some((name) => NETWORK.test(name)),
    };
  }

  function signatureFor(node, candidate) {
    // Full targets stay in memory only: same-host href/src changes also invalidate a verdict.
    const targets = [node, ...node.querySelectorAll('[href],[src]')].map((item) =>
      [item.getAttribute('href'), item.getAttribute('src')]);
    return JSON.stringify({ ...candidate, id: undefined, targets });
  }

  function scan() {
    clearTimeout(scanTimer);
    if (!settings.enabled || !document.body) return;
    // SPA feeds recycle nodes. Revoke the old verdict before looking for new candidates,
    // including nodes which have lost every ad signal and will no longer be found below.
    for (const node of highlights) {
      if (!safe(node) || !node.classList.contains('needle-prototype-highlight') || signatureFor(node, describe(node)) !== seen.get(node)) {
        node.classList.remove('needle-prototype-highlight');
        highlights.delete(node);
        seen.delete(node);
      }
    }
    const found = new Set();
    for (const node of [...document.querySelectorAll(SELECTOR)].slice(0, 1800)) {
      if (!safe(node)) continue;
      const candidate = cardFor(node);
      // An opaque media frame has too little context for a reliable semantic verdict.
      if (hasSignal(node) || hasSignal(candidate) || adNetwork(candidate) || adLabels(candidate).length) found.add(candidate);
    }
    for (const node of [...document.querySelectorAll('span,small,p,div,a')].slice(0, 3500)) {
      if (node.childElementCount <= 2 && textOf(node).length < 90 && AD_LABEL.test(textOf(node))) {
        const candidate = cardFor(node, true);
        if (safe(candidate)) found.add(candidate);
      }
    }
    for (const link of [...document.querySelectorAll('a[href]')].slice(0, 1500)) {
      if (NETWORK.test(host(link.href)) && safe(link)) found.add(cardFor(link, true));
    }
    // Keep only outer candidate cards; one classification should produce one action.
    const candidates = [...found].filter((node) => safe(node) && adLabels(node).length <= 1 && ![...found].some((other) => other !== node && adLabels(other).length <= 1 && other.contains(node)));
    for (const node of highlights) {
      if (!candidates.includes(node)) {
        node.classList.remove('needle-prototype-highlight');
        highlights.delete(node);
        seen.delete(node);
      }
    }
    for (const node of candidates) {
      if (queue.length >= 120 || highlights.has(node) || animations.has(node)) continue;
      const candidate = describe(node);
      const signature = signatureFor(node, candidate);
      if (seen.get(node) === signature) continue;
      seen.set(node, signature);
      queue.push({ node, candidate, epoch, signature });
      stats.candidates++;
      stats.pending++;
    }
    publish();
    drain();
  }

  function schedule() {
    clearTimeout(scanTimer);
    if (settings.enabled) scanTimer = setTimeout(scan, 600);
  }

  function notify() {
    if (!settings.toast) return;
    let toast = document.getElementById('needle-prototype-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'needle-prototype-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      const message = document.createElement('span');
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.textContent = 'Restore';
      undo.addEventListener('click', () => restore());
      toast.append(message, undo);
      document.documentElement.append(toast);
    }
    toast.firstElementChild.textContent = `Needle · ${stats.removed} removed`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.remove(), 4500);
  }

  function remove(node, result, capturedEpoch) {
    // Keep every removal reversible for this page session. Stop when the cap is full.
    if (retained.size + animations.size >= MAX_RETAINED) {
      stats.lastError = 'Restore limit reached (100). Restore items before removing more.';
      return;
    }
    const style = node.getAttribute('style');
    const previousClass = node.getAttribute('class');
    let timer;
    const restoreAppearance = () => {
      style === null ? node.removeAttribute('style') : node.setAttribute('style', style);
      previousClass === null ? node.removeAttribute('class') : node.setAttribute('class', previousClass);
    };
    const cancel = () => { clearTimeout(timer); animations.delete(node); restoreAppearance(); };
    const finish = () => {
      clearTimeout(timer);
      animations.delete(node);
      restoreAppearance();
      if (epoch !== capturedEpoch || !settings.enabled || !node.isConnected) return;
      const placeholder = document.createComment(`needle restore: ${result.id}`);
      node.replaceWith(placeholder);
      retained.set(placeholder, node);
      stats.removed++;
      notify();
      publish();
    };
    animations.set(node, cancel);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!settings.animation || document.hidden || reducedMotion) { finish(); return; }
    node.style.setProperty('--needle-height', `${node.getBoundingClientRect().height}px`);
    node.classList.add('needle-prototype-removing');
    timer = setTimeout(finish, 540);
  }

  async function drain() {
    if (busy || !settings.enabled || !queue.length) return;
    busy = true;
    const batch = queue.splice(0, 12);
    const capturedEpoch = epoch;
    const response = await send({
      type: 'needle:judge', candidates: batch.map((entry) => entry.candidate),
      page: { hostname: location.hostname, title: document.title.slice(0, 200) },
    });
    busy = false;
    if (capturedEpoch !== epoch) { drain(); return; }
    stats.pending = Math.max(0, stats.pending - batch.length);
    stats.elapsedMs += Number(response?.elapsedMs) || 0;
    const results = new Map((Array.isArray(response?.results) ? response.results : []).map((result) => [result.id, result]));
    stats.lastError = response?.error || null;
    for (const entry of batch) {
      const result = results.get(entry.candidate.id);
      stats.judged++;
      if (!result || result.error || response?.error) {
        const error = result?.error || response?.error || 'No model verdict returned';
        stats.lastError = error;
        remember({ id: entry.candidate.id, text: entry.candidate.text.slice(0, 80), label: 'uncertain', confidence: null, action: 'kept', error });
        continue;
      }
      const confidence = typeof result.confidence === 'number' && Number.isFinite(result.confidence) ? result.confidence : null;
      const isAd = result.label === 'ad' && confidence !== null && confidence >= settings.threshold && confidence <= 1;
      let action = 'kept';
      const unchanged = safe(entry.node) && signatureFor(entry.node, describe(entry.node)) === entry.signature;
      if (isAd && unchanged && !animations.has(entry.node)) {
        if (settings.mode === 'highlight') {
          entry.node.classList.add('needle-prototype-highlight');
          highlights.add(entry.node);
          action = 'highlighted';
        } else {
          remove(entry.node, result, capturedEpoch);
          action = animations.has(entry.node) || !entry.node.isConnected ? 'removed' : 'kept';
        }
      }
      remember({ id: result.id, text: (entry.candidate.label || entry.candidate.text || entry.candidate.frameHost).slice(0, 80), label: result.label, category: result.category, confidence, action });
    }
    publish();
    drain();
  }

  function restore({ resetSeen = false } = {}) {
    epoch++;
    queue = [];
    stats.pending = 0;
    clearTimeout(scanTimer);
    for (const cancel of animations.values()) cancel();
    for (const node of highlights) node.classList.remove('needle-prototype-highlight');
    highlights.clear();
    for (const [placeholder, node] of retained) {
      if (placeholder.isConnected) placeholder.replaceWith(node);
    }
    retained.clear();
    stats.removed = 0;
    document.getElementById('needle-prototype-toast')?.remove();
    if (resetSeen) seen = new WeakMap();
    publish();
    return getState();
  }

  function configure(next = {}) {
    const previous = settings;
    settings = { ...settings, ...next };
    settings.enabled = settings.enabled !== false;
    const threshold = Number(settings.threshold);
    settings.threshold = Number.isFinite(threshold) ? Math.max(0, Math.min(1, threshold)) : DEFAULTS.threshold;
    settings.mode = settings.mode === 'highlight' ? 'highlight' : 'remove';
    if (!settings.enabled || previous.mode !== settings.mode || previous.threshold !== settings.threshold) restore({ resetSeen: true });
    if (!previous.enabled && settings.enabled) seen = new WeakMap();
    if (!settings.toast) document.getElementById('needle-prototype-toast')?.remove();
    publish();
    if (settings.enabled) schedule();
    return getState();
  }

  function rescan() {
    epoch++;
    queue = [];
    stats.pending = 0;
    seen = new WeakMap();
    scan();
    return getState();
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'needle:configure') respond(configure(message.settings));
    else if (message.type === 'needle:rescan') respond(rescan());
    else if (message.type === 'needle:restore') respond(restore());
    else if (message.type === 'needle:state') respond(getState());
  });
  window.NeedlePrototypeContent = { configure, rescan, restore, getState };
  new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      if (own(mutation.target) || animations.has(mutation.target)) return false;
      if (mutation.type === 'characterData') return true;
      if (mutation.type === 'attributes') return true;
      return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => !own(node) && (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE));
    });
    if (relevant) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'id', 'src', 'href', 'alt', 'aria-label', 'contenteditable', 'data-ad', 'data-ad-slot', 'data-ad-client', 'data-ad-unit', 'data-sponsored'], characterData: true });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  send({ type: 'needle:settings' }).then((response) => configure(response?.settings || DEFAULTS));
})();
