// End-to-end check of the unpacked extension in real Chromium with the fake native host, in Russian and Turkish.
// Usage: cd extension/test && npm install && npm test   (CHROME=/path/to/chromium to override the browser)
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, '..');
const ID = 'coikeomihlacdkjplpedddjmnkfobaon';
const out = path.join(here, 'test-results');
fs.mkdirSync(out, { recursive: true });

// shortcut: Mac-only lookup of the newest Playwright-cached Chromium; set CHROME elsewhere.
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const newest = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
const exe = process.env.CHROME || path.join(cache, newest, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

// Strings the test looks for, per UI language.
const T = {
  ru: {
    connected: 'Подключено · 8 клиентов', noHost: 'Нет связи', insecure: 'Небезопасная страница', none: 'Ничего не найдено', changed: 'Обновить в EasyPass?',
    update: 'Обновить', no: 'Нет', added: 'Сохранить?', first: 'Имя', last: 'Фамилия', save: 'Сохранить', search: 'Поиск клиента', eye: 'Показать пароль', show: 'Показать',
  },
  tr: {
    connected: 'Bağlı · 8 müşteri', noHost: 'Bağlantı yok', insecure: 'Güvensiz sayfa', none: 'Sonuç yok', changed: 'güncellensin mi?',
    update: 'Güncelle', no: 'Hayır', added: 'Kaydedilsin mi?', first: 'Ad', last: 'Soyad', save: 'Kaydet', search: 'Müşteri ara', eye: 'Şifreyi göster', show: 'Göster',
  },
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'easypass-'));
const page0 = fs.readFileSync(path.join(here, 'login.html'), 'utf8');
const variants = {
  // the field is focused while parsing, i.e. before the content script loads (document_idle)
  '/autofocus': (p) => p.replace('</body>', "<script>document.getElementById('user').focus()</script></body>"),
  // sign-up: a second password field (confirm) in the login form
  '/signup': (p) => p.replace('<input id="pass" name="pass" type="password">',
    '<input id="pass" name="pass" type="password"><input id="pass2" name="pass2" type="password">'),
  // the user typed a login before the content script loaded
  '/typed': (p) => p.replace('</body>', "<script>document.getElementById('user').value = 'already.typed'</script></body>"),
  // a long sign-up form in place of the login form: name, contact, ID number, address, a select, consent, login
  '/join-full': (p) => p.replace(/<form id="login"[\s\S]*?<\/form>/, `<form id="join-form" method="post" action="/">
  <label>Ad Soyad <input id="fullname" name="fullname"></label>
  <label>E-posta <input id="email" name="email" type="email"></label>
  <label>Telefon <input id="phone" name="phone" type="tel"></label>
  <label for="tc">TC kimlik no *</label><input id="tc" name="tc">
  <label>Adres <textarea id="addr" name="addr"></textarea></label>
  <label>Şehir <select id="city" name="city"><option value="">Seçiniz</option><option value="ist">İstanbul</option></select></label>
  <label><input type="checkbox" id="kvkk" name="kvkk"> KVKK onayı</label>
  <label>Kullanıcı adı <input id="user" name="user"></label>
  <label>Şifre <input id="pass" name="pass" type="password"></label>
  <label>Şifre (tekrar) <input id="pass2" name="pass2" type="password"></label>
  <button id="join">Üye ol</button>
</form>`),
  // the site draws its own show-password button next to the field
  '/own-eye': (p) => p.replace('<input id="pass" name="pass" type="password">',
    '<input id="pass" name="pass" type="password"><button type="button" class="toggle-password" aria-label="Şifreyi göster">👁</button>'),
};
const serve = (req, res) => req.resume().on('end', () =>
  res.end(Object.entries(variants).find(([p]) => req.url.startsWith(p))?.[1](page0) ?? page0));
// The extension fills only on https, so the sites are served over TLS (throwaway self-signed cert, errors ignored).
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=portal-x.test',
  '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem')], { stdio: 'ignore' });
const tls = { key: fs.readFileSync(path.join(tmp, 'key.pem')), cert: fs.readFileSync(path.join(tmp, 'cert.pem')) };
const server = https.createServer(tls, serve).listen(0, '127.0.0.1');
const plain = http.createServer(serve).listen(0, '127.0.0.1');
await Promise.all([server, plain].map((s) => new Promise((r) => s.once('listening', r))));
// Sites with different host names, all resolved to the local servers by --host-resolver-rules.
const at = (host, s = server) => `${s === server ? 'https' : 'http'}://${host}:${s.address().port}`;
const base = at('portal-x.test');
const baseY = at('portal-y.test');

// Chrome on Mac reads user-level host manifests from <user-data-dir>/NativeMessagingHosts,
// so the fake host manifest lives in the throwaway profile and nothing global is touched.
const log = path.join(tmp, 'host.log');
const external = path.join(tmp, 'external.json');
function profile(name, lang) {
  const dir = path.join(tmp, name);
  if (lang) {
    const wrapper = path.join(tmp, `host-${lang}.sh`);
    fs.writeFileSync(wrapper, `#!/bin/sh\nEP_LANG=${lang} EP_LOG='${log}' EP_EXTERNAL='${external}' exec '${process.execPath}' '${path.join(here, 'fake-host.mjs')}' "$@"\n`, { mode: 0o755 });
    fs.mkdirSync(path.join(dir, 'NativeMessagingHosts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'NativeMessagingHosts/com.easypass.host.json'), JSON.stringify({
      name: 'com.easypass.host', description: 'EasyPass test host', path: wrapper, type: 'stdio',
      allowed_origins: [`chrome-extension://${ID}/`],
    }));
  }
  return chromium.launchPersistentContext(dir, {
    executablePath: exe, headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP *.test 127.0.0.1', '--ignore-certificate-errors'],
  });
}
const hostLog = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout: ' + what);
    await sleep(5);
  }
}

// The panel lives in a closed shadow root, so read it the way assistive tech does: the accessibility tree.
async function ax(page) {
  page.cdp ??= await page.context().newCDPSession(page);
  const { nodes } = await page.cdp.send('Accessibility.getFullAXTree');
  return nodes.filter((n) => !n.ignored).map((n) => ({
    role: n.role?.value, name: n.name?.value || '', node: n.backendDOMNodeId,
    focused: !!n.properties?.find((p) => p.name === 'focused')?.value.value,
    expanded: !!n.properties?.find((p) => p.name === 'expanded')?.value.value,
    pressed: n.properties?.find((p) => p.name === 'pressed')?.value.value === 'true',
    value: n.value?.value,
  }));
}
const options = async (page) => (await ax(page)).filter((n) => n.role === 'option');
const hasText = async (page, s) => (await ax(page)).some((n) => n.name.includes(s));
async function clickNode(page, node) {
  assert.ok(node, 'node to click exists');
  const { model } = await page.cdp.send('DOM.getBoxModel', { backendNodeId: node.node });
  const [x1, y1, , , x3, y3] = model.content;
  await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
}
const button = async (page, name) => (await ax(page)).find((n) => n.role === 'button' && n.name === name);
// Our button named `name` (the key is "EasyPass", the eye t.eye) drawn inside the field's box, or null.
async function iconIn(page, selector, name = 'EasyPass') {
  const f = await page.locator(selector).boundingBox();
  for (const n of (await ax(page)).filter((x) => x.role === 'button' && x.name === name)) {
    const { model } = await page.cdp.send('DOM.getBoxModel', { backendNodeId: n.node });
    const [x1, y1, , , x3, y3] = model.content;
    const x = (x1 + x3) / 2, y = (y1 + y3) / 2;
    if (x > f.x && x < f.x + f.width && y > f.y && y < f.y + f.height) return { x, y, expanded: n.expanded, pressed: n.pressed };
  }
  return null;
}
async function clickIcon(page, selector, name) {
  const { x, y } = await waitFor(() => iconIn(page, selector, name), `${name || 'EasyPass'} icon in ${selector}`);
  await page.mouse.click(x, y);
}
// Opens the panel the way a user does, with a click in the username field (it stays open if it already is),
// and empties that field: the caret stays there, and what the test types next narrows the full list.
async function openPanel(page, selector) {
  await page.click(selector);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  return waitFor(async () => { const o = await options(page); return o.length && o; }, 'panel options');
}
// Every test page is a login page, so after loading one the panel opens by itself; wait for it before typing.
const opened = (page) => waitFor(async () => (await ax(page)).some((n) => n.role === 'combobox'), 'panel opened by itself');
async function goto(page, url) {
  await page.goto(url);
  await opened(page);
}
const active = (page) => page.evaluate(() => document.activeElement.id || document.activeElement.localName);
async function submitAndLoad(page, action) {
  const nav = page.waitForEvent('load');
  await action();
  await nav;
  await opened(page);
}

const results = [];
async function scenario(name, fn) {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name}\n      ${e.message.split('\n').slice(0, 12).join(' ')}`);
  }
}

async function suite(lang) {
  const t = T[lang];
  const shot = (page, name) => page.screenshot({ path: path.join(out, `${lang}-${name}.png`) });
  fs.rmSync(log, { force: true });
  fs.rmSync(external, { force: true });
  results.push(`--- ${lang} ---`);
  const ctx = await profile('main-' + lang, lang);
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    await scenario('extension ID is fixed by manifest key', async () => {
      assert.equal(new URL(sw.url()).host, ID);
    });

    await scenario(`popup shows "${t.connected}"`, async () => {
      const p = await ctx.newPage();
      await p.goto(`chrome-extension://${ID}/popup.html`);
      await waitFor(async () => (await p.textContent('#status')) !== '…', 'popup status');
      assert.equal(await p.textContent('#status'), t.connected);
      await p.close();
    });

    await scenario('popup: every site listed and searchable, 10 rows tall, details show the password only on request', async () => {
      const p = await ctx.newPage();
      await p.goto(`chrome-extension://${ID}/popup.html`);
      const rows = () => p.locator('#list .opt').count();
      await waitFor(async () => (await rows()) === 8, 'all 8 entries of both sites');
      assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('list')).maxHeight), '460px', '10 × 46 px rows');
      assert.equal(await p.evaluate(() => document.activeElement.id), 'q', 'search box focused');
      await p.keyboard.type('ahmet');
      await waitFor(async () => (await rows()) === 4, 'ahmet on both sites');
      await p.fill('#q', 'portal-y');
      await waitFor(async () => (await rows()) === 2, 'the site name is searchable too');
      await p.locator('#list .opt', { hasText: 'Lale Host' }).click();
      await p.waitForSelector('#detail:not([hidden])');
      const text = await p.textContent('#fields');
      assert.ok(text.includes('portal-y.test') && text.includes('lale'), text);
      assert.ok(!text.includes('ll444'), 'password hidden until asked');
      await p.getByRole('button', { name: t.show }).click();
      assert.ok((await p.textContent('#fields')).includes('ll444'), 'password shown');
      await shot(p, '0-popup-detail');
      await p.click('#back');
      await waitFor(async () => (await rows()) === 2, 'back to the same list');
      await p.close();
    });

    await scenario('a web page asking for every site (all / entry) is refused by the background', async () => {
      const replies = await sw.evaluate((u) => Promise.all([
        handle({ cmd: 'all', q: '' }, 1, new URL(u)),
        handle({ cmd: 'entry', entryId: 'e7' }, 1, new URL(u)),
      ]), base + '/login');
      assert.deepEqual(replies, [{ ok: false, error: 'bad_request' }, { ok: false, error: 'bad_request' }]);
    });

    const page = await ctx.newPage();

    await scenario('login page opens the panel by itself at the username field, caret in that field, 5 of 6 entries', async () => {
      const t0 = Date.now();
      await page.goto(base + '/login');
      const opts = await waitFor(async () => { const o = await options(page); return o.length && o; }, 'panel options');
      results.push(`      page load → panel with results: ${Date.now() - t0} ms (incl. CDP polling)`);
      await waitFor(async () => (await active(page)) === 'user', 'caret put in the username field');
      const box = (await ax(page)).find((n) => n.role === 'combobox');
      assert.equal(box?.name, t.search);
      assert.ok(!box.focused, 'the panel does not take the caret');
      assert.equal(opts.length, 5, 'capped at 5');
      assert.ok((await iconIn(page, '#user')).expanded, 'opened at the username key');
      await shot(page, '1-panel-open');
    });

    await scenario('icons: key in username, eye (no key) in password; change form: key + eye, eyes in new fields', async () => {
      assert.equal(await iconIn(page, '#pass'), null, 'no key in the password field');
      await waitFor(() => iconIn(page, '#pass', t.eye), 'eye in #pass');
      assert.equal(await iconIn(page, '#user', t.eye), null, 'no eye in the username field');
      await waitFor(() => iconIn(page, '#cur'), 'key in the change form (no username field there)');
      await waitFor(() => iconIn(page, '#cur', t.eye), 'eye in #cur');
      await waitFor(() => iconIn(page, '#new1', t.eye), 'eye in #new1');
      assert.equal(await iconIn(page, '#new1'), null, 'one key per form');
    });

    await scenario('typing "gül" in the username field finds the 6th entry the list did not show', async () => {
      await page.keyboard.type('gül');
      assert.equal(await page.inputValue('#user'), 'gül', 'the text stays in the page field');
      await waitFor(async () => { const o = await options(page); return o.length === 1 && o[0].name.includes('Gül Tan'); }, 'Gül Tan');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
      await waitFor(async () => (await options(page)).length === 5, 'back to 5');
    });

    await scenario('typing "ahm" filters immediately (one host search per keystroke, no debounce)', async () => {
      const before = hostLog().filter((r) => r.cmd === 'search').length;
      const t0 = Date.now();
      await page.keyboard.type('ahm');
      const opts = await waitFor(async () => { const o = await options(page); return o.length === 3 && o; }, '3 results for ahm');
      results.push(`      3 keystrokes → 3 results shown: ${Date.now() - t0} ms (incl. CDP polling)`);
      assert.equal(hostLog().filter((r) => r.cmd === 'search').length - before, 3);
      assert.ok(opts.some((o) => o.name.includes('Ahmet Yılmaz')));
      assert.ok(!opts.some((o) => o.name.includes('Ayşe')));
      await shot(page, '2-search-ahm');
    });

    await scenario('clicking a result fills both fields (input/change events) and closes panel', async () => {
      const typed = +(await page.getAttribute('#user', 'data-input')); // the search was typed in this field
      await clickNode(page, (await options(page)).find((x) => x.name.includes('Ahmet Yılmaz')));
      await waitFor(async () => (await page.inputValue('#pass')) === 'eski123', 'password filled');
      assert.equal(await page.inputValue('#user'), 'ahmet.yilmaz');
      assert.equal(+(await page.getAttribute('#user', 'data-input')), typed + 1);
      assert.equal(await page.getAttribute('#pass', 'data-change'), '1');
      assert.equal((await options(page)).length, 0, 'panel closed');
      assert.equal(await active(page), 'user', 'focus back on field');
      await shot(page, '3-filled');
    });

    await scenario('Esc closes panel, focus returns to field for typing by hand; a click elsewhere keeps it closed', async () => {
      await openPanel(page, '#user');
      await page.keyboard.press('Escape');
      await waitFor(async () => (await options(page)).length === 0, 'panel closed');
      assert.equal(await active(page), 'user');
      await page.keyboard.type('x');
      assert.equal(await page.inputValue('#user'), 'x', 'typing goes into the page field');
      await page.click('h1');
      await page.click('#pass');
      await sleep(300);
      assert.equal((await options(page)).length, 0, 'still closed (password field click opens nothing)');
    });

    await scenario('mouse click in the username field reopens the panel there; the caret stays in the field', async () => {
      await page.click('#user');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
      await waitFor(async () => (await options(page)).length === 5, 'panel reopened by click');
      assert.equal(await active(page), 'user', 'caret still in the username field');
      assert.ok((await iconIn(page, '#user')).expanded, 'at the username field');
      await page.click('#user'); // a second click while open keeps it open
      await sleep(200);
      assert.ok((await options(page)).length, 'still open');
    });

    await scenario('a login that is not in EasyPass is typed by hand: list says none, Enter submits the form', async () => {
      await page.keyboard.type('yeni.kisi');
      await waitFor(async () => (await hasText(page, t.none)) && !(await options(page)).length, 'no match listed');
      assert.equal(await page.inputValue('#user'), 'yeni.kisi');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('ahmet'); // matches exist, but nothing is selected until ↓
      await waitFor(async () => (await options(page)).length === 3, '3 matches for ahmet');
      await page.click('#pass');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('elle-yazilan');
      await submitAndLoad(page, () => page.keyboard.press('Enter'));
      const sent = hostLog().filter((r) => r.cmd === 'check').at(-1);
      assert.deepEqual([sent.username, sent.password], ['ahmet', 'elle-yazilan'], 'the typed login went out, not a match');
      await waitFor(() => hasText(page, t.added), 'save prompt for the typed login');
      await clickNode(page, await button(page, t.no));
      await waitFor(async () => !(await hasText(page, t.added)), 'prompt closed');
    });

    await scenario('username field of a sign-up form (two passwords): a click opens nothing', async () => {
      const ps = await ctx.newPage();
      await ps.goto(base + '/signup');
      await waitFor(() => iconIn(ps, '#user'), 'key drawn');
      await sleep(300);
      assert.equal((await options(ps)).length, 0, 'no panel by itself');
      await ps.click('#user');
      await sleep(300);
      assert.equal((await options(ps)).length, 0, 'no panel on click');
      assert.equal(await active(ps), 'user', 'typing goes into the field');
      await ps.close();
    });

    await scenario('key toggles: second click closes the panel and returns focus to the field', async () => {
      await openPanel(page, '#user');
      await clickIcon(page, '#user');
      await waitFor(async () => (await options(page)).length === 0, 'panel closed by icon');
      assert.equal(await active(page), 'user');
    });

    await scenario('eye shows the password and hides it again; the caret stays in the field', async () => {
      await page.click('#pass');
      await clickIcon(page, '#pass', t.eye);
      await waitFor(async () => (await page.getAttribute('#pass', 'type')) === 'text', 'password shown');
      assert.ok((await iconIn(page, '#pass', t.eye)).pressed, 'eye pressed');
      assert.equal(await active(page), 'pass', 'focus stayed in the field');
      await shot(page, '2b-password-shown');
      await clickIcon(page, '#pass', t.eye);
      await waitFor(async () => (await page.getAttribute('#pass', 'type')) === 'password', 'password hidden');
      assert.ok(!(await iconIn(page, '#pass', t.eye)).pressed, 'eye released');
    });

    await scenario('site with its own show-password button: no EasyPass eye on that field', async () => {
      const po = await ctx.newPage();
      await goto(po, base + '/own-eye');
      await waitFor(() => iconIn(po, '#user'), 'key in #user');
      await waitFor(() => iconIn(po, '#cur', t.eye), 'eyes drawn elsewhere on the page');
      assert.equal(await iconIn(po, '#pass', t.eye), null, 'no second eye');
      await po.close();
    });

    await scenario('keyboard in the username field: type, ↓ ↓ ↑ ↓, Enter fills the highlighted (2nd) entry', async () => {
      await openPanel(page, '#user');
      await page.keyboard.type('ahmet');
      await waitFor(async () => (await options(page)).length === 3, '3 results for ahmet');
      const second = (await options(page))[1].name;
      for (const k of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowDown']) await page.keyboard.press(k);
      await page.keyboard.press('Enter');
      const want = second.includes('Kaya') ? ['akaya', 'kaya999'] : second.includes('Yılmaz') ? ['ahmet.yilmaz', 'eski123'] : ['mehmet.a', 'mm111'];
      await waitFor(async () => (await page.inputValue('#user')) === want[0] && (await page.inputValue('#pass')) === want[1], 'second item filled');
    });

    await scenario('Turkish folding: "sukru" finds Şükrü Öztürk', async () => {
      await openPanel(page, '#user');
      await page.keyboard.type('sukru');
      await waitFor(async () => { const o = await options(page); return o.length === 1 && o[0].name.includes('Şükrü Öztürk'); }, 'Şükrü');
      await page.keyboard.press('Escape');
    });

    await scenario('site isolation: portal-y shows only its entries; same username fills its own password', async () => {
      const py = await ctx.newPage();
      await goto(py, baseY + '/login');
      const all = await openPanel(py, '#user');
      assert.deepEqual(all.map((o) => o.name).sort(), ['Ahmet Yılmaz ahmet.yilmaz', 'Lale Host lale']);
      assert.ok(await hasText(py, 'portal-y.test'), 'site shown in panel header');
      await shot(py, '3b-site-y');
      await py.keyboard.type('ahm');
      await waitFor(async () => (await options(py)).length === 1, 'one result for ahm on portal-y');
      await py.keyboard.press('ArrowDown'); // typing in the field selects nothing until ↓
      await py.keyboard.press('Enter');
      await waitFor(async () => (await py.inputValue('#pass')) === 'lh-pass', 'portal-y password filled');
      assert.equal(await py.inputValue('#user'), 'ahmet.yilmaz');
      const sites = (cmd) => [...new Set(hostLog().filter((r) => r.cmd === cmd).map((r) => r.site))].sort();
      assert.deepEqual(sites('search'), ['portal-x.test', 'portal-y.test'], 'every search carries the page host');
      assert.deepEqual(sites('get'), ['portal-x.test', 'portal-y.test']);
      await py.close();

      await openPanel(page, '#user');
      await page.keyboard.type('lale');
      await waitFor(async () => (await hasText(page, t.none)) && !(await options(page)).length, 'portal-y customer absent on portal-x');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('yılmaz');
      await waitFor(async () => (await options(page)).length === 1, 'one Ahmet Yılmaz on portal-x');
      await page.keyboard.press('ArrowDown'); // typing in the field selects nothing until ↓
      await page.keyboard.press('Enter');
      await waitFor(async () => (await page.inputValue('#pass')) === 'eski123', 'portal-x password filled');
    });

    await scenario('autofocused login field: the panel still opens by itself', async () => {
      const pa = await ctx.newPage();
      await pa.goto(base + '/autofocus');
      await waitFor(async () => (await options(pa)).length, 'panel on autofocused field');
      await pa.close();
    });

    await scenario('login form already typed into: no panel pops up over it', async () => {
      const pt = await ctx.newPage();
      await pt.goto(base + '/typed');
      await waitFor(() => iconIn(pt, '#user'), 'key drawn');
      await sleep(300);
      assert.equal((await options(pt)).length, 0, 'no panel over a half-filled form');
      await pt.close();
    });

    await scenario('http page: panel says insecure, no search or get reaches the host', async () => {
      const ph = await ctx.newPage();
      const asked = () => hostLog().filter((r) => r.cmd === 'search' || r.cmd === 'get').length;
      const before = asked();
      await ph.goto(at('portal-x.test', plain) + '/login');
      await waitFor(() => hasText(ph, t.insecure), 'insecure message');
      assert.equal((await options(ph)).length, 0);
      assert.equal(asked(), before);
      await ph.close();
    });

    await scenario('http on *.localhost (always this machine) is allowed: the host is asked, no insecure message', async () => {
      const pl = await ctx.newPage();
      const searches = () => hostLog().filter((r) => r.cmd === 'search' && r.site === 'shop.localhost').length;
      await pl.goto(`http://shop.localhost:${plain.address().port}/login`);
      await waitFor(() => hasText(pl, t.none), 'searched (no entries for shop.localhost)');
      assert.ok(!(await hasText(pl, t.insecure)));
      assert.ok(searches() > 0, 'search reached the host');
      await pl.close();
    });

    await scenario('no result cache: entry added by the app appears on the next keystroke while panel is open', async () => {
      await openPanel(page, '#user');
      await page.keyboard.type('ner');
      await waitFor(async () => (await hasText(page, t.none)) && !(await options(page)).length, 'no result for "ner"');
      fs.writeFileSync(external, JSON.stringify([{ id: 'w1', site: 'portal-x.test', firstName: 'Nermin', lastName: 'Koç', extra1: '', extra2: '', username: 'nermin', password: 'nk1', updatedAt: 99 }]));
      await page.keyboard.type('m');
      await waitFor(async () => (await options(page)).some((o) => o.name.includes('Nermin Koç')), 'Nermin appears for "nerm"');
      await shot(page, '4-external-add');
      await page.keyboard.press('Escape');
    });

    await scenario('changed password, submitted while shown by the eye → dots again on submit → update prompt → host', async () => {
      await openPanel(page, '#user');
      await page.keyboard.type('yılmaz');
      await waitFor(async () => (await options(page)).length === 1, 'Yılmaz');
      await page.keyboard.press('ArrowDown'); // typing in the field selects nothing until ↓
      await page.keyboard.press('Enter');
      await waitFor(async () => (await page.inputValue('#pass')) === 'eski123', 'filled');
      await page.click('#pass');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('yeni456');
      await clickIcon(page, '#pass', t.eye);
      await waitFor(async () => (await page.getAttribute('#pass', 'type')) === 'text', 'password shown');
      await page.evaluate(() => document.getElementById('login').addEventListener('submit', () =>
        sessionStorage.setItem('typeAtSubmit', document.getElementById('pass').type)));
      await submitAndLoad(page, () => page.keyboard.press('Enter')); // real form POST → new page
      assert.equal(await page.evaluate(() => sessionStorage.getItem('typeAtSubmit')), 'password', 'field hidden before the form went out');
      await waitFor(() => hasText(page, t.changed), 'update prompt on new page');
      await shot(page, '5-update-prompt');
      await clickNode(page, await button(page, t.update));
      await waitFor(async () => hostLog().some((r) => r.cmd === 'update'), 'update sent');
      const u = hostLog().find((r) => r.cmd === 'update');
      assert.deepEqual([u.entryId, u.password], ['e1', 'yeni456']);
      await waitFor(async () => !(await hasText(page, t.changed)), 'prompt closed');
      await page.reload();
      await opened(page);
      await sleep(300);
      assert.ok(!(await hasText(page, t.changed)), 'pending cleared after answer');
    });

    await scenario('password-change form (3 fields) → prompt for the last filled entry → No dismisses', async () => {
      await openPanel(page, '#user');
      await page.keyboard.type('akaya');
      await waitFor(async () => (await options(page)).length === 1, 'akaya');
      await page.keyboard.press('ArrowDown'); // typing in the field selects nothing until ↓
      await page.keyboard.press('Enter');
      await waitFor(async () => (await page.inputValue('#pass')) === 'kaya999', 'filled');
      await page.click('#cur');
      await page.keyboard.type('kaya999');
      await page.fill('#new1', 'kaya-new');
      await page.fill('#new2', 'kaya-new');
      await submitAndLoad(page, () => page.click('#save'));
      await waitFor(() => hasText(page, t.changed), 'prompt');
      const c = hostLog().filter((r) => r.cmd === 'check').at(-1);
      assert.deepEqual([c.entryId, c.username, c.password], ['e2', 'akaya', 'kaya-new']);
      await clickNode(page, await button(page, t.no));
      await waitFor(async () => !(await hasText(page, t.changed)), 'prompt closed');
    });

    await scenario('unknown login → save prompt with name fields → add; then searchable; re-submit is silent', async () => {
      await page.click('#user');
      await page.keyboard.press('Escape'); // the click opened the panel; Esc to type the login by hand
      await page.keyboard.type('yeni.musteri');
      await page.click('#pass');
      await page.keyboard.type('pw789');
      await submitAndLoad(page, () => page.click('#go'));
      await waitFor(() => hasText(page, t.added), 'save prompt');
      await clickNode(page, (await ax(page)).find((n) => n.role === 'textbox' && n.name === t.first));
      await page.keyboard.type('Zeynep');
      await page.keyboard.press('Tab');
      await page.keyboard.type('Arslan');
      assert.equal(await page.inputValue('#user'), '', 'typing stayed in the prompt');
      await shot(page, '6-save-prompt');
      await clickNode(page, await button(page, t.save));
      await waitFor(async () => hostLog().some((r) => r.cmd === 'add'), 'add sent');
      const a = hostLog().find((r) => r.cmd === 'add');
      assert.deepEqual([a.firstName, a.lastName, a.username, a.password], ['Zeynep', 'Arslan', 'yeni.musteri', 'pw789']);
      await waitFor(async () => !(await hasText(page, t.added)), 'prompt closed');

      await openPanel(page, '#user');
      await page.keyboard.type('zeynep');
      await waitFor(async () => (await options(page)).some((o) => o.name.includes('Zeynep Arslan')), 'new entry searchable');
      await page.keyboard.press('ArrowDown'); // typing in the field selects nothing until ↓
      await page.keyboard.press('Enter');
      await waitFor(async () => (await page.inputValue('#pass')) === 'pw789', 'new entry fills');
      const checks = hostLog().filter((r) => r.cmd === 'check').length;
      await submitAndLoad(page, () => page.click('#go'));
      await waitFor(async () => hostLog().filter((r) => r.cmd === 'check').length > checks, 'second check sent');
      await sleep(500);
      assert.ok(!(await hasText(page, t.added)) && !(await hasText(page, t.changed)), 'no prompt on second submit');
    });

    await scenario('sign-up form → save prompt: names from "Ad Soyad", every filled field under its label, secrets masked → all saved', async () => {
      const ps = await ctx.newPage();
      await ps.goto(base + '/join-full');
      await ps.fill('#fullname', 'Kerem Can Aksoy');
      await ps.fill('#email', 'kerem@example.test');
      await ps.fill('#phone', '0532 111 22 33');
      await ps.fill('#tc', '12345678901');
      await ps.fill('#addr', 'Moda Cad. 5, Kadıköy');
      await ps.selectOption('#city', 'ist');
      await ps.check('#kvkk');
      await ps.fill('#user', 'kerem.aksoy');
      await ps.fill('#pass', 'Gizli-123');
      await ps.fill('#pass2', 'Gizli-123');
      await submitAndLoad(ps, () => ps.click('#join')); // the next page is the plain login page: what follows is the prompt's
      await waitFor(() => hasText(ps, t.added), 'save prompt');
      const nodes = await ax(ps);
      assert.equal(nodes.find((n) => n.role === 'textbox' && n.name === t.first)?.value, 'Kerem Can');
      assert.equal(nodes.find((n) => n.role === 'textbox' && n.name === t.last)?.value, 'Aksoy');
      for (const s of ['Ad Soyad', 'Kerem Can Aksoy', 'E-posta', 'kerem@example.test', 'Telefon', '0532 111 22 33', 'TC kimlik no',
        'Adres', 'Moda Cad. 5, Kadıköy', 'Şehir', 'İstanbul', 'kerem.aksoy']) assert.ok(await hasText(ps, s), 'listed: ' + s);
      assert.ok(!(await hasText(ps, '12345678901')) && !(await hasText(ps, 'Gizli-123')), 'ID number and password masked');
      await clickNode(ps, nodes.find((n) => n.role === 'button' && n.name === `${t.eye}: TC kimlik no`));
      await waitFor(() => hasText(ps, '12345678901'), 'eye shows the ID number');
      await shot(ps, '6b-save-prompt-fields');
      await clickNode(ps, await button(ps, t.save));
      await waitFor(async () => hostLog().some((r) => r.cmd === 'add' && r.username === 'kerem.aksoy'), 'add sent');
      const a = hostLog().find((r) => r.cmd === 'add' && r.username === 'kerem.aksoy');
      assert.deepEqual([a.firstName, a.lastName, a.password], ['Kerem Can', 'Aksoy', 'Gizli-123']);
      assert.deepEqual(a.fields, [ // the login itself (username, both passwords) and the consent box are not among them
        { label: 'Ad Soyad', value: 'Kerem Can Aksoy', secret: false },
        { label: 'E-posta', value: 'kerem@example.test', secret: false },
        { label: 'Telefon', value: '0532 111 22 33', secret: false },
        { label: 'TC kimlik no', value: '12345678901', secret: true },
        { label: 'Adres', value: 'Moda Cad. 5, Kadıköy', secret: false },
        { label: 'Şehir', value: 'İstanbul', secret: false },
      ]);
      await ps.close();
    });

    await scenario('fill one customer, log in by hand as another → change form leaves the filled entry alone', async () => {
      await openPanel(page, '#user');
      await page.keyboard.type('yılmaz');
      await waitFor(async () => (await options(page)).length === 1, 'Yılmaz');
      await page.keyboard.press('ArrowDown'); // typing in the field selects nothing until ↓
      await page.keyboard.press('Enter');
      await waitFor(async () => (await page.inputValue('#user')) === 'ahmet.yilmaz', 'filled');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('akaya');
      await page.click('#pass');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('kaya999');
      const mark = hostLog().length;
      await submitAndLoad(page, () => page.click('#go'));
      await page.fill('#cur', 'kaya999');
      await page.fill('#new1', 'other-new');
      await page.fill('#new2', 'other-new');
      await submitAndLoad(page, () => page.click('#save'));
      await sleep(500);
      assert.ok(!(await hasText(page, t.changed)), 'no update prompt');
      assert.ok(!hostLog().slice(mark).some((r) => r.cmd === 'check' && r.entryId === 'e1'), 'stale filled entry not checked');
    });

    await scenario('login on login.* redirects to app.* of the same domain → save prompt there, add keeps the login host', async () => {
      const p = await ctx.newPage();
      await goto(p, at('login.portal-x.test') + '/login');
      await p.evaluate((a) => { document.getElementById('login').action = a; }, at('app.portal-x.test') + '/home');
      await p.click('#user');
      await p.keyboard.press('Escape');
      await p.keyboard.type('sub.user');
      await p.click('#pass');
      await p.keyboard.type('sub-pw');
      await submitAndLoad(p, () => p.click('#go'));
      assert.equal(new URL(p.url()).hostname, 'app.portal-x.test');
      await waitFor(() => hasText(p, t.added), 'save prompt on app.*');
      await clickNode(p, await button(p, t.save));
      await waitFor(async () => hostLog().some((r) => r.cmd === 'add' && r.username === 'sub.user'), 'add sent');
      const a = hostLog().find((r) => r.cmd === 'add' && r.username === 'sub.user');
      assert.deepEqual([a.site, a.password], ['login.portal-x.test', 'sub-pw']);
      await p.close();
    });

    await scenario('login that redirects to an unrelated site → no prompt there', async () => {
      const p = await ctx.newPage();
      await goto(p, base + '/login');
      await p.evaluate((a) => { document.getElementById('login').action = a; }, baseY + '/home');
      await p.click('#user');
      await p.keyboard.press('Escape');
      await p.keyboard.type('cross.user');
      await p.click('#pass');
      await p.keyboard.type('cross-pw');
      await submitAndLoad(p, () => p.click('#go'));
      await sleep(500);
      assert.ok(!(await hasText(p, t.added)), 'no save prompt on portal-y');
      await p.close();
    });

    await scenario('synthetic submit / Enter from a page script sends nothing', async () => {
      const mark = hostLog().length;
      await page.evaluate(() => {
        document.getElementById('user').value = 'fake';
        const pass = document.getElementById('pass');
        pass.value = 'fake-pw';
        document.getElementById('login').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        pass.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      await sleep(300);
      assert.ok(!hostLog().slice(mark).some((r) => r.cmd === 'check'), 'no check sent');
    });
  } finally {
    await ctx.close();
  }

  await scenario(`no native host → popup and panel say "${T.ru.noHost}" (no lang → ru)`, async () => {
    // Without a host there is no lang, so the UI falls back to Russian.
    const c = await profile('nohost-' + lang, null);
    try {
      const p = await c.newPage();
      await p.goto(`chrome-extension://${ID}/popup.html`);
      await waitFor(async () => (await p.textContent('#status')).startsWith(T.ru.noHost), 'popup no host');
      await p.goto(base + '/login');
      await waitFor(() => hasText(p, T.ru.noHost), 'panel no host');
      await p.screenshot({ path: path.join(out, `${lang}-7-no-host.png`) });
    } finally {
      await c.close();
    }
  });
}

try {
  for (const lang of process.argv.slice(2).length ? process.argv.slice(2) : ['ru', 'tr']) await suite(lang);
} finally {
  server.close();
  plain.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(results.join('\n'));
console.log(`screenshots: ${out}`);
process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
