// One native port, request id → resolver. Every reply is an object; failures come back as {ok:false,error}.
const HOST = 'com.easypass.host';
const PENDING_TTL = 2 * 60 * 1000;
let port = null;
let seq = 0;
const waiting = new Map();
const checking = new Map(); // tabId → in-flight check, so a freshly loaded page waits for it

function ask(msg) {
  if (!port) {
    port = chrome.runtime.connectNative(HOST);
    port.onMessage.addListener((r) => {
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
// shortcut: "same domain" = same last two labels, no public-suffix list (so a.github.io ~ b.github.io); it only lets a
// prompt follow a login redirect in the same tab within PENDING_TTL. Use a PSL if that ever shows a wrong prompt.
const domain = (host) => host.split('.').slice(-2).join('.');
// The page-side script gets only what the prompt shows: the login and, for a new one, the form as the user filled it
// in on this very site (the prompt lists it, secret values masked until asked).
const shown = (p) => p && { result: p.result, name: p.name, username: p.username, firstName: p.firstName, lastName: p.lastName, fields: p.fields };
// The toolbar popup: the extension's own page, never a web page. Only it may list and open every site's entries.
const POPUP_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
// Chrome resolves *.localhost to this machine itself (never DNS), so plain http there is as safe as on localhost.
const isLocal = (host) => LOCAL.has(host) || host.endsWith('.localhost');

async function submitted({ username, password, change, site, fields = [], firstName = '', lastName = '' }, tab) {
  const state = await load(tab);
  let filled = state.lastFilled?.site === site ? state.lastFilled : null;
  const same = filled?.username.toLowerCase() === username.toLowerCase();
  if (filled && username && !same) {
    // Another login typed by hand: the filled entry is stale and must not take this or a later password change.
    delete state.lastFilled;
    filled = null;
    await store(tab, state);
  }
  const req = { cmd: 'check', site, username, password };
  // Password-change form without a username field (or the same login we filled) → compare with the filled entry.
  if (filled && (change || same)) Object.assign(req, { username: filled.username, entryId: filled.entryId });
  if (!req.username || !password) return null;
  const r = await ask(req);
  if (!r.ok || (r.result !== 'changed' && r.result !== 'new')) return null;
  state.pending = {
    result: r.result, entryId: r.entryId ?? req.entryId, name: r.name,
    username: req.username, password, site, at: Date.now(),
    ...(r.result === 'new' && { fields, firstName, lastName }),
  };
  await store(tab, state);
  return shown(state.pending);
}

async function handle(msg, tab, url) {
  const site = url.hostname;
  msg = { ...msg, site }; // the sender's real host, never what the page-side script claims
  switch (msg.cmd) {
    case 'search':
    case 'get': {
      // No filling into plain-http pages: anyone on the network path could inject a script and read the password.
      if (url.protocol !== 'https:' && !isLocal(site)) return { ok: false, error: 'insecure' };
      const r = await ask(msg);
      if (msg.cmd === 'get' && r.ok) await store(tab, { ...(await load(tab)), lastFilled: { entryId: msg.entryId, username: r.username, site } });
      return r;
    }
    case 'submitted': {
      const p = submitted(msg, tab);
      checking.set(tab, p);
      return p;
    }
    case 'pending': {
      await checking.get(tab);
      const { pending: p } = await load(tab);
      // login.x.com often redirects to app.x.com: the question follows within the same domain
      return p && domain(p.site) === domain(site) && Date.now() - p.at < PENDING_TTL ? shown(p) : null;
    }
    case 'dismiss':
    case 'update':
    case 'add': {
      const { pending: p } = await load(tab);
      if (!p) return msg.cmd === 'dismiss' ? { ok: true } : { ok: false, error: 'not_found' };
      // site, login and password come from the captured submit, never from the page-side script
      const r = msg.cmd === 'dismiss' ? { ok: true }
        : await ask(msg.cmd === 'update'
          ? { cmd: 'update', site: p.site, entryId: p.entryId, password: p.password }
          : {
            cmd: 'add', site: p.site, firstName: msg.firstName, lastName: msg.lastName, username: p.username, password: p.password,
            // the login has its own fields in the vault: saving it here too would leave a stale copy after a password change
            fields: (p.fields || []).filter((f) => !f.role).map(({ label, value, secret }) => ({ label, value, secret })),
          });
      if (r.ok) {
        const state = await load(tab);
        delete state.pending;
        await store(tab, state);
      }
      return r;
    }
    case 'all':
    case 'entry':
      if (url.origin !== POPUP_ORIGIN) return { ok: false, error: 'bad_request' }; // a page asking for other sites' logins
      return ask(msg);
    case 'lang': // asked again each time, so a language switch in the app shows on the next page
      return (await ask({ cmd: 'status' })).lang || 'ru';
    default: // status
      return ask(msg);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender.tab?.id, new URL(sender.url)).then(reply, () => reply({ ok: false, error: 'no_host' }));
  return true;
});

chrome.tabs.onRemoved.addListener((tab) => {
  checking.delete(tab);
  chrome.storage.session.remove(keyOf(tab));
});
