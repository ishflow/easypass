// One native port, request id → resolver. Every reply is an object; failures come back as {ok:false,error}.
const HOST = 'com.easypass.host';
const PENDING_TTL = 2 * 60 * 1000;
let port = null;
let seq = 0;
let lang = null; // UI language from the app settings, via host status replies
const waiting = new Map();
const checking = new Map(); // tabId → in-flight check, so a freshly loaded page waits for it

function ask(msg) {
  if (!port) {
    port = chrome.runtime.connectNative(HOST);
    port.onMessage.addListener((r) => {
      if (r.lang) lang = r.lang;
      waiting.get(r.id)?.(r);
      waiting.delete(r.id);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // e.g. "host not found"; reported as no_host below
      port = null;
      for (const done of waiting.values()) done({ ok: false, error: 'no_host' });
      waiting.clear();
    });
  }
  const id = ++seq;
  return new Promise((done) => {
    waiting.set(id, done);
    port.postMessage({ ...msg, id });
  });
}

const keyOf = (tab) => 'tab' + tab;
const load = async (tab) => (await chrome.storage.session.get(keyOf(tab)))[keyOf(tab)] || {};
const store = (tab, state) => chrome.storage.session.set({ [keyOf(tab)]: state });

async function submitted({ username, password, change, site }, tab) {
  const state = await load(tab);
  const filled = state.lastFilled?.site === site ? state.lastFilled : null;
  const req = { cmd: 'check', site, username, password };
  // Password-change form (or same login as the one we filled) → compare with the filled entry.
  if (filled && (change || filled.username.toLowerCase() === username.toLowerCase())) {
    Object.assign(req, { username: filled.username, entryId: filled.entryId });
  }
  if (!req.username || !password) return null;
  const r = await ask(req);
  if (!r.ok || (r.result !== 'changed' && r.result !== 'new')) return null;
  state.pending = {
    result: r.result, entryId: r.entryId ?? req.entryId, name: r.name,
    username: req.username, password, site, at: Date.now(),
  };
  await store(tab, state);
  return state.pending;
}

async function handle(msg, tab, site) {
  msg = { ...msg, site }; // the sender's real host, never what the page-side script claims
  switch (msg.cmd) {
    case 'get': {
      const r = await ask({ cmd: 'get', site, entryId: msg.entryId });
      if (r.ok) await store(tab, { ...(await load(tab)), lastFilled: { entryId: msg.entryId, username: r.username, site } });
      return r;
    }
    case 'submitted': {
      const p = submitted(msg, tab);
      checking.set(tab, p);
      return p;
    }
    case 'pending': {
      await checking.get(tab);
      const { pending } = await load(tab);
      return pending && pending.site === site && Date.now() - pending.at < PENDING_TTL ? pending : null;
    }
    case 'dismiss':
    case 'update':
    case 'add': {
      const r = msg.cmd === 'dismiss' ? { ok: true } : await ask(msg);
      if (r.ok) {
        const state = await load(tab);
        delete state.pending;
        await store(tab, state);
      }
      return r;
    }
    case 'lang':
      if (!lang) await ask({ cmd: 'status' });
      return lang || 'ru';
    default: // status, search
      return ask(msg);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender.tab?.id, new URL(sender.url).hostname).then(reply);
  return true;
});

chrome.tabs.onRemoved.addListener((tab) => chrome.storage.session.remove(keyOf(tab)));
