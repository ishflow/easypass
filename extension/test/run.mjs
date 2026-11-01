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
    dotDone: 'Done this month', dotPartial: 'Not finished this month', logoutFailed: 'Could not sign out',
    ask: 'Which tasks are done for this client every month?', next: 'Next', edit: 'Edit task list', add: '+ Add a task', saved: 'Saved',
    summary: (d, p, n) => `This month: done ${d} · not finished ${p} · not started ${n}`,
  },
  ru: {
    connected: 'Подключено · 8 клиентов', noHost: 'Нет связи', insecure: 'Небезопасная страница', none: 'Ничего не найдено', changed: 'Обновить в EasyPass?',
    update: 'Обновить', no: 'Нет', added: 'Сохранить?', first: 'Имя', last: 'Фамилия', save: 'Сохранить', search: 'Поиск клиента', eye: 'Показать пароль', show: 'Показать',
    done: 'Сделано', partial: 'Не завершено', close: 'Закрыть', h2: '2 часа', h5: '5 часов', tomorrow: 'Завтра', d2: 'Через 2 дня', custom: 'Своё напоминание',
    reminderClosed: 'напоминание закрыто', update2: 'Обновите EasyPass', noTasks: 'Добавьте работы в EasyPass', locked: 'Хранилище заблокировано', retry: 'Повторить',
    dotDone: 'Готово в этом месяце', dotPartial: 'Не завершено в этом месяце', logoutFailed: 'Не удалось выйти',
    ask: 'Какие работы делаются этому клиенту каждый месяц?', next: 'Далее', edit: 'Изменить список работ', add: '+ Добавить работу', saved: 'Сохранено',
    summary: (d, p, n) => `Этот месяц: готово ${d} · не завершено ${p} · не начато ${n}`,
  },
  tr: {
    connected: 'Bağlı · 8 müşteri', noHost: 'Bağlantı yok', insecure: 'Güvensiz sayfa', none: 'Sonuç yok', changed: 'güncellensin mi?',
    update: 'Güncelle', no: 'Hayır', added: 'Kaydedilsin mi?', first: 'Ad', last: 'Soyad', save: 'Kaydet', search: 'Müşteri ara', eye: 'Şifreyi göster', show: 'Göster',
    done: 'Yapıldı', partial: 'Bitmedi', close: 'Kapat', h2: '2 saat', h5: '5 saat', tomorrow: 'Yarın', d2: '2 gün sonra', custom: 'Özel hatırlatma',
    reminderClosed: 'hatırlatma kapatıldı', update2: "EasyPass'i güncelleyin", noTasks: "EasyPass'te iş ekleyin", locked: 'Kilitli', retry: 'Yeniden dene',
    dotDone: 'Bu ay bitti', dotPartial: 'Bu ay yarım', logoutFailed: 'çıkılamadı',
    ask: 'Bu müşteriye her ay hangi işler yapılır?', next: 'İleri', edit: 'İş listesini değiştir', add: '+ İş ekle', saved: 'Kaydedildi',
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
  // the login form arrives late (a slow SPA): within the 5 s the one-click sign-in waits, and after them
  // a button of the site with no type before the real one, which stops its own click
  '/decoy-button': (p) => p.replace('<button id="go">', '<button id="decoy" onclick="event.preventDefault()">👁</button><button id="go" type="submit">'),
  '/late-form': (p) => p.replace('<form id="login"', '<form id="login" hidden').replace('</body>', "<script>setTimeout(() => { document.getElementById('login').hidden = false; }, 700)</script></body>"),
  '/too-late': (p) => p.replace('<form id="login"', '<form id="login" hidden').replace('</body>', "<script>setTimeout(() => { document.getElementById('login').hidden = false; }, 5600)</script></body>"),
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
    checked: n.properties?.find((p) => p.name === 'checked')?.value.value === 'true',
    value: n.value?.value,
  }));
}
// Layout probe: a box and whether anything inside it spills out of it (content taller or wider than the box, scroll containers aside).
// Source text, so it runs in the page, in a closed shadow root (by CDP) and under the popup's CSP alike.
const MEASURE = `(e) => {
  const r = e.getBoundingClientRect();
  const cut = [e, ...e.querySelectorAll('*')].some((x) => {
    const o = getComputedStyle(x);
    const spill = (axis, size) => o['overflow' + axis] !== 'auto' && o['overflow' + axis] !== 'scroll' && x['scroll' + size] > x['client' + size] + 1;
    return spill('X', 'Width') || spill('Y', 'Height');
  });
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, cut };
}`;
// A node of the accessibility tree (a closed shadow root), or its closest ancestor `up`.
async function probe(page, node, up = null) {
  const { object } = await page.cdp.send('DOM.resolveNode', { backendNodeId: node.node });
  const { result } = await page.cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId, returnByValue: true,
    functionDeclaration: `function(up) { return (${MEASURE})(up ? this.closest(up) || this : this); }`, arguments: [{ value: up }],
  });
  return result.value;
}
const probeAll = (page, selector) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(${MEASURE})`);
// Boxes in reading order: nothing cut off, and each one ends before the next begins.
function assertStacked(boxes, what) {
  assert.ok(boxes.length, what + ': found');
  boxes.sort((a, b) => a.top - b.top);
  boxes.forEach((b, i) => {
    assert.ok(!b.cut, `${what} ${i}: text spills out of its box`);
    if (i) assert.ok(boxes[i - 1].bottom <= b.top + 0.5, `${what} ${i}: overlaps the one above`);
  });
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
    // A scenario that never settles must fail, not hang the whole run in silence
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('scenario timeout: 180 s')), 180000); });
    await Promise.race([fn(), limit]).finally(() => clearTimeout(timer));
    results.push(`PASS  ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name}\n      ${e.message.split('\n').slice(0, 12).join(' ')}`);
  }
  console.error(results.at(-1));
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
    await page.fill('#Username', login);
    await page.fill('#Password', password);
    await load(page, () => page.click('form[action^="/account/login"] button[type=submit]'));
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
      assert.deepEqual(Object.keys((await state()) || {}).filter((k) => !['entryId', 'month', 'at', 'state', 'selected', 'readName', 'site', 'auto'].includes(k)), []);
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
      await waitFor(async () => !(await iconIn(page, '#Username')), 'the field icons do not show over the modal panel');
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
      await waitFor(async () => (await active(page)) === 'Username', 'caret in the username field');
      assert.ok(await iconIn(page, '#Username'), 'field icons back');
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
      const fresh = (n) => users.push({ first: 'X', last: 'Y', org: 'Тестова Анна', username: '9500000000000' + n, password: 'Salyk-new' });
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
      await waitFor(() => hasText(page, t.ask), 'a new customer has no task list yet: the checklist comes first');
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
      assert.ok((await save(A[2], { t1: 'done', t2: 'done', t3: 'done' })).ok); // green = all of the customer's tasks (§7d)
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
      sites.states.get('salykkabinet').users.push({ first: 'X', last: 'Y', org: 'Тестова Анна', username: login, password: 'Salyk-new' });
      const mark = hostLog().length;
      await signIn(page, [login, 'Salyk-new']);
      await waitFor(() => hasText(page, t.added), 'save prompt');
      await clickNode(page, await button(page, t.save));
      await waitFor(() => hostSince(mark, 'set_name').length, 'set_name sent');
      assert.equal(hostSince(mark, 'set_name')[0].text, 'Тестова Анна');
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
      for (const cmd of ['salyk_page', 'salyk_name', 'salyk_logout', 'work_save', 'work_assign', 'work_close', 'work_get', 'set_name']) {
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
    const assignTo = (entryId, taskIds) => sw.evaluate(([s, e, ids]) => ask({ cmd: 'work_assign', site: s, entryId: e, taskIds: ids }), [SY, entryId, taskIds]);
    const putWork = async (statuses, reminders = {}) => (await assignTo('e12', ['t1', 't2', 't3']), sw.evaluate(([s, st, r, m]) => ask({ cmd: 'work_save', site: s, entryId: 'e12', month: m, statuses: st, reminders: r }), [SY, statuses, reminders, thisMonth]));
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
      await shot(p, '19-popup-orange');
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
        { cmd: 'work_assign', site: SY, entryId: 'e12', taskIds: ['t1'] },
      ];
      for (const m of msgs) {
        assert.deepEqual(await sw.evaluate(([x, u]) => handle(x, 1, new URL(u)), [m, base + '/login']), { ok: false, error: 'bad_request' }, 'untracked page: ' + m.cmd);
      }
      assert.deepEqual(await sw.evaluate(([x, u]) => handle(x, 1, new URL(u)), [msgs[0], sp('/')]), { ok: false, error: 'bad_request' }, 'tracked page: work_get');
      assert.deepEqual(await sw.evaluate(([x, u]) => handle(x, 1, new URL(u)), [msgs[1], sp('/')]), { ok: false, error: 'not_found' }, 'tracked page: work_save is only the panel path, bound to the session');
      assert.deepEqual(await sw.evaluate(([x, u]) => handle(x, 1, new URL(u)), [msgs[2], sp('/')]), { ok: false, error: 'not_found' }, 'tracked page: work_assign is only the panel path, bound to the session');
      await sw.evaluate((s) => chrome.storage.local.set({ salyk: s }), { entryId: A[2], month: thisMonth, at: Date.now(), state: 'closed' });
      assert.deepEqual(await sw.evaluate(([x, u]) => handle(x, 1, new URL(u)), [msgs[2], sp('/')]), { ok: false, error: 'not_found' }, 'another customer than the session\'s');
      await sw.evaluate(() => chrome.storage.local.remove('salyk'));
      assert.equal(['work_get', 'work_save', 'work_assign'].flatMap((c) => hostSince(mark, c)).length, 0, 'nothing reached the host');
      const popup = `chrome-extension://${ID}/popup.html`;
      for (const cmd of ['work_get', 'work_assign']) {
        assert.deepEqual(await sw.evaluate(([x, u]) => handle(x, undefined, new URL(u)), [{ cmd, site: 'portal-x.test', entryId: 'e1', taskIds: ['t1'] }, popup]), { ok: false, error: 'bad_request' }, 'popup: untracked site ' + cmd);
      }
      assert.equal(['work_get', 'work_assign'].flatMap((c) => hostSince(mark, c)).length, 0);
    });

    // --- spec §7d: tasks per customer. Two customers that only the fake host knows (the vault written by the app), no list yet ---
    const E = ['97000000000002', 'Salyk-555', 'x-e', 'Иманова Айнура']; // the exit panel
    const F = ['98000000000003', 'Salyk-666', 'x-f']; // the popup
    const extra = (who) => ({ id: who[2], site: SY, firstName: '', lastName: '', extra1: '', extra2: '', username: who[0], password: who[1], fields: [], updatedAt: 1, taskIds: null });
    fs.writeFileSync(external, JSON.stringify([...(fs.existsSync(external) ? JSON.parse(fs.readFileSync(external, 'utf8')) : []), extra(E), extra(F)]));
    sites.states.get('salykkabinet').users.push({ first: 'X', last: 'Y', org: E[3], username: E[0], password: E[1] });
    // n.name: the login page's own RememberMe, behind the panel, has none
    const checks = async (page) => (await ax(page)).filter((n) => n.role === 'checkbox' && n.name).map((n) => [n.name, n.checked]);
    const tick = async (page, name) => clickNode(page, (await ax(page)).find((n) => n.role === 'checkbox' && n.name === name));
    const assignedOf = async (who) => (await workGet(who[2], thisMonth));
    async function exitTo(page, who) { // password → name read → Войти → logout
      await signIn(page, who);
      await waitFor(async () => (await workGet(who[2], thisMonth)).name, 'name read');
      await load(page, () => page.click('a.btn-light-primary'));
      await load(page, () => page.click('#logout'));
    }

    await scenarioFresh('first exit asks which tasks are done every month; Close assigns nothing and it asks again; Next keeps only the chosen', async () => {
      const mark = hostLog().length;
      await exitTo(page, E);
      await waitFor(() => hasText(page, t.ask), 'checklist');
      assert.deepEqual(await checks(page), [[INS, false], [VAT, false], [REP, false]]);
      assert.equal((await button(page, t.next)).disabled, true, 'nothing ticked');
      assert.equal(await taskButton(page, INS, t.done), undefined, 'no task rows before the list');
      await shot(page, '14-checklist');
      await clickNode(page, await button(page, t.close));
      await waitFor(async () => (await state()) === null, 'session finished');
      assert.equal(hostSince(mark, 'work_assign').length, 0, 'Close assigns nothing');
      assert.equal((await assignedOf(E)).assigned, false);

      await exitTo(page, E);
      await waitFor(() => hasText(page, t.ask), 'asked again');
      await tick(page, INS);
      await tick(page, REP);
      assert.equal((await button(page, t.next)).disabled, false);
      await clickNode(page, await button(page, t.next));
      await workPanel(page);
      assert.equal(await taskButton(page, VAT, t.done), undefined, 'only the chosen tasks');
      assert.ok(await taskButton(page, REP, t.done));
      const [sent] = hostSince(mark, 'work_assign');
      assert.deepEqual([sent.site, sent.entryId, sent.taskIds], [SY, E[2], ['t1', 't3']]);
      assert.equal((await state())?.entryId, E[2], 'the session goes on');
    });

    await scenarioFresh('second visit skips the checklist and shows only the chosen tasks', async () => {
      await exitTo(page, E);
      await workPanel(page);
      assert.deepEqual(await checks(page), []);
      assert.equal(await taskButton(page, VAT, t.done), undefined);
    });

    await scenarioFresh('the "' + 'edit task list' + '" link reopens the checklist ticked with the current list; Next changes it', async () => {
      await exitTo(page, E);
      await workPanel(page);
      await clickNode(page, await button(page, t.edit));
      await waitFor(() => hasText(page, t.ask), 'checklist');
      assert.deepEqual(await checks(page), [[INS, true], [VAT, false], [REP, true]]);
      await tick(page, INS);
      await tick(page, VAT);
      await clickNode(page, await button(page, t.next));
      await waitFor(() => taskButton(page, VAT, t.done), 'panel with the new list');
      assert.equal(await taskButton(page, INS, t.done), undefined);
      assert.deepEqual((await assignedOf(E)).tasks.map((x) => x.id), ['t2', 't3']);
    });

    await scenario('salyk: popup checklist: marks come ticked, Next stays disabled until one is ticked, then only the chosen show; the link changes the list', async () => {
      await sw.evaluate(([s, e, m]) => ask({ cmd: 'work_save', site: s, entryId: e, month: m, statuses: { t2: 'done' }, reminders: {} }), [SY, F[2], thisMonth]);
      const mark = hostLog().length;
      const p = await popupDetail(F[0]);
      const box = (name) => p.getByRole('checkbox', { name, exact: true });
      const next = p.getByRole('button', { name: t.next, exact: true });
      await box(VAT).waitFor();
      assert.equal(await p.getByText(t.ask).count(), 1);
      assert.deepEqual([await box(INS).isChecked(), await box(VAT).isChecked(), await box(REP).isChecked()], [false, true, false], 'the mark comes ticked');
      await box(VAT).uncheck();
      assert.equal(await next.isDisabled(), true);
      await box(INS).check();
      await box(VAT).check();
      await shot(p, '15-popup-checklist');
      await next.click();
      await pb(p, INS, t.done).waitFor();
      assert.equal(await pb(p, REP, t.done).count(), 0, 'only the chosen tasks');
      assert.equal(await pressed(p, VAT, t.done), true, 'the mark is kept');
      const [sent] = hostSince(mark, 'work_assign');
      assert.deepEqual([sent.site, sent.entryId, sent.taskIds], [SY, F[2], ['t1', 't2']]);
      await p.getByRole('button', { name: t.edit, exact: true }).click();
      await box(REP).waitFor();
      assert.deepEqual([await box(INS).isChecked(), await box(VAT).isChecked(), await box(REP).isChecked()], [true, true, false]);
      await box(INS).uncheck();
      await box(REP).check();
      await next.click();
      await pb(p, REP, t.done).waitFor();
      assert.equal(await pb(p, INS, t.done).count(), 0);
      assert.deepEqual((await assignedOf(F)).tasks.map((x) => x.id), ['t2', 't3']);
      await p.close();
    });

    // --- spec §13: add a task from the panel, keep the unsaved toggles, the brief "saved" mark ---
    const G = ['99000000000004', 'Salyk-777', 'x-g', 'Бекова Нурзат'];
    fs.writeFileSync(external, JSON.stringify([...JSON.parse(fs.readFileSync(external, 'utf8')), extra(G)]));
    sites.states.get('salykkabinet').users.push({ first: 'X', last: 'Y', org: G[3], username: G[0], password: G[1] });
    const overlaySave = async (page) => (await ax(page)).filter((n) => n.role === 'button' && n.name === t.save).at(-1); // the overlay's, in front of the panel's
    const pressedIn = async (page, task, name) => (await taskButton(page, task, name))?.pressed;

    await scenarioFresh('"add a task" in the exit panel: overlay with the tasks not on the list, Save adds them at once, pressed toggles stay, the button goes when nothing is left', async () => {
      assert.ok((await assignTo(G[2], ['t1'])).ok);
      const mark = hostLog().length;
      await exitTo(page, G);
      await workPanel(page);
      await press(page, INS, t.done);
      await clickNode(page, await button(page, t.add));
      await waitFor(async () => (await checks(page)).length, 'overlay');
      assert.deepEqual(await checks(page), [[VAT, false], [REP, false]], 'only tasks off the list');
      assert.equal((await overlaySave(page)).disabled, true, 'nothing ticked');
      await shot(page, '16-add-overlay');
      await tick(page, REP);
      await clickNode(page, await overlaySave(page));
      await waitFor(() => taskButton(page, REP, t.done), 'the new task has its toggles');
      assert.equal(await pressedIn(page, INS, t.done), true, 'the pressed toggle is kept');
      assert.equal(await taskButton(page, VAT, t.done), undefined);
      assert.deepEqual(hostSince(mark, 'work_assign').map((x) => x.taskIds), [['t1', 't3']]);
      assert.equal(hostSince(mark, 'work_save').length, 0, 'nothing saved yet');
      await clickNode(page, await button(page, t.add));
      await waitFor(async () => (await checks(page)).length, 'overlay again');
      await tick(page, VAT);
      await clickNode(page, await overlaySave(page));
      await waitFor(() => taskButton(page, VAT, t.done), 'all three');
      assert.equal(await button(page, t.add), undefined, 'nothing left to add: no button');
      assert.equal(await pressedIn(page, INS, t.done), true);
    });

    await scenarioFresh('"edit task list" keeps the unsaved toggles of the tasks that stay on the list', async () => {
      await exitTo(page, G);
      await workPanel(page);
      await press(page, INS, t.done);
      await press(page, REP, t.partial);
      await clickNode(page, await waitFor(() => button(page, `${REP}: ${t.h2}`), 'reminder choice'));
      await clickNode(page, await button(page, t.edit));
      await waitFor(() => hasText(page, t.ask), 'checklist');
      await clickNode(page, await button(page, t.next)); // same list
      await workPanel(page);
      assert.equal(await pressedIn(page, INS, t.done), true);
      assert.equal(await pressedIn(page, REP, t.partial), true);
      assert.equal((await button(page, t.save)).disabled, false, 'the chosen time is kept too');
      await clickNode(page, await button(page, t.edit));
      await waitFor(() => hasText(page, t.ask), 'checklist');
      await tick(page, INS);
      await clickNode(page, await button(page, t.next));
      await waitFor(async () => (await taskButton(page, INS, t.done)) === undefined && (await taskButton(page, REP, t.partial)), 'INS left the list');
      assert.equal(await pressedIn(page, REP, t.partial), true, 'REP stays pressed');
    });

    await scenarioFresh('"saved" mark: after the exit panel closes, in a page corner, about a second, no focus change', async () => {
      await exitTo(page, G);
      await workPanel(page, VAT);
      await press(page, VAT, t.done);
      const focus = () => page.evaluate(() => document.activeElement.tagName);
      await clickNode(page, await button(page, t.save));
      await waitFor(async () => !(await taskButton(page, VAT, t.done)), 'panel closed');
      const t0 = Date.now();
      await waitFor(() => hasText(page, t.saved), 'saved mark');
      // the login search reopens after the panel and puts the caret in the username field: compare only once that is done
      await waitFor(async () => (await active(page)) === 'Username', 'caret back in the username field');
      const during = await focus();
      assert.notEqual(during, 'EASYPASS-SAVED', 'the mark takes no focus');
      await waitFor(async () => !(await hasText(page, t.saved)), 'mark closes itself', 2500);
      assert.equal(await focus(), during, 'focus unchanged by the mark going away');
      const shown = Date.now() - t0;
      assert.ok(shown > 300 && shown < 2400, 'about a second: ' + shown);
      await shot(page, '17-saved');
    });

    await scenario('salyk: popup: add a task keeps pressed toggles, edit list keeps them, the saved mark closes itself', async () => {
      const mark = hostLog().length;
      const p = await popupDetail(F[0]); // list: НДС, Отчёт
      await pb(p, VAT, t.done).waitFor();
      await pb(p, REP, t.done).click();
      await p.getByRole('button', { name: t.edit, exact: true }).click();
      await p.getByRole('checkbox', { name: VAT, exact: true }).waitFor();
      await p.getByRole('button', { name: t.next, exact: true }).click();
      await pb(p, REP, t.done).waitFor();
      assert.equal(await pressed(p, REP, t.done), true, 'edit list keeps the pressed toggle');
      await p.getByRole('button', { name: t.add, exact: true }).click();
      const boxes = p.getByRole('checkbox');
      await boxes.first().waitFor();
      assert.deepEqual(await boxes.evaluateAll((l) => l.map((x) => x.parentElement.textContent)), [INS], 'only the task off the list');
      const save = p.getByRole('button', { name: t.save, exact: true }).last();
      assert.equal(await save.isDisabled(), true);
      await shot(p, '18-popup-add');
      await boxes.first().check();
      await save.click();
      await pb(p, INS, t.done).waitFor();
      assert.equal(await pressed(p, REP, t.done), true, 'add keeps the pressed toggle');
      assert.deepEqual(hostSince(mark, 'work_assign').map((x) => x.taskIds), [['t2', 't3'], ['t1', 't2', 't3']]);
      assert.equal(await p.getByRole('button', { name: t.add, exact: true }).count(), 0, 'nothing left to add');
      await saveBtn(p).click();
      const saved = p.getByText(t.saved, { exact: true });
      await saved.waitFor();
      await saved.waitFor({ state: 'detached', timeout: 2500 });
      assert.equal((await workGet(F[2], thisMonth)).statuses.t3, 'done');
      await p.close();
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

  await scenario('salyk: long task and client names wrap everywhere: nothing cut off, rows grow and never overlap, buttons stay clickable', async () => {
    const [c, w] = await browser('long', { EP_LONG_TASK: 1 });
    const LONG = ['Подготовка и сдача годового отчёта по налогу на добавленную стоимость с проверкой всех входящих счетов-фактур за год',
      'Страхование ответственности сотрудников и контроль выплат по социальным отчислениям за весь квартал и прошлый год'];
    assert.ok(LONG.every((x) => x.length >= 80 && x.length <= 120));
    const users = sites.states.get('salykkabinet').users;
    if (!users.some((u) => u.username === D[0])) users.push({ first: 'X', last: 'Y', org: D[3], username: D[0], password: D[1] });
    sites.states.get('salykkabinet').sessions.clear();
    try {
      const p = await c.newPage();
      await p.goto(sp('/account/login'));
      // the login panel's rows: long client names
      await waitFor(async () => (await options(p)).length > 1, 'login search rows');
      const rows = await Promise.all((await options(p)).filter((n) => n.name.includes('Гульнара')).map((n) => probe(p, n)));
      assertStacked(rows, 'login search');
      assert.ok(rows.every((r) => r.bottom - r.top > 44), 'the long name made the rows taller');

      // exit panel: customer with t1 + the long t2; the long t3 is addable
      await signIn(p, A);
      await load(p, () => p.click('a.btn-light-primary'));
      await load(p, () => p.click('#logout'));
      const group = (name) => waitFor(async () => (await ax(p)).find((n) => n.role === 'group' && n.name === name), name.slice(0, 20));
      const [short, long] = [await group(INS), await group(LONG[0])];
      const [boxShort, boxLong] = [await probe(p, short), await probe(p, long)];
      assertStacked([boxShort, boxLong].map((b) => ({ ...b })), 'exit panel rows');
      assert.ok(boxLong.bottom - boxLong.top > boxShort.bottom - boxShort.top + 10, 'the long name takes more lines, the row grew');
      const dialog = (await ax(p)).find((n) => n.role === 'dialog' && n.name.includes('Гульнара'));
      const heading = (await ax(p)).find((n) => n.role === 'heading' && n.name.includes('Гульнара'));
      assert.ok(!(await probe(p, heading)).cut, 'client name in the title is whole');
      assert.ok((await probe(p, dialog)).bottom <= (await p.evaluate(() => innerHeight)), 'the modal fits the window');
      await press(p, LONG[0], t.done);
      assert.equal((await taskButton(p, LONG[0], t.done)).pressed, true, 'the status button of the long row works');
      await shot(p, '20-long-names-panel');
      await clickNode(p, await button(p, t.add));
      const overlayBox = await waitFor(async () => (await ax(p)).find((n) => n.role === 'checkbox' && n.name === LONG[1]), 'add overlay');
      const overlayRow = await probe(p, overlayBox, 'label');
      assert.ok(!overlayRow.cut && overlayRow.bottom - overlayRow.top > 40, 'add overlay: the long task wraps inside its row');
      await shot(p, '21-long-names-add');
      await clickNode(p, (await ax(p)).filter((n) => n.role === 'button' && n.name === t.close).at(-1));
      await clickNode(p, await button(p, t.close));
      await waitFor(async () => (await stateIn(w)) === null, 'session finished');

      // checklist of a customer without a list
      sites.states.get('salykkabinet').sessions.clear();
      await signIn(p, D);
      await load(p, () => p.click('a.btn-light-primary'));
      await load(p, () => p.click('#logout'));
      await waitFor(() => hasText(p, t.ask), 'checklist');
      const checks = (await ax(p)).filter((n) => n.role === 'checkbox' && n.name);
      assert.equal(checks.length, 3);
      assertStacked(await Promise.all(checks.map((n) => probe(p, n, 'label'))), 'checklist rows');
      await shot(p, '22-long-names-checklist');
      await clickNode(p, await button(p, t.close));

      // the toolbar popup
      const pop = await c.newPage();
      await pop.goto(`chrome-extension://${ID}/popup.html`);
      await pop.fill('#q', 'Абдыкадырова');
      await pop.locator('#list .opt').first().waitFor();
      assertStacked(await probeAll(pop, '#list .opt'), 'popup list');
      await pop.fill('#q', A[0]);
      await pop.locator('#list .opt', { hasText: A[0] }).click();
      await pop.waitForSelector('#detail:not([hidden])');
      const pbtn = (page, task, name) => page.getByRole('button', { name: `${task}: ${name}`, exact: true });
      await pbtn(pop, LONG[0], t.done).waitFor();
      assertStacked(await probeAll(pop, '#name'), 'popup title');
      assertStacked(await probeAll(pop, '.wrow'), 'popup task rows');
      await pbtn(pop, LONG[0], t.done).click();
      assert.equal(await pbtn(pop, LONG[0], t.done).getAttribute('aria-pressed'), 'true', "popup: the long row's button works");
      await shot(pop, '23-long-names-popup');
      await pop.getByRole('button', { name: t.add, exact: true }).click();
      await pop.locator('.over .check').first().waitFor();
      assertStacked(await probeAll(pop, '.over .check'), 'popup add overlay');
      assert.ok((await probeAll(pop, '.obox'))[0].bottom <= (await pop.evaluate(() => innerHeight)), 'the popup overlay fits the window');
      await pop.close();
      const pop2 = await c.newPage();
      await pop2.goto(`chrome-extension://${ID}/popup.html`);
      await pop2.fill('#q', D[0]);
      await pop2.locator('#list .opt', { hasText: D[0] }).click();
      await pop2.locator('.checks .check').first().waitFor();
      assertStacked(await probeAll(pop2, '.checks .check'), 'popup checklist rows');
      await shot(pop2, '24-long-names-popup-checklist');
    } finally {
      await c.close();
      sites.states.get('salykkabinet').sessions.clear();
    }
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

  await oneClick(browser, { t, SY, sp, A, B, C, INS, stateIn, hostSince, load, signIn, press, workPanel });
}

// Spec §14: the sign-in button of the program, items 3-8. The app's part is the planted request and the #easypass-login address.
async function oneClick(browser, { t, SY, sp, A, B, C, INS, stateIn, hostSince, load, signIn, press, workPanel }) {
  const lang = Object.keys(T).find((k) => T[k] === t);
  const st = sites.states.get('salykkabinet');
  const MARK = '#easypass-login';
  const [ctx, sw] = await browser('oneclick', { EP_LOCK: path.join(tmp, 'oc-locked-' + lang) });
  const lockFile = path.join(tmp, 'oc-locked-' + lang);
  const plant = (entryId, site = SY, ageMs = 0, w = sw) => w.evaluate(([e, s, a]) => ask({ cmd: '__plant_login', entryId: e, site: s, ageMs: a }), [entryId, site, ageMs]);
  const session = () => stateIn(sw);
  const waiting = () => sw.evaluate(() => chrome.storage.local.get('salykSwitch').then((r) => r.salykSwitch ?? null));
  const isOpen = (entryId, w = sw) => waitFor(async () => { const s = await stateIn(w); return s?.state === 'open' && s.entryId === entryId; }, `session open for ${entryId}`);
  const logins = () => [...st.sessions.values()];
  const stateLog = (mark) => hostSince(mark, 'session_state').map((r) => r.entryId);
  // The browser opening the address the program gives it: a new tab, which the extension may close while it loads.
  const fromApp = async (url) => {
    const p = await ctx.newPage();
    await p.goto(url).catch(() => {});
    return p;
  };
  // keep() reports after the session is stored, and the program must know A before a press may switch away from A.
  const told = (entryId, w = sw) => waitFor(() => w.evaluate(() => chrome.storage.local.get('salykSent').then((r) => r.salykSent?.entryId)).then((e) => e === entryId), 'the host told who is open');
  // A customer signed in by hand, inside the account.
  const inside = async (who, page) => {
    const p = page || await ctx.newPage();
    await signIn(p, who);
    await load(p, () => p.click('a.btn-light-primary'));
    await isOpen(who[2]);
    await told(who[2]);
    return p;
  };
  const activeTabUrl = () => sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0]?.url);
  const fresh = (name, fn) => scenario('one click: ' + name, async () => {
    await sw.evaluate(() => chrome.storage.local.remove(['salyk', 'salykSwitch', 'salykSent']));
    await sw.evaluate(() => { logoutWait = 400; });
    st.sessions.clear();
    st.half.clear();
    st.stuck = false;
    st.posts = st.logouts = 0;
    fs.rmSync(lockFile, { force: true });
    for (const p of ctx.pages().slice(1)) await p.close();
    try {
      await fn();
    } finally {
      st.stuck = false; // the scenarios after these do not reset it
    }
  });
  const empty = (p) => p.evaluate(() => [document.getElementById('Username').value, document.getElementById('Password').value].join(''));

  try {
    await fresh('fresh sign-in: marker gone, filled, submitted, organization pressed, name read, session open, session_state seen', async () => {
      const mark = hostLog().length;
      await plant(A[2]);
      const p = await fromApp(sp('/account/login' + MARK));
      await isOpen(A[2]);
      assert.ok(!p.url().includes('easypass-login'), 'marker left in the address: ' + p.url());
      assert.equal(new URL(p.url()).pathname, '/', 'inside the account');
      assert.deepEqual(logins(), [A[0]]);
      assert.equal(st.posts, 1, 'one submit');
      assert.equal(hostSince(mark, 'login_take').length, 1);
      assert.equal(hostSince(mark, 'get').length, 1);
      const [check] = hostSince(mark, 'check');
      assert.deepEqual([check.username, check.password, check.entryId], [A[0], A[1], A[2]], 'session attempt with the real fill');
      const [name] = hostSince(mark, 'set_name');
      assert.equal(name?.text, A[3], 'name captured');
      await waitFor(() => stateLog(mark).includes(A[2]), 'session_state open');
      assert.equal(hostSince(mark, 'session_state')[0].site, SY);
      // the exit panel works as after a manual sign-in
      await load(p, () => p.click('#logout'));
      await workPanel(p);
      await waitFor(() => stateLog(mark).at(-1) === null, 'session_state closed');
      const stored = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
      assert.ok(!stored.includes(A[1]) && !stored.includes(A[0]), 'password or login in storage');
    });

    await fresh('the real pages: 17-digit login in the number field, input and change sent, the button of the password form, never the language forms; the name read', async () => {
      const mark = hostLog().length;
      await plant(C[2]);
      const p = await ctx.newPage();
      const posts = [];
      p.on('request', (r) => { if (r.method() === 'POST') posts.push([new URL(r.url()).pathname, new URLSearchParams(r.postData())]); });
      await p.goto(sp('/account/login' + MARK));
      await isOpen(C[2]);
      assert.deepEqual(posts.map(([where]) => where), ['/account/login'], 'one POST, to the login form');
      assert.equal(st.languagePosts ?? 0, 0);
      assert.equal(posts[0][1].get('Username'), C[0], 'the 17 digits as they are');
      assert.equal(posts[0][1].get('Password'), C[1]);
      const events = (await p.evaluate(() => sessionStorage.getItem('events'))).split('\n').slice(0, -1);
      assert.deepEqual(events, [`input Username ${C[0]}`, `change Username ${C[0]}`, 'input Password ', 'change Password ']);
      assert.equal(hostSince(mark, 'set_name')[0]?.text, C[3], 'name read on the organization page');
      assert.match(await p.title(), /Главная/);
    });

    await fresh('a real click on the logout picture, which has no text, is seen as the logout; below md the switch still finds the hidden link', async () => {
      const a = await inside(A);
      st.stuck = true; // no login page after it: only the click can have closed the session
      await load(a, () => a.click('#logout svg'));
      await workPanel(a);
      assert.equal((await session()).state, 'closed');
      await clickNode(a, await button(a, t.close));
      st.stuck = false;
      st.sessions.clear();
      await a.setViewportSize({ width: 500, height: 800 });
      await inside(A, a);
      assert.equal(await a.locator('#logout').isVisible(), false, 'the picture is hidden at this width');
      await plant(B[2]);
      await fromApp(sp('/account/login' + MARK));
      await workPanel(a);
      assert.equal(st.logouts, 2);
      await clickNode(a, await button(a, t.close));
      await isOpen(B[2]);
    });

    await fresh('a page without the marker asks the host nothing; a marker set later by a page script does nothing', async () => {
      const p = await ctx.newPage();
      const mark = hostLog().length;
      await p.goto(sp('/account/forgotpassword'));
      await sleep(300);
      assert.deepEqual(hostLog().slice(mark), [], 'idle page reached the host');
      await p.goto(sp('/account/login'));
      await sleep(200);
      assert.equal(hostSince(mark, 'login_take').length, 0);
      await plant(A[2]);
      await p.evaluate(() => { location.hash = '#easypass-login'; });
      await sleep(300);
      assert.equal(hostSince(mark, 'login_take').length, 0, 'hash set after load');
      assert.equal(hostSince(mark, 'get').length, 0);
      await plant(B[2], 'nothing.test'); // uses up the request above for the scenarios after this one
    });

    await fresh('a page cannot call the commands: no chrome.runtime in the page, the background refuses them from anything but the top-frame content script', async () => {
      const p = await ctx.newPage();
      await p.goto(sp('/account/login'));
      assert.equal(await p.evaluate(() => typeof globalThis.chrome?.runtime?.sendMessage), 'undefined', 'page has no way to message the extension');
      const mark = hostLog().length;
      for (const u of [sp('/account/login'), base + '/login']) {
        for (const cmd of ['login_take', 'session_state', 'login_start', '__plant_login']) {
          const r = await sw.evaluate(([c, x]) => handle({ cmd: c, entryId: 'e9' }, 1, new URL(x)), [cmd, u]);
          assert.deepEqual(r, { ok: false, error: 'bad_request' }, cmd);
        }
      }
      assert.deepEqual(hostLog().slice(mark).filter((r) => ['login_take', 'session_state', 'login_start', '__plant_login'].includes(r.cmd)).length, 0, 'reached the host');
    });

    await fresh('expired request, no request, another site\'s request: nothing filled, nothing submitted', async () => {
      let p;
      for (const [name, set] of [['expired', () => plant(A[2], SY, 130_000)], ['none', async () => {}], ['other site', () => plant('e1', 'portal-x.test')]]) {
        const mark = hostLog().length;
        await set();
        p = await ctx.newPage(); // a new tab, as from the program: the same address in an open tab would not even reload
        await p.goto(sp('/account/login' + MARK));
        await waitFor(() => hostSince(mark, 'login_take').length, 'asked: ' + name);
        await sleep(200);
        assert.equal(await empty(p), '', 'filled: ' + name);
        assert.equal(hostSince(mark, 'get').length, 0, 'get: ' + name);
        assert.equal(st.posts, 0, 'submitted: ' + name);
        assert.ok(!p.url().includes('easypass-login'), 'marker: ' + name);
      }
      await waitFor(async () => (await options(p)).length, 'the login search still opens');
      // the other site's request was not used up, and that site gets it
      const q = await fromApp(base + '/login' + MARK);
      await waitFor(() => q.url().endsWith('/') || q.url().endsWith('/login'), 'loaded');
      await waitFor(async () => hostLog().some((r) => r.cmd === 'check' && r.username === 'ahmet.yilmaz'), 'used by its own site');
    });

    await fresh('wrong password: one submit, stays on the login page, no second try, no auto-press later', async () => {
      const u = st.find(A[0]);
      const real = u.password;
      u.password = 'changed-on-the-site';
      try {
        const mark = hostLog().length;
        await plant(A[2]);
        const p = await fromApp(sp('/account/login' + MARK));
        await waitFor(() => p.locator('#error').count(), 'site says wrong password');
        await sleep(400);
        assert.equal(st.posts, 1, 'submitted once');
        assert.equal(hostSince(mark, 'get').length, 1, 'filled once');
        assert.ok(!(await session())?.auto, 'automatic flow over');
        assert.deepEqual(logins(), []);
        // the user types the right one: this sign-in is theirs, "Войти" stays theirs too
        u.password = real;
        await signIn(p, A);
        await sleep(300);
        assert.match(p.url(), /selectorganization/, 'a manual sign-in is not pressed');
      } finally {
        u.password = real;
      }
    });

    await fresh('many rows: exactly one match is pressed; no match stops on the page for the user', async () => {
      await plant(C[2]);
      const p = await fromApp(sp('/account/login?multi=1' + MARK));
      await isOpen(C[2]);
      assert.equal(new URL(p.url()).pathname, '/');
      await p.close();
      st.sessions.clear();
      await sw.evaluate(() => chrome.storage.local.remove(['salyk', 'salykSent']));
      await plant(A[2]);
      const q = await fromApp(sp('/account/login?multi=1' + MARK));
      await waitFor(() => /selectorganization/.test(q.url()), 'organization page');
      await sleep(400);
      assert.match(q.url(), /selectorganization/, 'stays for the user');
      assert.deepEqual(logins(), []);
      assert.equal((await session()).state, 'attempt');
      await load(q, () => q.locator('a.btn-light-primary').first().click());
      await isOpen(A[2]); // the session goes on as usual
    });

    await fresh('switch A→B, panel Save: A\'s tab in front, new tab closed, panel, Save, B signed in in the same tab', async () => {
      const a = await inside(A);
      const mark = hostLog().length;
      await plant(B[2]);
      const n = ctx.pages().length;
      const q = await fromApp(sp('/account/login' + MARK));
      await waitFor(() => q.isClosed(), 'new tab closed');
      assert.equal(ctx.pages().length, n);
      await workPanel(a);
      assert.equal(new URL(await activeTabUrl()).pathname, new URL(a.url()).pathname, 'A\'s tab in front');
      assert.ok(await hasText(a, A[0]), 'panel of A');
      const stored = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
      assert.ok(!stored.includes(B[1]) && !stored.includes(A[1]), 'password in storage');
      await press(a, INS, t.done);
      await clickNode(a, await button(a, t.save));
      await isOpen(B[2]);
      assert.equal(new URL(a.url()).pathname, '/');
      assert.deepEqual(logins(), [B[0]]);
      assert.equal(await waiting(), null, 'switch finished');
      assert.equal(hostSince(mark, 'work_save')[0].entryId, A[2], 'the Save was A\'s');
      await waitFor(() => stateLog(mark).at(-1) === B[2], 'session_state B');
      assert.deepEqual(stateLog(mark), [null, B[2]]);
    });

    await fresh('switch with panel Close: nothing saved, B signed in', async () => {
      const a = await inside(A);
      const mark = hostLog().length;
      await plant(B[2]);
      await fromApp(sp('/account/login' + MARK));
      await workPanel(a);
      await clickNode(a, await button(a, t.close));
      await isOpen(B[2]);
      assert.equal(hostSince(mark, 'work_save').length, 0);
      assert.equal(st.posts, 2, 'A by hand, B once');
    });

    await fresh('switch waits past the panel only 30 minutes: an expired one does not sign in', async () => {
      const a = await inside(A);
      await plant(B[2]);
      await fromApp(sp('/account/login' + MARK));
      await workPanel(a);
      await sw.evaluate(() => chrome.storage.local.get('salykSwitch').then((r) => chrome.storage.local.set({ salykSwitch: { ...r.salykSwitch, at: Date.now() - 31 * 60_000 } })));
      const posts = st.posts;
      await clickNode(a, await button(a, t.close));
      await sleep(500);
      assert.equal(st.posts, posts, 'not submitted');
      assert.equal(await session(), null);
      assert.equal(await waiting(), null);
    });

    await fresh('the same customer: their tab in front, new tab closed, nothing filled', async () => {
      const a = await inside(A);
      const mark = hostLog().length;
      await plant(A[2]);
      const q = await fromApp(sp('/account/login' + MARK));
      await waitFor(() => q.isClosed(), 'new tab closed');
      await sleep(200);
      assert.equal(new URL(await activeTabUrl()).pathname, new URL(a.url()).pathname);
      assert.equal(hostSince(mark, 'get').length, 0);
      assert.equal((await session()).state, 'open');
      assert.equal(await waiting(), null);
    });

    await fresh('the program does not know the open customer (locked when A signed in): no logout without its question; the next press goes on', async () => {
      const mark = hostLog().length;
      fs.writeFileSync(lockFile, '');
      const a = await ctx.newPage();
      await signIn(a, A);
      await load(a, () => a.click('a.btn-light-primary'));
      await isOpen(A[2]);
      await waitFor(() => stateLog(mark).length, 'the report refused');
      fs.rmSync(lockFile);
      await plant(B[2]);
      const q = await fromApp(sp('/account/login' + MARK));
      await waitFor(() => q.isClosed(), 'new tab closed');
      await told(A[2]); // the program knows now: the next press gets its question
      await sleep(300);
      assert.equal(st.logouts, 0, 'logged out without the question');
      assert.equal(new URL(a.url()).pathname, '/');
      assert.deepEqual(logins(), [A[0]]);
      assert.equal((await session()).state, 'open');
      assert.equal(await waiting(), null);
      assert.equal(hostSince(mark, 'get').length, 0);
      await plant(B[2]);
      await fromApp(sp('/account/login' + MARK));
      await workPanel(a);
      await clickNode(a, await button(a, t.close));
      await isOpen(B[2]);
    });

    await fresh('a waiting switch, the panel answered on a page inside another account: the tab stays there, the switch ends', async () => {
      const a = await inside(A);
      await plant(B[2]);
      await fromApp(sp('/account/login' + MARK));
      await workPanel(a);
      // by hand, under the panel, as another customer
      await load(a, () => a.evaluate(([u, p]) => { document.getElementById('Username').value = u; document.getElementById('Password').value = p; document.querySelector('form[action^="/account/login"] button[type=submit]').click(); }, C));
      await load(a, () => a.evaluate(() => document.querySelector('a.btn-light-primary').click()));
      await workPanel(a);
      assert.ok(await waiting());
      await clickNode(a, await button(a, t.close));
      await waitFor(async () => (await waiting()) === null, 'switch ended');
      await sleep(300);
      assert.equal(new URL(a.url()).pathname, '/', 'sent away from the page');
      assert.deepEqual(logins(), [C[0]]);
    });

    await fresh('open session, its tab gone: the new tab asks about the old customer, then signs in', async () => {
      const a = await inside(A);
      await a.close();
      await plant(B[2]);
      const q = await fromApp(sp('/account/login' + MARK));
      await workPanel(q);
      assert.ok(await hasText(q, A[0]), 'panel of A');
      await clickNode(q, await button(q, t.close));
      await isOpen(B[2]);
      assert.equal(new URL(q.url()).pathname, '/');
    });

    await fresh('no logout link: goes to /account/logout, panel, then B', async () => {
      const a = await inside(A);
      await a.goto(sp('/?nolink=1'));
      await plant(B[2]);
      await fromApp(sp('/account/login' + MARK));
      await workPanel(a);
      assert.equal(st.logouts, 1);
      await clickNode(a, await button(a, t.close));
      await isOpen(B[2]);
    });

    await fresh('logging out leaves the tab signed in: short message, state cleared, no loop', async () => {
      const a = await inside(A);
      await a.goto(sp('/?nolink=1'));
      st.stuck = true;
      await plant(B[2]);
      const q = await fromApp(sp('/account/login' + MARK));
      await waitFor(() => q.isClosed(), 'new tab closed');
      await waitFor(() => hasText(a, t.logoutFailed), 'message');
      assert.equal(await waiting(), null, 'switch cleared');
      await sleep(600);
      assert.equal(st.logouts, 1, 'not tried again');
      assert.equal((await session()).entryId, A[2], 'A still open');
      assert.ok(!(await hasText(a, A[0] + ' ')), 'no panel');
    });

    await fresh('the tab with a waiting switch closed: the switch is dropped', async () => {
      const a = await inside(A);
      await plant(B[2]);
      await fromApp(sp('/account/login' + MARK));
      await workPanel(a);
      assert.ok(await waiting());
      await a.close();
      await waitFor(async () => (await waiting()) === null, 'switch dropped');
    });

    await fresh('session_state answered locked blocks nothing; the next change tells the host', async () => {
      const a = await inside(A);
      const mark = hostLog().length;
      fs.writeFileSync(lockFile, '');
      await load(a, () => a.click('#logout'));
      await waitFor(() => hasText(a, t.locked), 'panel says locked');
      await waitFor(() => hostSince(mark, 'session_state').length === 1, 'tried');
      await clickNode(a, await button(a, t.close));
      fs.rmSync(lockFile);
      await inside(B, a);
      await waitFor(() => stateLog(mark).at(-1) === B[2], 'B reported');
    });
  } finally {
    await ctx.close();
  }

  // In its own browser: Playwright's handle on the stopped worker never answers again.
  await scenario('one click: worker restart mid-switch: Close still goes on to B', async () => {
    const [c, w] = await browser('oc-restart', {});
    st.sessions.clear();
    try {
      const a = await c.newPage();
      await signIn(a, A);
      await load(a, () => a.click('a.btn-light-primary'));
      await isOpen(A[2], w);
      await told(A[2], w);
      await plant(B[2], SY, 0, w);
      const q = await c.newPage();
      await q.goto(sp('/account/login' + MARK)).catch(() => {});
      await workPanel(a);
      // Target.closeTarget leaves a worker running, and Playwright keeps a stopped one in serviceWorkers(): only the target list tells.
      const cdp = await c.newCDPSession(a);
      await cdp.send('ServiceWorker.enable');
      await cdp.send('ServiceWorker.stopAllWorkers');
      await waitFor(async () => !(await cdp.send('Target.getTargets')).targetInfos.some((x) => x.type === 'service_worker' && x.url.includes(ID)), 'the worker stopped');
      await clickNode(a, await button(a, t.close));
      await waitFor(() => [...st.sessions.values()].includes(B[0]) && new URL(a.url()).pathname === '/', 'B signed in', 6000);
    } finally {
      await c.close();
    }
    st.sessions.clear();
  });

  await scenario('one click: no tasks defined: the hint path goes on to B too', async () => {
    const [c, w] = await browser('oc-notasks', { EP_NO_TASKS: 1 });
    st.sessions.clear();
    try {
      const a = await c.newPage();
      await signIn(a, A);
      await load(a, () => a.click('a.btn-light-primary'));
      await isOpen(A[2], w);
      await told(A[2], w);
      await plant(B[2], SY, 0, w);
      const q = await c.newPage();
      await q.goto(sp('/account/login' + MARK)).catch(() => {});
      await isOpen(B[2], w);
      assert.deepEqual([...st.sessions.values()], [B[0]]);
    } finally {
      await c.close();
    }
    st.sessions.clear();
  });

  await scenario('one click: other sites: filled and submitted with no session or panel; a late form within 5 s too; sign-up, late and http pages not', async () => {
    const [c, w] = await browser('oc-other', {});
    try {
      const open = async (url, entryId, site = 'portal-x.test') => {
        await plant(entryId, site, 0, w);
        const p = await c.newPage();
        const posts = [];
        p.on('request', (r) => { if (r.method() === 'POST') posts.push(r.postData()); });
        await p.goto(url).catch(() => {});
        return [p, posts];
      };
      let mark = hostLog().length;
      const [p, posts] = await open(base + '/login' + MARK, 'e1');
      await waitFor(() => posts.length, 'submitted');
      await sleep(300);
      assert.deepEqual(posts, ['user=ahmet.yilmaz&pass=eski123'], 'one submit with the real fill');
      assert.ok(!p.url().includes('easypass-login'));
      assert.equal(hostSince(mark, 'check').length, 1, 'the usual check');
      assert.equal(await stateIn(w), null, 'no session');
      assert.equal(hostSince(mark, 'session_state').length, 0);
      await p.close();

      const [late, latePosts] = await open(base + '/late-form' + MARK, 'e2');
      await waitFor(() => latePosts.length, 'late form submitted', 4000);
      assert.deepEqual(latePosts, ['user=akaya&pass=kaya999']);
      await waitFor(() => new URL(late.url()).pathname === '/', 'the POST answered'); // closing a tab in the middle of its POST hangs headless Chrome
      await late.close();

      const [decoy, decoyPosts] = await open(base + '/decoy-button' + MARK, 'e1');
      await waitFor(() => decoyPosts.length, 'the real submit button pressed, not the button before it');
      await waitFor(() => new URL(decoy.url()).pathname === '/', 'the POST answered');
      await decoy.close();

      const [signup, signupPosts] = await open(base + '/signup' + MARK, 'e2');
      await sleep(400);
      assert.equal(await signup.inputValue('#pass'), '', 'a form with two passwords is not a login');
      assert.deepEqual(signupPosts, []);
      await signup.close();

      mark = hostLog().length;
      const [insecure, insecurePosts] = await open(at('portal-x.test', plain) + '/login' + MARK, 'e2');
      await sleep(300);
      assert.equal(await insecure.inputValue('#pass'), '', 'http page filled');
      assert.deepEqual(insecurePosts, []);
      assert.equal(hostSince(mark, 'login_take').length, 0, 'http page asked the host');
      assert.equal(hostSince(mark, 'get').length, 0);
      await insecure.close();
      await w.evaluate(() => ask({ cmd: 'login_take', site: 'portal-x.test' })); // the request the http page left

      if (lang === 'ru') { // one slow case, one language
        const [slow, slowPosts] = await open(base + '/too-late' + MARK, 'e2');
        await waitFor(() => slow.locator('#user').isVisible(), 'form appeared', 7000);
        await sleep(300);
        assert.equal(await slow.inputValue('#pass'), '', 'filled after the 5 s');
        assert.deepEqual(slowPosts, []);
        await slow.close();
      }
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
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0); // a timed-out scenario leaves its browser open
