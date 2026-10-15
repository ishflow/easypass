// End-to-end check of the unpacked extension in real Chromium with the fake native host, in Russian and Turkish.
// Usage: cd extension/test && npm install && npm test   (CHROME=/path/to/chromium to override the browser)
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
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
    connected: 'Подключено · 7 клиентов', noHost: 'Нет связи', none: 'Ничего не найдено', changed: 'Обновить в EasyPass?',
    update: 'Обновить', no: 'Нет', added: 'Сохранить?', first: 'Имя', save: 'Сохранить', search: 'Поиск клиента',
  },
  tr: {
    connected: 'Bağlı · 7 müşteri', noHost: 'Bağlantı yok', none: 'Sonuç yok', changed: 'güncellensin mi?',
    update: 'Güncelle', no: 'Hayır', added: 'Kaydedilsin mi?', first: 'Ad', save: 'Kaydet', search: 'Müşteri ara',
  },
};

const page0 = fs.readFileSync(path.join(here, 'login.html'));
const server = http.createServer((req, res) => {
  req.resume().on('end', () => res.end(page0));
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
// Two sites with different host names, both resolved to the local server by --host-resolver-rules.
const base = `http://portal-x.test:${server.address().port}`;
const baseY = `http://portal-y.test:${server.address().port}`;

// Chrome on Mac reads user-level host manifests from <user-data-dir>/NativeMessagingHosts,
// so the fake host manifest lives in the throwaway profile and nothing global is touched.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'easypass-'));
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
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP *.test 127.0.0.1'],
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
const active = (page) => page.evaluate(() => document.activeElement.id || document.activeElement.localName);
async function submitAndLoad(page, action) {
  const nav = page.waitForEvent('load');
  await action();
  await nav;
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

    const page = await ctx.newPage();
    await page.goto(base + '/login');

    await scenario('focusing username opens panel, search box focused, 5 recent entries', async () => {
      const t0 = Date.now();
      await page.click('#user');
      const opts = await waitFor(async () => { const o = await options(page); return o.length && o; }, 'panel options');
      results.push(`      click → panel with results: ${Date.now() - t0} ms (incl. CDP polling)`);
      assert.equal(await active(page), 'easypass-ui');
      const box = (await ax(page)).find((n) => n.role === 'combobox');
      assert.equal(box?.name, t.search);
      assert.ok(box.focused, 'search box focused');
      assert.equal(opts.length, 5);
      await shot(page, '1-panel-open');
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
      await clickNode(page, (await options(page)).find((x) => x.name.includes('Ahmet Yılmaz')));
      await waitFor(async () => (await page.inputValue('#pass')) === 'eski123', 'password filled');
      assert.equal(await page.inputValue('#user'), 'ahmet.yilmaz');
      assert.equal(await page.getAttribute('#user', 'data-input'), '1');
      assert.equal(await page.getAttribute('#pass', 'data-change'), '1');
      assert.equal((await options(page)).length, 0, 'panel closed');
      assert.equal(await active(page), 'user', 'focus back on field');
      await shot(page, '3-filled');
    });

    await scenario('Esc closes panel, focus returns to field, panel stays closed until refocus', async () => {
      await page.click('#pass');
      await waitFor(async () => (await options(page)).length, 'panel on password focus');
      await page.keyboard.press('Escape');
      await waitFor(async () => (await options(page)).length === 0, 'panel closed');
      assert.equal(await active(page), 'pass');
      await page.keyboard.type('x');
      assert.equal(await page.inputValue('#pass'), 'eski123x', 'typing goes into the page field');
      assert.equal((await options(page)).length, 0, 'still closed');
      await page.click('h1');
      await page.click('#pass');
      await waitFor(async () => (await options(page)).length, 'panel reopens after refocus');
      await page.keyboard.press('Escape');
    });

    await scenario('keyboard: type, ↓ ↑ ↓, Enter fills the highlighted (2nd) entry', async () => {
      await page.click('h1');
      await page.click('#user');
      await waitFor(async () => (await options(page)).length, 'panel');
      await page.keyboard.type('ahmet');
      await waitFor(async () => (await options(page)).length === 3, '3 results for ahmet');
      const second = (await options(page))[1].name;
      for (const k of ['ArrowDown', 'ArrowUp', 'ArrowDown']) await page.keyboard.press(k);
      await page.keyboard.press('Enter');
      const want = second.includes('Kaya') ? ['akaya', 'kaya999'] : second.includes('Yılmaz') ? ['ahmet.yilmaz', 'eski123'] : ['mehmet.a', 'mm111'];
      await waitFor(async () => (await page.inputValue('#pass')) === want[1], 'second item filled');
      assert.equal(await page.inputValue('#user'), want[0]);
    });

    await scenario('Turkish folding: "sukru" finds Şükrü Öztürk', async () => {
      await page.click('h1');
      await page.click('#user');
      await page.keyboard.type('sukru');
      await waitFor(async () => { const o = await options(page); return o.length === 1 && o[0].name.includes('Şükrü Öztürk'); }, 'Şükrü');
      await page.keyboard.press('Escape');
    });

    await scenario('site isolation: portal-y shows only its entries; same username fills its own password', async () => {
      const py = await ctx.newPage();
      await py.goto(baseY + '/login');
      await py.click('#user');
      const all = await waitFor(async () => { const o = await options(py); return o.length && o; }, 'panel on portal-y');
      assert.deepEqual(all.map((o) => o.name).sort(), ['Ahmet Yılmaz ahmet.yilmaz', 'Lale Host lale']);
      assert.ok(await hasText(py, 'portal-y.test'), 'site shown in panel header');
      await shot(py, '3b-site-y');
      await py.keyboard.type('ahm');
      await waitFor(async () => (await options(py)).length === 1, 'one result for ahm on portal-y');
      await py.keyboard.press('Enter');
      await waitFor(async () => (await py.inputValue('#pass')) === 'lh-pass', 'portal-y password filled');
      assert.equal(await py.inputValue('#user'), 'ahmet.yilmaz');
      const sites = (cmd) => [...new Set(hostLog().filter((r) => r.cmd === cmd).map((r) => r.site))].sort();
      assert.deepEqual(sites('search'), ['portal-x.test', 'portal-y.test'], 'every search carries the page host');
      assert.deepEqual(sites('get'), ['portal-x.test', 'portal-y.test']);
      await py.close();

      await page.click('h1');
      await page.click('#user');
      await page.keyboard.type('lale');
      await waitFor(async () => (await hasText(page, t.none)) && !(await options(page)).length, 'portal-y customer absent on portal-x');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('yılmaz');
      await waitFor(async () => (await options(page)).length === 1, 'one Ahmet Yılmaz on portal-x');
      await page.keyboard.press('Enter');
      await waitFor(async () => (await page.inputValue('#pass')) === 'eski123', 'portal-x password filled');
    });

    await scenario('no result cache: entry added by the app appears on the next keystroke while panel is open', async () => {
      await page.click('h1');
      await page.click('#user');
      await page.keyboard.type('ner');
      await waitFor(async () => (await hasText(page, t.none)) && !(await options(page)).length, 'no result for "ner"');
      fs.writeFileSync(external, JSON.stringify([{ id: 'w1', site: 'portal-x.test', firstName: 'Nermin', lastName: 'Koç', extra1: '', extra2: '', username: 'nermin', password: 'nk1', updatedAt: 99 }]));
      await page.keyboard.type('m');
      await waitFor(async () => (await options(page)).some((o) => o.name.includes('Nermin Koç')), 'Nermin appears for "nerm"');
      await shot(page, '4-external-add');
      await page.keyboard.press('Escape');
    });

    await scenario('changed password on submit → prompt on the next page → update sent to host', async () => {
      await page.click('h1');
      await page.click('#user');
      await page.keyboard.type('yılmaz');
      await waitFor(async () => (await options(page)).length === 1, 'Yılmaz');
      await page.keyboard.press('Enter');
      await waitFor(async () => (await page.inputValue('#pass')) === 'eski123', 'filled');
      await page.click('#pass');
      await waitFor(async () => (await options(page)).length, 'panel');
      await page.keyboard.press('Escape');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('yeni456');
      await submitAndLoad(page, () => page.keyboard.press('Enter')); // real form POST → new page
      await waitFor(() => hasText(page, t.changed), 'update prompt on new page');
      await shot(page, '5-update-prompt');
      await clickNode(page, await button(page, t.update));
      await waitFor(async () => hostLog().some((r) => r.cmd === 'update'), 'update sent');
      const u = hostLog().find((r) => r.cmd === 'update');
      assert.deepEqual([u.entryId, u.password], ['e1', 'yeni456']);
      await waitFor(async () => !(await hasText(page, t.changed)), 'prompt closed');
      await page.reload();
      await sleep(300);
      assert.ok(!(await hasText(page, t.changed)), 'pending cleared after answer');
    });

    await scenario('password-change form (3 fields) → prompt for the last filled entry → No dismisses', async () => {
      await page.click('#user');
      await page.keyboard.type('akaya');
      await waitFor(async () => (await options(page)).length === 1, 'akaya');
      await page.keyboard.press('Enter');
      await waitFor(async () => (await page.inputValue('#pass')) === 'kaya999', 'filled');
      await page.click('#cur');
      await page.keyboard.press('Escape');
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
      await page.keyboard.press('Escape');
      await page.keyboard.type('yeni.musteri');
      await page.click('#pass');
      await page.keyboard.press('Escape');
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

      await page.click('#user');
      await page.keyboard.type('zeynep');
      await waitFor(async () => (await options(page)).some((o) => o.name.includes('Zeynep Arslan')), 'new entry searchable');
      await page.keyboard.press('Enter');
      await waitFor(async () => (await page.inputValue('#pass')) === 'pw789', 'new entry fills');
      const checks = hostLog().filter((r) => r.cmd === 'check').length;
      await submitAndLoad(page, () => page.click('#go'));
      await waitFor(async () => hostLog().filter((r) => r.cmd === 'check').length > checks, 'second check sent');
      await sleep(500);
      assert.ok(!(await hasText(page, t.added)) && !(await hasText(page, t.changed)), 'no prompt on second submit');
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
      await p.click('#user');
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
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(results.join('\n'));
console.log(`screenshots: ${out}`);
process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
