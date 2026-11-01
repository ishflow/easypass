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

// --- Monthly work on the tracked sites (spec §7) ---
const ATTEMPT_TTL = 2 * 60 * 1000;
const P = { login: '/account/login', select: '/account/selectorganization', logout: '/account/logout' };
// The .test and .localhost hosts are the look-alike site of extension/test (manifest matches them too); neither exists on the internet.
const TRACKED = { 'cabinet.salyk.kg': P, 'salykkabinet.test': P, 'salykkabinet.localhost': P };
// The one customer being worked on (the site's cookie is one per browser): { entryId, month, at, state, site, selected?, readName?, auto? }.
// It survives closing Chrome, so the question still comes. No login, name or password in it.
const session = async () => (await chrome.storage.local.get('salyk')).salyk;
const keep = (s) => chrome.storage.local.set({ salyk: s }).then(report);
const drop = () => chrome.storage.local.remove('salyk').then(report);
// Spec §14.7: the program learns who is open. Never waited for, and a refusal (locked) is only told again at the next change.
let reporting = Promise.resolve();
function report() {
  reporting = reporting.then(async () => {
    const { salyk: s, salykSent: sent } = await chrome.storage.local.get(['salyk', 'salykSent']);
    const entryId = s?.state === 'open' ? s.entryId : null;
    if ((sent?.entryId ?? null) === entryId) return;
    const site = entryId ? s.site ?? 'cabinet.salyk.kg' : sent.site; // no site: a session stored before v1.6, when only this one was tracked
    const r = await ask({ cmd: 'session_state', site, entryId });
    if (r.ok) await chrome.storage.local.set({ salykSent: { entryId, site } });
  }).catch(() => {});
}
const monthOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
// Older than last month: the host would refuse the save, so asking would only waste the user's clicks.
const stale = (s) => {
  const now = new Date();
  return s.month < monthOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
};
const pageOf = (url) => {
  const paths = TRACKED[url.hostname];
  const path = url.pathname.toLowerCase().replace(/\/+$/, '');
  return !paths ? null : path === paths.login ? 'login' : path === paths.select ? 'select' : 'other';
};
// One at a time, in arrival order: a logout click's message must be applied before the next page's question is answered.
let turn = Promise.resolve();
const inTurn = (fn) => (turn = turn.then(fn, fn));

// A question not answered yet (open or closed) stays: the next customer must not wipe the previous one's.
const track = (entryId, state, site, auto) => inTurn(async () => {
  const s = await session();
  if (!s || s.state === 'attempt' || stale(s)) await keep({ entryId, month: monthOf(new Date()), at: Date.now(), state, site, ...(auto && { auto }) });
});

// --- Sign-in from the program's button (spec §14) ---
const SWITCH_TTL = 30 * 60 * 1000;
let logoutWait = 15_000; // ms a logout may take before the switch gives up (tests shorten it)
// The customer to sign in once the open one has left: { entryId, tab, at }. In storage, because the worker may stop meanwhile. No password.
const clearSwitch = () => chrome.storage.local.remove('salykSwitch');
const pendingSwitch = async () => {
  const { salykSwitch: w } = await chrome.storage.local.get('salykSwitch');
  if (w && Date.now() - w.at <= SWITCH_TTL) return w;
  if (w) await clearSwitch();
  return null;
};
const leaving = new Set(); // tabs closed here (ids are never reused): the page's salyk_page, still queued, has no say about the session
const closeTab = (tab) => {
  leaving.add(tab);
  return chrome.tabs.remove(tab);
};
const fillIn = (tab, entryId) => chrome.tabs.sendMessage(tab, { fill: entryId }).catch(() => {});
const toFront = async ({ id, windowId }) => {
  await chrome.tabs.update(id, { active: true });
  await chrome.windows.update(windowId, { focused: true }).catch(() => {});
};
// salyk.js clicks the site's logout; with no link there (or no script in the tab) the tab goes to the logout address. Either way the session
// stays open until the login page shows up, as after any logout that salykPage notices.
const logOut = (tab, url) => chrome.tabs.sendMessage(tab, { logout: logoutWait }).catch(() => {}).then((clicked) => {
  if (!clicked) return chrome.tabs.update(tab, { url: url.origin + P.logout });
});
// After the exit panel (Save, Close, the no-tasks hint): this tab goes on to the waiting customer.
const resume = async (tab, url) => {
  const w = await pendingSwitch();
  if (!w || await session()) return;
  await clearSwitch(); // before the form goes out: never a second submit
  if (pageOf(url) === 'login') return fillIn(tab, w.entryId);
  // Not the login page: the user is on a page of the site, maybe in another account. It stays; the button can be pressed again.
};

const loginStart = (tab, url) => inTurn(async () => {
  const site = url.hostname;
  const { entryId } = await ask({ cmd: 'login_take', site });
  if (!entryId) return null;
  if (!TRACKED[site]) return { fill: entryId };
  await clearSwitch(); // the latest press wins
  const s = await session();
  if (!s || s.state === 'attempt' || stale(s)) return { fill: entryId };
  const open = s.state === 'open';
  const here = pageOf(url) === 'other';
  const inside = open && (await chrome.tabs.query({ url: `*://${site}/*` })).find((t) => t.id !== tab && pageOf(new URL(t.url)) === 'other');
  // Spec §14.1: the program asks before someone is closed, and it asks only about who it was told is open. Not told (it was locked): no logout; this
  // press tells it, and the next press gets the question.
  if (open && s.entryId !== entryId && (await chrome.storage.local.get('salykSent')).salykSent?.entryId !== s.entryId) {
    report();
    if (inside) {
      await toFront(inside);
      await closeTab(tab);
    }
    return null;
  }
  if (open && s.entryId === entryId && (inside || here)) {
    if (inside) {
      await toFront(inside);
      await closeTab(tab);
    }
    return null;
  }
  await chrome.storage.local.set({ salykSwitch: { entryId, tab: inside ? inside.id : tab, at: Date.now() } });
  if (inside) {
    await toFront(inside);
    await closeTab(tab);
    logOut(inside.id, url);
  } else if (open && here) logOut(tab, url);
  // otherwise this tab's own salyk_page asks about the old customer: a closed session, or an open one seen from the login page
  return null;
});

const salykPage = (url, tab) => inTurn(async () => {
  if (leaving.has(tab)) return null;
  let s = await session();
  if (s && (stale(s) || (s.state === 'attempt' && Date.now() - s.at > ATTEMPT_TTL))) {
    await drop();
    s = null;
  }
  if (!s) {
    const w = await pendingSwitch();
    if (!w || w.tab !== tab) return null;
    await clearSwitch();
    if (pageOf(url) !== 'login') return { failed: true }; // the logout ended somewhere else than the login page: no second round
    fillIn(tab, w.entryId);
    return null;
  }
  const page = pageOf(url);
  if (s.state === 'attempt') {
    if (page === 'login') { // wrong password, or back from the organization page
      if (s.selected || s.auto) { // auto: the password was refused, the automatic sign-in is over
        const { selected, auto, ...rest } = s;
        await keep(rest);
      }
      return null;
    }
    if (page === 'other') {
      if (s.selected) await keep({ ...s, state: 'open' }); // "Войти" was pressed; without the organization page it is a public page
      return null;
    }
    const { auto, ...seen } = { ...s, selected: true }; // auto goes now: "Войти" is pressed for one look at this page, whatever comes of it
    await keep(seen);
    const w = await ask({ cmd: 'work_get', site: url.hostname, entryId: s.entryId, month: s.month });
    if (!w.ok || w.username !== url.searchParams.get('userName')) return null;
    if (w.name) return auto ? { press: true, username: w.username } : null;
    await keep({ ...seen, readName: true });
    return { readName: true, press: auto, username: w.username };
  }
  if (s.state === 'open') {
    if (page !== 'login') return (await pendingSwitch())?.tab === tab ? { exitWait: logoutWait } : null;
    await keep({ ...s, state: 'closed' }); // the site's session timed out, or the user came back
  }
  const panel = await ask({ cmd: 'work_get', site: url.hostname, entryId: s.entryId, month: s.month });
  if (panel.error !== 'not_found') return { panel: { ...panel, entryId: s.entryId } };
  await drop(); // the customer was deleted meanwhile
  return null;
});

const salyk = {
  salyk_page: (msg, url, tab) => salykPage(url, tab),
  // No login page in time after the logout: the tab is still signed in, so the switch ends here instead of trying again.
  salyk_exit_late: (msg, url, tab) => inTurn(async () => {
    if ((await session())?.state !== 'open' || (await pendingSwitch())?.tab !== tab) return null;
    await clearSwitch();
    return { failed: true };
  }),
  salyk_logout: () => inTurn(async () => {
    const s = await session();
    if (s?.state === 'open') await keep({ ...s, state: 'closed' });
    return { ok: true };
  }),
  salyk_name: (msg) => inTurn(async () => {
    const s = await session();
    if (!s?.readName) return { ok: false, error: 'bad_request' };
    const { readName, ...rest } = s;
    await keep(rest); // one look per visit
    return ask({ cmd: 'set_name', site: msg.site, entryId: s.entryId, text: msg.text });
  }),
  work_save: (msg, url, tab) => inTurn(async () => {
    const s = await session();
    if (s?.entryId !== msg.entryId) { // a panel left open for an earlier customer
      await resume(tab, url);
      return { ok: false, error: 'not_found' };
    }
    if (stale(s)) {
      await drop();
      await resume(tab, url);
      return { ok: true };
    }
    const r = await ask({ cmd: 'work_save', site: msg.site, entryId: s.entryId, month: s.month, statuses: msg.statuses, reminders: msg.reminders });
    if (r.ok) {
      await drop();
      await resume(tab, url);
    }
    return r;
  }),
  // the same session guard as work_save; the session itself stays (the panel goes on with the new list)
  work_assign: (msg) => inTurn(async () => {
    const s = await session();
    if (s?.entryId !== msg.entryId) return { ok: false, error: 'not_found' };
    return ask({ cmd: 'work_assign', site: msg.site, entryId: s.entryId, taskIds: msg.taskIds });
  }),
  work_close: (msg, url, tab) => inTurn(async () => {
    if ((await session())?.entryId === msg.entryId) await drop();
    await resume(tab, url);
    return { ok: true };
  }),
};

async function submitted({ username, password, change, site, fields = [], firstName = '', lastName = '', auto }, tab, url) {
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
  const onLogin = pageOf(url) === 'login';
  if (onLogin && r.ok && r.entryId) await track(r.entryId, 'attempt', site, auto); // above the next line: "same" is the usual case. "ambiguous" has no entry
  if (!r.ok || (r.result !== 'changed' && r.result !== 'new')) return null;
  state.pending = {
    result: r.result, entryId: r.entryId ?? req.entryId, name: r.name,
    username: req.username, password, site, at: Date.now(),
    ...(r.result === 'new' && { fields, firstName, lastName, track: onLogin }),
  };
  await store(tab, state);
  return shown(state.pending);
}

// The toolbar popup edits this month's work (and the task list) of a tracked-site customer without a session: the entry's site comes from the
// popup (an extension page, trusted like `all`/`entry`) but must be tracked. The salyk session is neither read nor changed.
const popupWork = (msg) => {
  if (!Object.hasOwn(TRACKED, msg.site) || typeof msg.entryId !== 'string') return { ok: false, error: 'bad_request' };
  const { site, entryId } = msg;
  return ask(msg.cmd === 'work_get' ? { cmd: 'work_get', site, entryId }
    : msg.cmd === 'work_assign' ? { cmd: 'work_assign', site, entryId, taskIds: msg.taskIds }
    : { cmd: 'work_save', site, entryId, month: monthOf(new Date()), statuses: msg.statuses, reminders: msg.reminders });
};

async function handle(msg, tab, url, frame) {
  if (url.origin === POPUP_ORIGIN && ['work_get', 'work_save', 'work_assign'].includes(msg.cmd)) return popupWork(msg);
  const site = url.hostname;
  msg = { ...msg, site }; // the sender's real host, never what the page-side script claims
  if (Object.hasOwn(salyk, msg.cmd)) {
    if (!TRACKED[site]) return { ok: false, error: 'bad_request' };
    await checking.get(tab); // the login just submitted is known before the page after it is judged
    return salyk[msg.cmd](msg, url, tab);
  }
  switch (msg.cmd) {
    case 'search':
    case 'get': {
      // No filling into plain-http pages: anyone on the network path could inject a script and read the password.
      if (url.protocol !== 'https:' && !isLocal(site)) return { ok: false, error: 'insecure' };
      const r = await ask(msg);
      if (msg.cmd === 'get' && r.ok) await store(tab, { ...(await load(tab)), lastFilled: { entryId: msg.entryId, username: r.username, site } });
      return r;
    }
    case 'login_start': // only content.js, in a tab's top frame, on the page that carried the marker; a page's own script cannot send messages here
      if (frame !== 0 || !tab) return { ok: false, error: 'bad_request' };
      if (url.protocol !== 'https:' && !isLocal(site)) return { ok: false, error: 'insecure' };
      return loginStart(tab, url);
    case 'submitted': {
      const p = submitted(msg, tab, url);
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
        if (msg.cmd === 'add' && p.track) {
          await track(r.entryId, pageOf(url) === 'other' ? 'open' : 'attempt', p.site); // saved after "Войти" was pressed: already inside
          if (pageOf(url) === 'select') { // this page's salyk_page came before the entry existed
            const seen = await salykPage(url, tab);
            if (seen?.readName) chrome.tabs.sendMessage(tab, seen).catch(() => {}); // no name is fine: spec §8
          }
        }
      }
      return r;
    }
    case 'all':
    case 'entry':
    case 'summary':
      if (url.origin !== POPUP_ORIGIN) return { ok: false, error: 'bad_request' }; // a page asking for other sites' logins
      return ask(msg);
    case 'lang': // asked again each time, so a language switch in the app shows on the next page
      return (await ask({ cmd: 'status' })).lang || 'ru';
    case 'status':
      return ask(msg);
    default: // work_get, set_name, login_take and session_state stay inside the background: a page's script side names no entry itself
      return { ok: false, error: 'bad_request' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender.tab?.id, new URL(sender.url), sender.frameId).then(reply, () => reply({ ok: false, error: 'no_host' }));
  return true;
});

chrome.tabs.onRemoved.addListener((tab) => {
  checking.delete(tab);
  chrome.storage.session.remove(keyOf(tab));
  pendingSwitch().then((w) => w?.tab === tab && clearSwitch());
});
