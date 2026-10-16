// Windows end-to-end run: real installed EasyPass.Host.exe + a throwaway test vault + five local customer portals,
// in a visible Chrome for Testing window with this extension folder loaded. The user's own Chrome and vault are untouched.
// Prerequisite: scripts/install.ps1 has run (host registered). Usage: cd extension/test && npm install && node e2e-windows.mjs
// --open: after the run, leave the browser (one tab per site) and the test EasyPass app open for trying things by hand.
// --headless: no visible window (e.g. while someone works on the machine; screenshots are taken all the same).
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITES, startSites } from './sites.mjs';
import { prepareHome } from './test-vault.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, '..');
const ID = 'coikeomihlacdkjplpedddjmnkfobaon';
const local = process.env.LOCALAPPDATA;
// the installed EasyPass (scripts/install.ps1 or the setup); EASYPASS_DIR points at another build, e.g. a fresh publish
const installed = process.env.EASYPASS_DIR || path.join(local, 'EasyPass');
const home = path.join(local, 'EasyPass-e2e'); // EASYPASS_HOME of the test vault, the browser and the test app
const out = path.join(here, 'test-results', 'e2e-windows');
const keepOpen = process.argv.includes('--open');
const headless = process.argv.includes('--headless') && !keepOpen;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const cache = path.join(local, 'ms-playwright');
const newest = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
const exe = process.env.CHROME || path.join(cache, newest, 'chrome-win64', 'chrome.exe');

// Branded Chrome reads HKCU\Software\Google\Chrome (install.ps1); test builds may read their own key. Same manifest.
for (const product of ['Chromium', 'Google\\Chrome for Testing']) {
  execFileSync('reg', ['add', `HKCU\\Software\\${product}\\NativeMessagingHosts\\com.easypass.host`, '/ve', '/d',
    path.join(installed, 'com.easypass.host.json'), '/f'], { stdio: 'ignore' });
}

// New users signed up during the run, one per site; their password is changed later to `${password}-v2`.
const NEWCOMERS = {
  'hizlikargo.test': { first: 'Kerem', last: 'Aksoy', username: 'kerem.aksoy', password: 'Yeni-Kargo-1' },
  'efatura.test': { first: 'Leyla', last: 'Toprak', username: 'leyla@topraktarim.example', password: 'Yeni-Fatura-1' },
  'demobank.test': { first: 'Okan', last: 'Güler', username: '10058821', password: 'Yeni-Bank-1' },
  'guvensigorta.test': { first: 'Nur', last: 'Akın', username: '34567890123', password: 'Yeni-Sigorta-1' },
  'defteronline.test': { first: 'Emre', last: 'Taş', username: 'emre@tasyapi.example', password: 'Yeni-Defter-1' },
};

// no master password and no key cache: the host has to open the vault from the file alone
const vault = prepareHome(home, SITES, '', 'tr');
const sites = await startSites({ certDir: home });
const hostEntries = (host) => vault.readEntries().filter((e) => e.site === host);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout: ' + what);
    await sleep(25);
  }
}

// The panel and prompts live in a closed shadow root: read them through the accessibility tree, like a screen reader.
async function ax(page) {
  page.cdp ??= await page.context().newCDPSession(page);
  const { nodes } = await page.cdp.send('Accessibility.getFullAXTree');
  const prop = (n, name) => n.properties?.find((p) => p.name === name)?.value.value;
  return nodes.filter((n) => !n.ignored).map((n) => ({
    role: n.role?.value, name: n.name?.value || '', node: n.backendDOMNodeId,
    focused: !!prop(n, 'focused'), expanded: !!prop(n, 'expanded'), pressed: prop(n, 'pressed') === 'true', value: n.value?.value,
  }));
}
const options = async (page) => (await ax(page)).filter((n) => n.role === 'option');
const hasText = async (page, s) => (await ax(page)).some((n) => n.name.includes(s));
async function center(page, node) {
  const { model } = await page.cdp.send('DOM.getBoxModel', { backendNodeId: node.node });
  const [x1, y1, , , x3, y3] = model.content;
  return { x: (x1 + x3) / 2, y: (y1 + y3) / 2 };
}
async function clickNode(page, node) {
  assert.ok(node, 'node to click exists');
  const { x, y } = await center(page, node);
  await page.mouse.click(x, y);
}
const find = async (page, role, name) => (await ax(page)).find((n) => n.role === role && n.name === name);
const EYE = 'Şifreyi göster';
// Buttons named `name` (our key "EasyPass", or an eye: ours or the site's, same name) inside the field's box.
async function iconsIn(page, selector, name = 'EasyPass') {
  const f = await page.locator(selector).boundingBox();
  const found = [];
  for (const n of f ? (await ax(page)).filter((x) => x.role === 'button' && x.name === name) : []) {
    const { x, y } = await center(page, n);
    if (x > f.x && x < f.x + f.width && y > f.y && y < f.y + f.height) found.push({ x, y, expanded: n.expanded, pressed: n.pressed });
  }
  return found;
}
const iconIn = async (page, selector, name) => (await iconsIn(page, selector, name))[0] ?? null;
// Opens the panel the way a user does, with a click in the username field (it stays open if it already is),
// and empties that field: the caret stays there, and what the test types next narrows the full list.
async function openPanel(page, selector = '#user') {
  await page.click(selector);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  return waitFor(async () => { const o = await options(page); return o.length && o; }, 'panel options');
}
const opened = (page) => waitFor(async () => (await ax(page)).some((n) => n.role === 'combobox'), 'panel opened by itself');
const active = (page) => page.evaluate(() => document.activeElement.id || document.activeElement.localName);
// Type a name in the username field, pick the single hit with ↓ and fill it with Enter.
async function fillFromPanel(page, text, fullName) {
  await openPanel(page);
  await page.keyboard.type(text);
  await waitFor(async () => { const o = await options(page); return o.length === 1 && o[0].name.startsWith(fullName); }, `one hit "${fullName}"`);
  await page.keyboard.press('ArrowDown'); // typing in the field selects nothing until ↓
  await page.keyboard.press('Enter');
}

const results = [];
async function scenario(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`PASS  ${name}  (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push(`FAIL  ${name}\n      ${e.message.split('\n').slice(0, 8).join(' ')}`);
  }
  console.log(results.at(-1));
}

const ctx = await chromium.launchPersistentContext(path.join(home, 'chrome-profile'), {
  executablePath: exe, headless, slowMo: headless ? 0 : 60, viewport: { width: 1280, height: 800 },
  env: { ...process.env, EASYPASS_HOME: home }, // the host Chrome starts inherits it → opens the test vault
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP *.test 127.0.0.1',
    '--ignore-certificate-errors', '--no-first-run', '--no-default-browser-check'],
});
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
const total = SITES.reduce((n, s) => n + s.users.length, 0);

try {
  await scenario(`popup: "Bağlı · ${total} müşteri" (gerçek host, test kasası)`, async () => {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${ID}/popup.html`);
    await waitFor(async () => (await p.textContent('#status')) === `Bağlı · ${total} müşteri`, 'popup status');
    await p.close();
  });

  for (const [i, site] of SITES.entries()) {
    const n = i + 1;
    const tag = `${n}-${site.host.split('.')[0]}`;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    // /login and /logout land on the login page, which opens the panel by itself
    const go = async (p) => {
      await page.goto(sites.url(site.host, p));
      if (p === '/login' || p === '/logout') await opened(page);
    };
    const seed = site.users[0];
    const neu = NEWCOMERS[site.host];
    const name = (u) => `${u.first} ${u.last}`;
    const shown = Math.min(site.users.length, 5);
    console.log(`--- ${site.name} (${site.host})${site.spa ? ' · SPA' : ''}${site.ownEye ? ' · kendi göz düğmesi: ' + site.ownEye : ''} ---`);

    await scenario(`${site.name}: giriş sayfası açılınca panel kendiliğinden açık, ${shown}/${site.users.length} müşteri, yalnız bu site`, async () => {
      await go('/login');
      const opts = await waitFor(async () => { const o = await options(page); return o.length && o; }, 'panel options');
      assert.equal(opts.length, shown, opts.map((o) => o.name).join(' | '));
      for (const o of opts) assert.ok(site.users.some((u) => o.name.startsWith(name(u))), 'foreign entry ' + o.name);
      await waitFor(async () => (await active(page)) === 'user', 'caret in the username field, ready to type');
      assert.ok(!(await find(page, 'combobox', 'Müşteri ara'))?.focused, 'the panel does not take the caret');
      await shot(page, `${tag}-a-panel-kendiliginden`);
      for (const u of site.users.filter((u) => !opts.some((o) => o.name.startsWith(name(u))))) {
        await page.keyboard.type(u.first.toLocaleLowerCase('tr'));
        await waitFor(async () => { const o = await options(page); return o.length === 1 && o[0].name.startsWith(name(u)); }, `typing finds ${name(u)}`);
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Backspace');
      }
    });

    await scenario(`${site.name}: sayfada başka yere tıkla → panel kapanır; kullanıcı adına tıkla → sağda yeniden açılır`, async () => {
      await page.click('h1');
      await waitFor(async () => (await options(page)).length === 0, 'panel closed by a click elsewhere');
      await page.click('#user');
      await waitFor(async () => (await options(page)).length === shown, 'panel reopened by the username click');
      assert.equal(await active(page), 'user', 'caret stays in the username field');
      await shot(page, `${tag}-a1-tiklayinca-yeniden`);
    });

    await scenario(`${site.name}: kullanıcı adına elle yazılır (kasada olmayan biri) → liste "Sonuç yok", yazı alanda kalır`, async () => {
      await page.keyboard.type('elle.yazilan');
      await waitFor(async () => (await hasText(page, 'Sonuç yok')) && !(await options(page)).length, 'no match listed');
      assert.equal(await page.inputValue('#user'), 'elle.yazilan', 'typed into the page field');
      await shot(page, `${tag}-a3-elle-yazma`);
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
    });

    await scenario(`${site.name}: "${seed.first}" seç → doldur`, async () => {
      await fillFromPanel(page, seed.first.toLocaleLowerCase('tr'), name(seed));
      await waitFor(async () => (await page.inputValue('#pass')) === seed.password, 'password filled');
      assert.equal(await page.inputValue('#user'), seed.username);
    });

    await scenario(site.ownEye ? `${site.name}: sitenin kendi "şifreyi göster"i var → bizim göz yok`
      : `${site.name}: şifredeki göz → şifre görünür, tekrar → gizli`, async () => {
      assert.equal(await iconIn(page, '#pass'), null, 'no key in the password field');
      if (site.ownEye) {
        await sleep(300);
        // the site's own eye button sits in the field (checkbox variant: below it); ours would make it one more
        assert.equal((await iconsIn(page, '#pass', EYE)).length, site.ownEye === 'button' ? 1 : 0, 'no EasyPass eye next to the site\'s');
        await shot(page, `${tag}-a2-sitenin-kendi-gozu`);
        return;
      }
      const eye = await waitFor(() => iconIn(page, '#pass', EYE), 'eye in #pass');
      await page.mouse.click(eye.x, eye.y);
      await waitFor(async () => (await page.getAttribute('#pass', 'type')) === 'text', 'password shown');
      await shot(page, `${tag}-a2-sifre-gorunur`);
      await page.mouse.click(eye.x, eye.y);
      await waitFor(async () => (await page.getAttribute('#pass', 'type')) === 'password', 'password hidden');
    });

    await scenario(`${site.name}: giriş başarılı (site şifreyi doğruladı)`, async () => {
      await page.click('#go');
      await page.waitForSelector('#welcome');
      assert.match(await page.textContent('#welcome'), new RegExp(name(seed)));
    });

    await scenario(`${site.name}: ilk kez üye ol → "Kaydedilsin mi?" ad/soyad dolu, formdaki her bilgi başlığıyla, gizliler kapalı → kasada`, async () => {
      await go('/logout');
      await page.click('#to-register');
      await page.fill('#fullname', name(neu));
      for (const x of site.signup) {
        if (x.type === 'select') await page.selectOption('#' + x.id, x.value);
        else await page.fill('#' + x.id, x.value);
      }
      await page.fill('#user', neu.username);
      await page.fill('#pass', neu.password);
      await page.fill('#pass2', neu.password);
      await page.click('#signup');
      await page.waitForSelector('#registered');
      await waitFor(() => hasText(page, 'Kaydedilsin mi?'), 'save prompt');
      assert.equal((await find(page, 'textbox', 'Ad'))?.value, neu.first, 'first name taken from "Ad Soyad"');
      assert.equal((await find(page, 'textbox', 'Soyad'))?.value, neu.last, 'last name taken from "Ad Soyad"');
      for (const x of site.signup) {
        assert.ok(await hasText(page, x.label), 'label listed: ' + x.label);
        assert.equal(await hasText(page, x.shown ?? x.value), !x.secret, (x.secret ? 'masked: ' : 'shown: ') + x.label);
      }
      assert.ok(!(await hasText(page, neu.password)), 'password masked');
      await shot(page, `${tag}-b-kaydet-sorusu`);
      await clickNode(page, await find(page, 'button', 'Kaydet'));
      await waitFor(async () => !(await hasText(page, 'Kaydedilsin mi?')), 'prompt closed');
      const e = hostEntries(site.host).find((x) => x.username === neu.username);
      assert.ok(e, 'entry in vault');
      assert.deepEqual([e.firstName, e.lastName, e.password], [neu.first, neu.last, neu.password]);
      // everything else the form asked for, under its labels; the login itself only in its own fields
      assert.deepEqual(e.fields.map((f) => [f.label, f.value, f.secret]),
        [['Ad Soyad', name(neu), false], ...site.signup.map((x) => [x.label, x.shown ?? x.value, !!x.secret])]);
    });

    await scenario(`${site.name}: yeni üye listede → doldur → giriş başarılı`, async () => {
      await go('/logout');
      await fillFromPanel(page, neu.first.toLocaleLowerCase('tr'), name(neu));
      await waitFor(async () => (await page.inputValue('#pass')) === neu.password, 'password filled');
      assert.equal(await page.inputValue('#user'), neu.username);
      await shot(page, `${tag}-c-yeni-uye-dolduruldu`);
      await page.click('#go');
      await page.waitForSelector('#welcome');
    });

    await scenario(`${site.name}: sitede şifre değiştir → "güncellensin mi?" → kasada güncellendi`, async () => {
      const next = neu.password + '-v2';
      await page.click('#to-account');
      await page.fill('#cur', neu.password);
      await page.fill('#new1', next);
      await page.fill('#new2', next);
      await page.click('#save');
      await page.waitForSelector('#changed');
      await waitFor(() => hasText(page, 'güncellensin mi?'), 'update prompt');
      await shot(page, `${tag}-d-guncelle-sorusu`);
      await clickNode(page, await find(page, 'button', 'Güncelle'));
      await waitFor(async () => !(await hasText(page, 'güncellensin mi?')), 'prompt closed');
      assert.equal(hostEntries(site.host).find((x) => x.username === neu.username)?.password, next);
    });

    await scenario(`${site.name}: yeni şifreyle doldur → giriş başarılı`, async () => {
      await go('/logout');
      await fillFromPanel(page, neu.first.toLocaleLowerCase('tr'), name(neu));
      await waitFor(async () => (await page.inputValue('#pass')) === neu.password + '-v2', 'new password filled');
      await page.click('#go');
      await page.waitForSelector('#welcome');
    });
  }

  await scenario('siteler arası: kargodaki yeni üye ve faturadaki Zeynep başka sitede çıkmıyor', async () => {
    const page = ctx.pages()[0];
    await page.goto(sites.url('efatura.test'));
    await opened(page);
    await openPanel(page);
    await page.keyboard.type('kerem');
    await waitFor(async () => (await hasText(page, 'Sonuç yok')) && !(await options(page)).length, 'Kerem absent on e-Fatura');
    await page.keyboard.press('Escape');
    await page.goto(sites.url('hizlikargo.test'));
    await opened(page);
    await openPanel(page);
    await page.keyboard.type('zeynep');
    await waitFor(async () => (await hasText(page, 'Sonuç yok')) && !(await options(page)).length, 'Zeynep absent on HızlıKargo');
    await shot(page, '6-siteler-arasi');
    await page.keyboard.press('Escape');
  });

  await scenario('araç çubuğu penceresi: tüm siteler listede, 10 satır görünür, detayda şifre istenince açılır', async () => {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${ID}/popup.html`);
    const rows = () => p.locator('#list .opt').count();
    await waitFor(async () => (await rows()) === total + SITES.length, 'every entry of every site');
    const shownRows = await p.evaluate(() => {
      const l = document.getElementById('list');
      return { visible: Math.round(l.clientHeight / l.querySelector('.opt').offsetHeight), scrolls: l.scrollHeight > l.clientHeight };
    });
    assert.deepEqual(shownRows, { visible: 10, scrolls: true }, '10 rows, the rest scrolls');
    await p.locator('body').screenshot({ path: path.join(out, '7a-pencere-liste.png') });
    await p.keyboard.type('ahmet');
    await waitFor(async () => (await rows()) === 2, 'Ahmet Yılmaz on HızlıKargo and e-Fatura');
    await p.locator('#list .opt', { hasText: 'hizlikargo.test' }).click();
    await p.waitForSelector('#detail:not([hidden])');
    assert.ok(!(await p.textContent('#fields')).includes('Kargo-111'), 'password hidden until asked');
    await p.getByRole('button', { name: 'Göster' }).click();
    assert.ok((await p.textContent('#fields')).includes('Kargo-111'), 'password shown');
    await p.locator('body').screenshot({ path: path.join(out, '7b-pencere-detay.png') });
    await p.close();
  });

  await scenario(`kasa sonu: ${total + SITES.length} kayıt, her sitede tek yeni üye`, async () => {
    const all = vault.readEntries();
    assert.equal(all.length, total + SITES.length);
    for (const s of SITES) assert.equal(all.filter((e) => e.site === s.host && e.username === NEWCOMERS[s.host].username).length, 1, s.host);
  });
} finally {
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} geçti · ekran görüntüleri: ${out}`);
  process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
  if (keepOpen) {
    for (const p of ctx.pages()) await p.close();
    for (const s of SITES) await (await ctx.newPage()).goto(sites.url(s.host));
    // the app shows the same test vault (key.bin present → opens unlocked), so saved logins appear there too
    spawn(path.join(installed, 'EasyPass.exe'), [], { env: { ...process.env, EASYPASS_HOME: home }, detached: true, stdio: 'ignore' }).unref();
    console.log('Tarayıcı ve test EasyPass açık; kapatınca siteler de kapanır.');
    await new Promise((r) => ctx.on('close', r));
  } else {
    await ctx.close();
  }
  sites.server.close();
}
