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
import { startSites } from './sites.mjs';

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
  en: {
    connected: 'Connected · 8 clients', noHost: 'Not connected', insecure: 'Insecure page', none: 'No matches', changed: 'Update it in EasyPass?',
    update: 'Update', no: 'No', added: 'Save it?', first: 'First name', last: 'Last name', save: 'Save', search: 'Find a client', eye: 'Show password', show: 'Show',
    done: 'Done', partial: 'Not finished', close: 'Close', h2: '2 hours', h5: '5 hours', tomorrow: 'Tomorrow', d2: 'In 2 days', custom: 'Custom reminder',
    reminderClosed: 'reminder closed', update2: 'Update EasyPass', noTasks: 'Add tasks in EasyPass', locked: 'Vault locked', retry: 'Try again',
    dotDone: 'Done this month', dotPartial: 'Not finished this month',
    summary: (d, p, n) => `This month: done ${d} · not finished ${p} · not started ${n}`,
  },
  ru: {
    connected: 'Подключено · 8 клиентов', noHost: 'Нет связи', insecure: 'Небезопасная страница', none: 'Ничего не найдено', changed: 'Обновить в EasyPass?',
    update: 'Обновить', no: 'Нет', added: 'Сохранить?', first: 'Имя', last: 'Фамилия', save: 'Сохранить', search: 'Поиск клиента', eye: 'Показать пароль', show: 'Показать',
    done: 'Сделано', partial: 'Не завершено', close: 'Закрыть', h2: '2 часа', h5: '5 часов', tomorrow: 'Завтра', d2: 'Через 2 дня', custom: 'Своё напоминание',
    reminderClosed: 'напоминание закрыто', update2: 'Обновите EasyPass', noTasks: 'Добавьте работы в EasyPass', locked: 'Хранилище заблокировано', retry: 'Повторить',
    dotDone: 'Готово в этом месяце', dotPartial: 'Не завершено в этом месяце',
    summary: (d, p, n) => `Этот месяц: готово ${d} · не завершено ${p} · не начато ${n}`,
  },
  tr: {
    connected: 'Bağlı · 8 müşteri', noHost: 'Bağlantı yok', insecure: 'Güvensiz sayfa', none: 'Sonuç yok', changed: 'güncellensin mi?',
    update: 'Güncelle', no: 'Hayır', added: 'Kaydedilsin mi?', first: 'Ad', last: 'Soyad', save: 'Kaydet', search: 'Müşteri ara', eye: 'Şifreyi göster', show: 'Göster',
    done: 'Yapıldı', partial: 'Bitmedi', close: 'Kapat', h2: '2 saat', h5: '5 saat', tomorrow: 'Yarın', d2: '2 gün sonra', custom: 'Özel hatırlatma',
    reminderClosed: 'hatırlatma kapatıldı', update2: "EasyPass'i güncelleyin", noTasks: "EasyPass'te iş ekleyin", locked: 'Kilitli', retry: 'Yeniden dene',
    dotDone: 'Bu ay bitti', dotPartial: 'Bu ay yarım',
    summary: (d, p, n) => `Bu ay: bitti ${d} · yarım ${p} · başlanmadı ${n}`,
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
const sites = await startSites({ certDir: tmp }); // the salyk flow's pages
// Sites with different host names, all resolved to the local servers by --host-resolver-rules.
const at = (host, s = server) => `${s === server ? 'https' : 'http'}://${host}:${s.address().port}`;
const base = at('portal-x.test');
const baseY = at('portal-y.test');

// Chrome on Mac reads user-level host manifests from <user-data-dir>/NativeMessagingHosts,
// so the fake host manifest lives in the throwaway profile and nothing global is touched.
const log = path.join(tmp, 'host.log');
const external = path.join(tmp, 'external.json');
function profile(name, lang, env = {}) {
  const dir = path.join(tmp, name);
  if (lang) {
    const wrapper = path.join(tmp, `host-${name}.sh`);
    const vars = Object.entries(env).map(([k, v]) => `${k}='${v}' `).join('');
    fs.writeFileSync(wrapper, `#!/bin/sh\n${vars}EP_LANG=${lang} EP_LOG='${log}' EP_EXTERNAL='${external}' exec '${process.execPath}' '${path.join(here, 'fake-host.mjs')}' "$@"\n`, { mode: 0o755 });
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
    disabled: !!n.properties?.find((p) => p.name === 'disabled')?.value.value,
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

// The monthly work flow on the salyk look-alike (spec §7, §8), in its own profile: the fake host has its customers there.
async function salykSuite(lang) {
  const t = T[lang];
  const shot = (page, name) => page.screenshot({ path: path.join(out, `${lang}-${name}.png`) });
  const SY = 'salykkabinet.test';
  const sp = (p) => sites.url(SY, p);
  const A = ['91000000000123', 'Salyk-111', 'e9', 'Токтогулов Айбек Маратович'];
  const B = ['92000000000456', 'Salyk-222', 'e10', 'Асанова Нургуль Бакытовна'];
  const C = ['93000000000789123', 'Salyk-333', 'e11', 'ОсОО "Ак-Жол"'];
  const D = ['96000000000001', 'Salyk-444', 'e12', 'Жумабеков Улан']; // only in the fake host until a scenario adds it to the site
  // the host's full name is "first last", and the site's text is surname first
  const stored = ([, , , text]) => { const [last, ...first] = text.split(' '); return [...first, last].join(' '); };
  const INS = 'Страховка', VAT = 'НДС', REP = 'Отчёт';
  const pad = (n) => String(n).padStart(2, '0');
  const monthOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const thisMonth = monthOf(new Date());
  const lastMonth = monthOf(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
  fs.rmSync(log, { force: true });
  results.push(`--- ${lang} salyk ---`);

  // one browser with its own host process, for the variants a host is started with
  const browser = async (name, env) => {
    const c = await profile(`salyk-${name}-${lang}`, lang, { EP_SALYK: 1, ...env });
    c.setDefaultTimeout(5000);
    return [c, c.serviceWorkers()[0] || await c.waitForEvent('serviceworker')];
  };
  const stateIn = (w) => w.evaluate(() => chrome.storage.local.get('salyk').then((r) => r.salyk ?? null));
  const hostSince = (mark, cmd) => hostLog().slice(mark).filter((r) => r.cmd === cmd);
  const load = (page, action) => Promise.all([page.waitForEvent('load'), action()]);
  async function signIn(page, [login, password], query = '') {
    await page.goto(sp('/account/login' + query));
    await page.fill('#user', login);
    await page.fill('#pass', password);
    await load(page, () => page.click('#go'));
  }
  const taskButton = async (page, task, name) => button(page, `${task}: ${name}`);
  const workPanel = (page, task = INS) => waitFor(() => taskButton(page, task, t.done), 'work panel');
  // password → organization → inside → logout click → the panel on the next page
  async function fullVisit(page, who) {
    await signIn(page, who);
    await waitFor(async () => (await workGet(who[2], thisMonth)).name, 'name read before "Войти", as at human speed');
    await load(page, () => page.click('a.btn-light-primary'));
    await load(page, () => page.click('#logout'));
    await workPanel(page);
  }
  const press = async (page, task, name) => clickNode(page, await waitFor(() => taskButton(page, task, name), `${task}: ${name}`));

  const [ctx, sw] = await browser('main', { EP_LOCK: path.join(tmp, 'locked-' + lang) });
  const lockFile = path.join(tmp, 'locked-' + lang);
  const state = () => stateIn(sw);
  const reset = async () => {
    await sw.evaluate(() => chrome.storage.local.remove('salyk'));
    sites.states.get('salykkabinet').sessions.clear();
    sites.states.get('salykkabinet').half.clear();
  };
  const scenarioFresh = (name, fn) => scenario('salyk: ' + name, async () => { await reset(); await fn(); });
  const workGet = (entryId, month) => sw.evaluate(([e, m, s]) => ask({ cmd: 'work_get', site: s, entryId: e, month: m }), [entryId, month, SY]);

  try {
    const page = await ctx.newPage();

    await scenarioFresh('right password → the organization page gives the name (set_name) → Войти → session open, no panel', async () => {
      const mark = hostLog().length;
      await signIn(page, A);
      assert.match(page.url(), /\/account\/selectorganization\?userName=91000000000123/);
      await waitFor(() => hostSince(mark, 'set_name').length, 'set_name sent');
      const [sent] = hostSince(mark, 'set_name');
      assert.deepEqual([sent.site, sent.entryId, sent.text], [SY, A[2], A[3]]);
      assert.equal((await state()).state, 'attempt');
      await load(page, () => page.click('a.btn-light-primary'));
      await waitFor(async () => (await state())?.state === 'open', 'session open');
      await sleep(200);
      assert.equal(await taskButton(page, INS, t.done), undefined, 'no panel inside the account');
    });

    await scenario('salyk: chrome.storage keeps no login, password or name', async () => {
      const stored = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
      for (const s of [A[0], A[1], A[3]]) assert.ok(!stored.includes(s), 'found in storage: ' + s);
      assert.deepEqual(Object.keys((await state()) || {}).filter((k) => !['entryId', 'month', 'at', 'state', 'selected', 'readName'].includes(k)), []);
    });

    await scenario('salyk: a click made by a page script is not a logout', async () => {
      await page.evaluate(() => {
        const a = document.getElementById('logout');
        a.addEventListener('click', (e) => e.preventDefault());
        a.click();
      });
      await sleep(200);
      assert.equal((await state()).state, 'open');
      await page.reload(); // drops the listener above
    });

    await scenario('salyk: logout click → panel on the next page, title name · login, login search stays closed', async () => {
      await load(page, () => page.click('#logout'));
      await workPanel(page);
      assert.ok(await hasText(page, `${stored(A)} · ${A[0]}`), 'title');
      assert.equal((await options(page)).length, 0, 'no search panel under the work panel');
      assert.ok(!(await ax(page)).some((n) => n.role === 'combobox'), 'no search box');
      await waitFor(async () => !(await iconIn(page, '#user')), 'the field icons do not show over the modal panel');
      await shot(page, '8-work-panel');
    });

    await scenario('salyk: Done + Not finished → reminder required → In 2 days 09:00 → Save → host gets the right shape', async () => {
      await press(page, INS, t.done);
      assert.ok((await taskButton(page, INS, t.done)).pressed, 'done pressed');
      await press(page, VAT, t.partial);
      await waitFor(() => taskButton(page, VAT, t.d2), 'reminder choices under the orange row');
      for (const label of [t.h2, t.h5, t.tomorrow, t.d2]) assert.ok(await taskButton(page, VAT, label), label);
      assert.equal(await taskButton(page, INS, t.d2), undefined, 'no choices under the green row');
      assert.ok((await button(page, t.save)).disabled, 'Save waits for a reminder');
      await shot(page, '9-work-panel-orange');
      await press(page, VAT, t.d2);
      await waitFor(async () => !(await button(page, t.save)).disabled, 'Save enabled');
      const mark = hostLog().length;
      const now = new Date();
      await clickNode(page, await button(page, t.save));
      await waitFor(() => hostSince(mark, 'work_save').length, 'work_save');
      const [s] = hostSince(mark, 'work_save');
      const nine = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 9).toISOString();
      assert.deepEqual({ site: s.site, entryId: s.entryId, month: s.month, statuses: s.statuses, reminders: s.reminders },
        { site: SY, entryId: A[2], month: thisMonth, statuses: { t1: 'done', t2: 'partial' }, reminders: { t2: nine } });
      await waitFor(async () => !(await taskButton(page, INS, t.done)), 'panel closed');
      assert.equal(await state(), null, 'session finished');
    });

    await scenario('salyk: after the panel the login search opens by itself for the next customer', async () => {
      await waitFor(async () => (await options(page)).length, 'search panel');
      await waitFor(async () => (await active(page)) === 'user', 'caret in the username field');
      assert.ok(await iconIn(page, '#user'), 'field icons back');
    });

    await scenarioFresh('second login, same month: states filled, name not read again, current reminder not sent back', async () => {
      const mark = hostLog().length;
      await fullVisit(page, A);
      assert.equal(hostSince(mark, 'set_name').length, 0, 'name already there');
      assert.ok((await taskButton(page, INS, t.done)).pressed);
      assert.ok((await taskButton(page, VAT, t.partial)).pressed);
      assert.ok(!(await taskButton(page, REP, t.done)).pressed && !(await taskButton(page, REP, t.partial)).pressed, 'grey');
      assert.ok(!(await button(page, t.save)).disabled, 'no new reminder needed');
      const due = (await workGet(A[2], thisMonth)).reminders[0].dueAt;
      assert.ok(await hasText(page, new Date(due).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), 'current time shown');
      await clickNode(page, await button(page, t.save));
      await waitFor(() => hostSince(mark, 'work_save').length, 'work_save');
      assert.deepEqual(hostSince(mark, 'work_save')[0].reminders, {});
      assert.equal((await workGet(A[2], thisMonth)).reminders[0].dueAt, due, 'reminder kept');
    });

    await scenarioFresh('a closed reminder reads so, and a new choice is optional', async () => {
      await sw.evaluate(() => ask({ cmd: '__dismiss' }));
      await fullVisit(page, A);
      await waitFor(() => hasText(page, t.reminderClosed), 'reminder closed text');
      assert.ok(!(await button(page, t.save)).disabled);
      await clickNode(page, await button(page, t.close));
      await waitFor(async () => !(await taskButton(page, INS, t.done)), 'closed');
    });

    await scenarioFresh('orange → green closes the old reminder; pressing a pressed button makes it grey again', async () => {
      await fullVisit(page, A);
      await press(page, VAT, t.done);
      await press(page, INS, t.done); // pressed: back to grey
      assert.ok(!(await taskButton(page, INS, t.done)).pressed, 'grey');
      const mark = hostLog().length;
      await clickNode(page, await button(page, t.save));
      await waitFor(() => hostSince(mark, 'work_save').length, 'work_save');
      assert.deepEqual(hostSince(mark, 'work_save')[0].statuses, { t2: 'done' });
      assert.deepEqual((await workGet(A[2], thisMonth)).reminders, []);
    });

    await scenarioFresh('free reminder: number + hours is now + N hours; empty number asks again', async () => {
      await fullVisit(page, A);
      await press(page, REP, t.partial);
      await clickNode(page, (await ax(page)).find((n) => n.name === `${REP}: ${t.custom}`));
      await page.keyboard.type('3');
      await waitFor(async () => !(await button(page, t.save)).disabled, 'Save enabled');
      await page.keyboard.press('Backspace');
      await waitFor(async () => (await button(page, t.save)).disabled, 'Save disabled again');
      await page.keyboard.type('3');
      await waitFor(async () => !(await button(page, t.save)).disabled, 'Save enabled');
      const mark = hostLog().length;
      const t0 = Date.now();
      await clickNode(page, await button(page, t.save));
      await waitFor(() => hostSince(mark, 'work_save').length, 'work_save');
      const at = +new Date(hostSince(mark, 'work_save')[0].reminders.t3);
      assert.ok(Math.abs(at - t0 - 3 * 3600_000) < 60_000, 'three hours from now');
    });

    await scenarioFresh('Esc closes without saving and ends the session', async () => {
      await fullVisit(page, B);
      const mark = hostLog().length;
      await page.keyboard.press('Escape');
      await waitFor(async () => !(await taskButton(page, INS, t.done)), 'panel closed');
      await waitFor(async () => (await state()) === null, 'session gone');
      assert.equal(hostSince(mark, 'work_save').length, 0);
      await page.reload();
      await opened(page);
      assert.equal(await taskButton(page, INS, t.done), undefined, 'no panel after reload');
    });

    await scenarioFresh('wrong password → stays on the login path, no panel, no session opened', async () => {
      await signIn(page, [A[0], 'wrong-pw']);
      assert.equal(new URL(page.url()).pathname, '/account/login');
      assert.ok(await page.isVisible('#error'));
      await opened(page);
      assert.equal((await state()).state, 'attempt');
      assert.equal(await taskButton(page, INS, t.done), undefined);
    });

    await scenarioFresh('wrong password, then the public forgot-password page and back → session not opened, no panel', async () => {
      await signIn(page, [A[0], 'wrong-pw']);
      await page.goto(sp('/account/forgotpassword'));
      await sleep(300);
      assert.equal((await state()).state, 'attempt');
      await page.goto(sp('/account/login'));
      await opened(page);
      assert.equal((await state()).state, 'attempt');
      assert.equal(await taskButton(page, INS, t.done), undefined);
    });

    await scenarioFresh('back from the organization page to login, then a public page → session not opened', async () => {
      await signIn(page, A);
      await waitFor(async () => (await state())?.selected, 'organization page seen');
      await page.goto(sp('/account/login'));
      await opened(page);
      await page.goto(sp('/account/forgotpassword'));
      await sleep(300);
      assert.equal((await state()).state, 'attempt');
    });

    await scenarioFresh('back from the organization page to the login page → no panel', async () => {
      await signIn(page, A);
      await page.goto(sp('/account/login'));
      await opened(page);
      assert.equal(await taskButton(page, INS, t.done), undefined);
    });

    await scenarioFresh('an attempt older than 2 minutes opens nothing and is dropped', async () => {
      await signIn(page, A);
      await sw.evaluate(() => chrome.storage.local.get('salyk').then(({ salyk }) => chrome.storage.local.set({ salyk: { ...salyk, at: Date.now() - 3 * 60_000 } })));
      await load(page, () => page.click('a.btn-light-primary'));
      await waitFor(async () => (await state()) === null, 'attempt dropped');
    });

    await scenarioFresh('site session times out (/__expire) → next page lands on login → panel', async () => {
      await signIn(page, B);
      await load(page, () => page.click('a.btn-light-primary'));
      await waitFor(async () => (await state())?.state === 'open', 'open');
      await page.goto(sp('/__expire'));
      await page.goto(sp('/'));
      assert.equal(new URL(page.url()).pathname, '/account/login');
      await workPanel(page);
      await clickNode(page, await button(page, t.close));
    });

    await scenarioFresh('tab closed while inside → the next login page asks about the previous customer', async () => {
      const p1 = await ctx.newPage();
      await signIn(p1, B);
      await load(p1, () => p1.click('a.btn-light-primary'));
      await waitFor(async () => (await state())?.state === 'open', 'open');
      await p1.close();
      const p2 = await ctx.newPage();
      await p2.goto(sp('/account/login'));
      await workPanel(p2);
      assert.ok(await hasText(p2, `${stored(B)} · ${B[0]}`), 'previous customer in the title');
      await clickNode(p2, await button(p2, t.close));
      await p2.close();
    });

    await scenarioFresh('many rows: the row whose number starts the login gives the name', async () => {
      const mark = hostLog().length;
      await signIn(page, C, '?multi=1');
      await waitFor(() => hostSince(mark, 'set_name').length, 'set_name');
      assert.equal(hostSince(mark, 'set_name')[0].text, C[3]);
    });

    await scenarioFresh('many rows, none starts the login: no name is written', async () => {
      if (!sites.states.get('salykkabinet').find(D[0])) {
        sites.states.get('salykkabinet').users.push({ first: 'X', last: 'Y', org: D[3], username: D[0], password: D[1] });
      }
      const mark = hostLog().length;
      await signIn(page, D, '?multi=1');
      await sleep(300);
      assert.ok((await state()).readName, 'the page was allowed to read');
      assert.equal(hostSince(mark, 'set_name').length, 0);
    });

    await scenarioFresh('organization page of another login than the one tried: name is not read', async () => {
      const mark = hostLog().length;
      await signIn(page, D, '?multi=1');
      await page.goto(sp(`/account/selectorganization?userName=${A[0]}`));
      await sleep(300);
      assert.equal(hostSince(mark, 'set_name').length, 0);
    });

    await scenarioFresh('the same nameless login on a one-row page does get its name', async () => {
      const mark = hostLog().length;
      await signIn(page, D);
      await waitFor(() => hostSince(mark, 'set_name').length, 'set_name');
      assert.equal(hostSince(mark, 'set_name')[0].text, D[3]);
    });

    await scenarioFresh('host locked at save: panel says so, states stay, Try again saves', async () => {
      await fullVisit(page, A);
      await press(page, REP, t.done);
      fs.writeFileSync(lockFile, '');
      await clickNode(page, await button(page, t.save));
      await waitFor(() => hasText(page, t.locked), 'locked message');
      assert.ok((await taskButton(page, REP, t.done)).pressed, 'state kept');
      assert.notEqual(await state(), null, 'session kept');
      fs.rmSync(lockFile);
      const mark = hostLog().length;
      await clickNode(page, await button(page, t.retry));
      await waitFor(() => hostSince(mark, 'work_save').length, 'work_save on retry');
      await waitFor(async () => !(await taskButton(page, REP, t.done)), 'panel closed');
    });

    await scenarioFresh('host locked when the panel opens: message, Try again loads the tasks', async () => {
      await signIn(page, A);
      await load(page, () => page.click('a.btn-light-primary'));
      fs.writeFileSync(lockFile, '');
      await load(page, () => page.click('#logout'));
      await waitFor(() => hasText(page, t.locked), 'locked message');
      fs.rmSync(lockFile);
      await clickNode(page, await button(page, t.retry));
      await workPanel(page);
      await clickNode(page, await button(page, t.close));
    });

    await scenarioFresh('two tabs with the panel: the second Save, already answered in the first, just closes', async () => {
      await sw.evaluate(([e, m]) => chrome.storage.local.set({ salyk: { entryId: e, month: m, at: Date.now(), state: 'closed' } }), [B[2], thisMonth]);
      const [p1, p2] = [await ctx.newPage(), await ctx.newPage()];
      for (const p of [p1, p2]) {
        await p.goto(sp('/account/login'));
        await workPanel(p);
      }
      await p1.bringToFront();
      await clickNode(p1, await button(p1, t.save));
      await waitFor(async () => (await state()) === null, 'session finished');
      await p2.bringToFront();
      await clickNode(p2, await button(p2, t.save));
      await waitFor(async () => !(await taskButton(p2, INS, t.done)), 'second panel closed');
      await p1.close();
      await p2.close();
    });

    for (const action of ['save', 'close']) {
      await scenarioFresh(`a panel for A left open while B signs in: its ${action} leaves B's session alone and writes nothing`, async () => {
        await sw.evaluate(([e, m]) => chrome.storage.local.set({ salyk: { entryId: e, month: m, at: Date.now(), state: 'closed' } }), [A[2], thisMonth]);
        const [p1, p2] = [await ctx.newPage(), await ctx.newPage()];
        for (const p of [p1, p2]) {
          await p.goto(sp('/account/login'));
          await workPanel(p);
        }
        await p1.bringToFront();
        await clickNode(p1, await button(p1, t.close));
        await waitFor(async () => (await state()) === null, 'A answered');
        await signIn(p1, B);
        await waitFor(async () => (await state())?.entryId === B[2], 'B tracked');
        const mark = hostLog().length;
        await p2.bringToFront();
        await clickNode(p2, await button(p2, t[action]));
        await waitFor(async () => !(await taskButton(p2, INS, t.done)), 'stale panel closed');
        await sleep(200);
        assert.equal(hostSince(mark, 'work_save').length, 0);
        assert.equal((await state())?.entryId, B[2]);
        await p1.close();
        await p2.close();
      });
    }

    await scenarioFresh('session from two months ago is dropped silently: no panel, no update message, no work_get', async () => {
      await sw.evaluate((u) => chrome.storage.local.set({ salyk: { entryId: u, month: '2020-01', at: Date.now(), state: 'closed' } }), A[2]);
      const mark = hostLog().length;
      await page.goto(sp('/account/login'));
      await opened(page);
      assert.equal(await state(), null);
      assert.equal(hostSince(mark, 'work_get').length, 0);
      assert.ok(!(await hasText(page, t.update2)));
    });

    await scenarioFresh('session from last month still asks, and is saved to that month', async () => {
      await sw.evaluate(([e, m]) => chrome.storage.local.set({ salyk: { entryId: e, month: m, at: Date.now(), state: 'closed' } }), [B[2], lastMonth]);
      await page.goto(sp('/account/login'));
      await workPanel(page);
      await press(page, INS, t.done);
      const mark = hostLog().length;
      await clickNode(page, await button(page, t.save));
      await waitFor(() => hostSince(mark, 'work_save').length, 'work_save');
      assert.equal(hostSince(mark, 'work_save')[0].month, lastMonth);
      await waitFor(async () => (await state()) === null, 'session finished');
    });

    await scenarioFresh('customer deleted while the session waited: dropped silently', async () => {
      await sw.evaluate(() => chrome.storage.local.set({ salyk: { entryId: 'gone', month: '2099-01', at: Date.now(), state: 'closed' } }));
      await page.goto(sp('/account/login'));
      await opened(page);
      assert.equal(await state(), null);
      assert.equal(await taskButton(page, INS, t.done), undefined);
    });

    await scenarioFresh('new login: saved from the prompt → tracked, typed name in the title; "No" → not tracked', async () => {
      const users = sites.states.get('salykkabinet').users;
      const fresh = (n) => users.push({ first: 'X', last: 'Y', org: 'Осмонова Гульнара', username: '9500000000000' + n, password: 'Salyk-new' });
      fresh(1);
      fresh(2);
      await signIn(page, ['95000000000001', 'Salyk-new']);
      await waitFor(() => hasText(page, t.added), 'save prompt');
      assert.equal(await state(), null, 'no entry yet');
      await clickNode(page, (await ax(page)).find((n) => n.role === 'textbox' && n.name === t.first));
      await page.keyboard.type('Zamira');
      await clickNode(page, await button(page, t.save));
      await waitFor(async () => (await state())?.state === 'attempt', 'attempt bound to the new entry');
      await load(page, () => page.click('a.btn-light-primary'));
      await load(page, () => page.click('#logout'));
      await workPanel(page);
      assert.ok(await hasText(page, 'Zamira · 95000000000001'), 'title');
      await clickNode(page, await button(page, t.close));
      await waitFor(async () => (await state()) === null, 'finished');

      await signIn(page, ['95000000000002', 'Salyk-new']);
      await waitFor(() => hasText(page, t.added), 'save prompt');
      await clickNode(page, await button(page, t.no));
      await load(page, () => page.click('a.btn-light-primary'));
      await sleep(200);
      assert.equal(await state(), null, 'not tracked');
    });

    await scenarioFresh('login list: green and orange dot with a name for screen readers; none when not started', async () => {
      const save = (entryId, statuses, month = thisMonth) => sw.evaluate(([s, e, m, st]) => ask({ cmd: 'work_save', site: s, entryId: e, month: m, statuses: st, reminders: {} }), [SY, entryId, month, statuses]);
      assert.ok((await save(A[2], { t1: 'done' })).ok);
      assert.ok((await save(B[2], { t1: 'done', t2: 'partial' })).ok);
      assert.ok((await save(C[2], { t1: 'done' }, lastMonth)).ok); // on the list, not started this month
      await page.goto(sp('/account/login'));
      const rows = await waitFor(async () => { const o = await options(page); return o.length >= 3 && o; }, 'list');
      const row = (who) => rows.find((o) => o.name.includes(who[0])).name;
      assert.ok(row(A).includes(t.dotDone), row(A));
      assert.ok(row(B).includes(t.dotPartial), row(B));
      assert.ok(!row(C).includes(t.dotDone) && !row(C).includes(t.dotPartial), row(C));
      await shot(page, '10-login-dots');
    });

    // after the list above: one more customer would push its rows past the panel's five
    await scenarioFresh('new login saved nameless on the organization page → the name is read from that page, Войти opens', async () => {
      const login = '95000000000003';
      sites.states.get('salykkabinet').users.push({ first: 'X', last: 'Y', org: 'Осмонова Гульнара', username: login, password: 'Salyk-new' });
      const mark = hostLog().length;
      await signIn(page, [login, 'Salyk-new']);
      await waitFor(() => hasText(page, t.added), 'save prompt');
      await clickNode(page, await button(page, t.save));
      await waitFor(() => hostSince(mark, 'set_name').length, 'set_name sent');
      assert.equal(hostSince(mark, 'set_name')[0].text, 'Осмонова Гульнара');
      await load(page, () => page.click('a.btn-light-primary'));
      await waitFor(async () => (await state())?.state === 'open', 'session open');
    });

    await scenario('salyk: popup shows the month line', async () => {
      const p = await ctx.newPage();
      await p.goto(`chrome-extension://${ID}/popup.html`);
      await waitFor(async () => (await p.textContent('#summary')) === t.summary(1, 1, 1), 'summary: ' + t.summary(1, 1, 1));
      await p.close();
    });

    await scenario('salyk: summary only from the popup; web pages get bad_request', async () => {
      assert.deepEqual(await sw.evaluate((u) => handle({ cmd: 'summary' }, 1, new URL(u)), sp('/')), { ok: false, error: 'bad_request' });
    });

    await scenario('salyk: untracked site has no salyk.js and every work command is refused', async () => {
      const seen = async (url) => {
        const p = await ctx.newPage();
        const cdp = await ctx.newCDPSession(p);
        const scripts = [];
        cdp.on('Debugger.scriptParsed', (e) => scripts.push(e.url));
        await cdp.send('Debugger.enable');
        await p.goto(url);
        await waitFor(() => scripts.some((u) => u.endsWith('/content.js')), 'content.js loaded');
        await sleep(200);
        await p.close();
        return scripts;
      };
      assert.ok(!(await seen(base + '/login')).some((u) => u.endsWith('/salyk.js')), 'salyk.js on an untracked site');
      assert.ok((await seen(sp('/account/login'))).some((u) => u.endsWith('/salyk.js')), 'salyk.js on the tracked site');
      for (const cmd of ['salyk_page', 'salyk_name', 'salyk_logout', 'work_save', 'work_close', 'work_get', 'set_name']) {
        const mark = hostLog().length;
        assert.deepEqual(await sw.evaluate(([c, u]) => handle({ cmd: c, entryId: 'e1', text: 'Ad Soyad' }, 1, new URL(u)), [cmd, base + '/login']), { ok: false, error: 'bad_request' }, cmd);
        assert.equal(hostSince(mark, cmd).length, 0, 'reached the host: ' + cmd);
      }
    });

    await scenario('salyk: a tracked page cannot call the host commands directly either', async () => {
      for (const cmd of ['work_get', 'set_name']) {
        assert.deepEqual(await sw.evaluate(([c, u]) => handle({ cmd: c, entryId: 'e9', text: 'Ad Soyad' }, 1, new URL(u)), [cmd, sp('/')]), { ok: false, error: 'bad_request' }, cmd);
      }
    });

    await scenario('salyk: speed: session read and panel reply under 50 ms', async () => {
      const times = await sw.evaluate(async ([u, e, m]) => {
        let reply;
        const best = async (setup) => {
          let ms = Infinity;
          for (let i = 0; i < 5; i++) {
            await setup();
            const t0 = performance.now();
            reply = await handle({ cmd: 'salyk_page' }, 1, new URL(u));
            ms = Math.min(ms, performance.now() - t0);
          }
          return ms;
        };
        return {
          none: await best(() => chrome.storage.local.remove('salyk')),
          panel: await best(() => chrome.storage.local.set({ salyk: { entryId: e, month: m, at: Date.now(), state: 'closed' } })),
          tasks: reply.panel.tasks.length,
        };
      }, [sp('/account/login'), A[2], thisMonth]);
      await sw.evaluate(() => chrome.storage.local.remove('salyk'));
      results.push(`      salyk_page: no session ${times.none.toFixed(1)} ms, panel ${times.panel.toFixed(1)} ms`);
      assert.equal(times.tasks, 3, 'the panel data really came');
      assert.ok(times.none < 50 && times.panel < 50, JSON.stringify(times));
    });

    // --- spec §7c: this month's work from the toolbar popup, without signing in ---
    const putWork = (statuses, reminders = {}) => sw.evaluate(([s, st, r, m]) => ask({ cmd: 'work_save', site: s, entryId: 'e12', month: m, statuses: st, reminders: r }), [SY, statuses, reminders, thisMonth]);
    async function popupDetail(who) {
      const p = await ctx.newPage();
      await p.goto(`chrome-extension://${ID}/popup.html`);
      await p.fill('#q', who);
      await p.locator('#list .opt', { hasText: who }).click();
      await p.waitForSelector('#detail:not([hidden])');
      return p;
    }
    const pb = (p, task, name) => p.getByRole('button', { name: `${task}: ${name}`, exact: true });
    const pressed = async (p, task, name) => (await pb(p, task, name).getAttribute('aria-pressed')) === 'true';
    const saveBtn = (p) => p.getByRole('button', { name: t.save, exact: true });
    const dueIn = (iso) => (Date.parse(iso) - Date.now()) / 3600_000;

    await scenario('salyk: popup shows this month\'s tasks above login and password; a press toggles green and back to grey, nothing is written until Save', async () => {
      await putWork({});
      const mark = hostLog().length;
      const p = await popupDetail(D[0]);
      await pb(p, INS, t.done).waitFor();
      assert.equal(await p.evaluate(() => !!(document.getElementById('work').compareDocumentPosition(document.getElementById('fields')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'tasks before login/password');
      assert.ok((await p.textContent('#fields')).includes(D[0]), 'login still shown');
      await pb(p, INS, t.done).click();
      assert.equal(await pressed(p, INS, t.done), true);
      await pb(p, INS, t.done).click();
      assert.equal(await pressed(p, INS, t.done), false, 'pressed again = grey');
      await shot(p, '13-popup-work');
      assert.equal(hostSince(mark, 'work_save').length, 0, 'a press alone writes nothing');
      assert.equal(hostSince(mark, 'work_get').length, 1, 'one fetch, when the customer was opened');
      await p.close();
    });

    await scenario('salyk: popup change to green + Save reaches the vault; the open session is untouched', async () => {
      const soon = new Date(Date.now() + 3 * 3600_000).toISOString();
      await putWork({ t1: 'partial', t2: 'done' }, { t1: soon });
      const open = { entryId: A[2], month: thisMonth, at: Date.now(), state: 'closed' };
      await sw.evaluate((s) => chrome.storage.local.set({ salyk: s }), open);
      const p = await popupDetail(D[0]);
      await pb(p, INS, t.partial).waitFor();
      assert.equal(await pressed(p, INS, t.partial), true, 'orange comes back from the vault');
      assert.equal(await pressed(p, VAT, t.done), true);
      assert.ok((await p.locator('#work .hint:not(:empty)').first().textContent()).trim(), 'the existing reminder time is shown');
      assert.equal(await saveBtn(p).isDisabled(), false, 'existing time: no new choice needed');
      await pb(p, INS, t.done).click();
      const mark = hostLog().length;
      await saveBtn(p).click();
      await waitFor(() => hostSince(mark, 'work_save').length, 'work_save sent');
      const [sent] = hostSince(mark, 'work_save');
      assert.deepEqual([sent.site, sent.entryId, sent.month, sent.statuses, sent.reminders], [SY, 'e12', thisMonth, { t1: 'done', t2: 'done' }, {}]);
      const w = await workGet('e12', thisMonth);
      assert.deepEqual([w.statuses, w.reminders], [{ t1: 'done', t2: 'done' }, []], 'saved; the old reminder is closed');
      assert.deepEqual(await state(), open, 'the salyk session is not touched');
      await sw.evaluate(() => chrome.storage.local.remove('salyk'));
      await p.close();
    });

    await scenario('salyk: popup orange needs a reminder time; only a newly chosen time is sent, an existing one is kept', async () => {
      await putWork({});
      const p = await popupDetail(D[0]);
      await pb(p, VAT, t.partial).click();
      assert.equal(await saveBtn(p).isDisabled(), true, 'orange without a time');
      await pb(p, VAT, t.h5).click();
      assert.equal(await saveBtn(p).isDisabled(), false);
      let mark = hostLog().length;
      await saveBtn(p).click();
      await waitFor(() => hostSince(mark, 'work_save').length, 'work_save sent');
      let [sent] = hostSince(mark, 'work_save');
      assert.deepEqual(sent.statuses, { t2: 'partial' });
      assert.deepEqual(Object.keys(sent.reminders), ['t2']);
      assert.ok(Math.abs(dueIn(sent.reminders.t2) - 5) < 0.1, sent.reminders.t2);
      await p.close();
      const q = await popupDetail(D[0]); // reopened: the time is there, no new choice needed
      await pb(q, VAT, t.partial).waitFor();
      assert.equal(await pressed(q, VAT, t.partial), true);
      assert.equal(await saveBtn(q).isDisabled(), false);
      await pb(q, REP, t.partial).click();
      assert.equal(await saveBtn(q).isDisabled(), true, 'a second orange row needs its own time');
      await q.getByRole('group', { name: REP }).locator('select').selectOption('d');
      await q.getByLabel(`${REP}: ${t.custom}`, { exact: true }).fill('2');
      assert.equal(await saveBtn(q).isDisabled(), false);
      mark = hostLog().length;
      await saveBtn(q).click();
      await waitFor(() => hostSince(mark, 'work_save').length, 'second work_save sent');
      [sent] = hostSince(mark, 'work_save');
      assert.deepEqual(Object.keys(sent.reminders), ['t3'], 'the existing t2 time is not resent');
      const at = new Date(sent.reminders.t3);
      assert.equal(at.getHours(), 9, 'days ring at 09:00 local');
      assert.equal((await workGet('e12', thisMonth)).reminders.length, 2, 'the old time stays');
      await q.close();
    });

    await scenario('salyk: popup error shows inline and keeps the toggles', async () => {
      await putWork({});
      const p = await popupDetail(D[0]);
      await pb(p, INS, t.done).click();
      fs.writeFileSync(lockFile, '');
      await saveBtn(p).click();
      await waitFor(async () => (await p.textContent('#work')).includes(t.locked), 'locked message inline');
      assert.equal(await pressed(p, INS, t.done), true, 'toggle kept');
      fs.rmSync(lockFile);
      await p.getByRole('button', { name: t.retry, exact: true }).click();
      await waitFor(async () => (await workGet('e12', thisMonth)).statuses.t1 === 'done', 'saved on retry');
      await p.close();
    });

    await scenario('salyk: popup entry of another site shows no tasks and asks the host nothing', async () => {
      const mark = hostLog().length;
      const p = await ctx.newPage();
      await p.goto(`chrome-extension://${ID}/popup.html`);
      await p.fill('#q', 'lale');
      await p.locator('#list .opt', { hasText: 'Lale Host' }).click();
      await p.waitForSelector('#detail:not([hidden])');
      assert.ok((await p.textContent('#fields')).includes('portal-y.test'), 'details as before');
      assert.equal(await p.locator('#work').isVisible(), false);
      await sleep(150);
      assert.equal(hostSince(mark, 'work_get').length, 0, 'no work_get for an untracked site');
      await p.close();
    });

    await scenario('salyk: a page cannot call the popup path (work_get / work_save with a site)', async () => {
      await sw.evaluate(() => chrome.storage.local.remove('salyk'));
      const mark = hostLog().length;
      const msgs = [
        { cmd: 'work_get', site: SY, entryId: 'e12' },
        { cmd: 'work_save', site: SY, entryId: 'e12', statuses: { t1: 'done' }, reminders: {} },
      ];
      for (const m of msgs) {
        assert.deepEqual(await sw.evaluate(([x, u]) => handle(x, 1, new URL(u)), [m, base + '/login']), { ok: false, error: 'bad_request' }, 'untracked page: ' + m.cmd);
      }
      assert.deepEqual(await sw.evaluate(([x, u]) => handle(x, 1, new URL(u)), [msgs[0], sp('/')]), { ok: false, error: 'bad_request' }, 'tracked page: work_get');
      assert.deepEqual(await sw.evaluate(([x, u]) => handle(x, 1, new URL(u)), [msgs[1], sp('/')]), { ok: false, error: 'not_found' }, 'tracked page: work_save is only the panel path, bound to the session');
      assert.equal(hostSince(mark, 'work_get').length + hostSince(mark, 'work_save').length, 0, 'nothing reached the host');
      const popup = `chrome-extension://${ID}/popup.html`;
      assert.deepEqual(await sw.evaluate(([x, u]) => handle(x, undefined, new URL(u)), [{ cmd: 'work_get', site: 'portal-x.test', entryId: 'e1' }, popup]), { ok: false, error: 'bad_request' }, 'popup: untracked site');
      assert.equal(hostSince(mark, 'work_get').length, 0);
    });
  } finally {
    await ctx.close();
  }

  await scenario('salyk: no tasks defined → a small hint instead of the panel, session finished', async () => {
    const [c, w] = await browser('notasks', { EP_NO_TASKS: 1 });
    try {
      const p = await c.newPage();
      await signIn(p, A);
      await load(p, () => p.click('a.btn-light-primary'));
      await load(p, () => p.click('#logout'));
      await waitFor(() => hasText(p, t.noTasks), 'hint');
      await waitFor(async () => (await stateIn(w)) === null, 'session finished');
      await waitFor(async () => (await options(p)).length, 'login search not blocked by the hint');
      await shot(p, '11-no-tasks');
      await p.click('h1', { timeout: 2000 }); // the hint must not cover the page
    } finally {
      await c.close();
    }
    sites.states.get('salykkabinet').sessions.clear();
  });

  await scenario('salyk: old host → "update EasyPass" in the panel, the name page stays silent', async () => {
    const [c] = await browser('old', { EP_OLD_HOST: 1 });
    try {
      const p = await c.newPage();
      await signIn(p, A);
      await load(p, () => p.click('a.btn-light-primary'));
      await load(p, () => p.click('#logout'));
      await waitFor(() => hasText(p, t.update2), 'update message');
      await shot(p, '12-old-host');
      await clickNode(p, await button(p, t.close));
      await waitFor(async () => !(await hasText(p, t.update2)), 'closed');
    } finally {
      await c.close();
    }
  });
}

try {
  for (const lang of process.argv.slice(2).length ? process.argv.slice(2) : ['ru', 'tr', 'en']) {
    await suite(lang);
    await salykSuite(lang);
  }
} finally {
  server.close();
  plain.close();
  sites.server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(results.join('\n'));
console.log(`screenshots: ${out}`);
process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
