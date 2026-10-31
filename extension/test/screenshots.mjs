// README screenshots on Windows: the installed EasyPass (or EASYPASS_DIR) with an English demo vault and the English
// demo portals (demo-sites.mjs), in Chrome for Testing at 2x. Writes docs/images/*.png; the app window shots come from
// app-shots.ps1 (also the work tabs and the reminder window, in three languages). Your own Chrome and vault are untouched. Usage: cd extension/test && node screenshots.mjs [--out <dir>]
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_SITES } from './demo-sites.mjs';
import { startSites } from './sites.mjs';
import { prepareHome } from './test-vault.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, '..');
const ID = 'coikeomihlacdkjplpedddjmnkfobaon';
const local = process.env.LOCALAPPDATA;
const installed = process.env.EASYPASS_DIR || path.join(local, 'EasyPass');
const home = path.join(local, 'EasyPass-screens'); // EASYPASS_HOME of the demo vault, the browser and the app
const outAt = process.argv.indexOf('--out');
const out = outAt > 0 ? path.resolve(process.argv[outAt + 1]) : path.resolve(here, '../../docs/images');
fs.mkdirSync(out, { recursive: true });

const cache = path.join(local, 'ms-playwright');
const newest = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
const exe = process.env.CHROME || path.join(cache, newest, 'chrome-win64', 'chrome.exe');
for (const product of ['Chromium', 'Google\\Chrome for Testing']) {
  execFileSync('reg', ['add', `HKCU\\Software\\${product}\\NativeMessagingHosts\\com.easypass.host`, '/ve', '/d',
    path.join(installed, 'com.easypass.host.json'), '/f'], { stdio: 'ignore' });
}

// the vault path shows in Settings: a shared folder rather than one with the Windows user name in it
const vaultDir = path.join(process.env.PUBLIC || home, 'Documents', 'EasyPass demo');
const TASKS = [{ id: 'task-vat', name: 'VAT return', archived: false }, { id: 'task-payroll', name: 'Payroll', archived: false },
  { id: 'task-annual', name: 'Annual report', archived: false }];
const vault = prepareHome(home, DEMO_SITES, '', 'en', vaultDir, TASKS);
const sites = await startSites({ certDir: home, sites: DEMO_SITES });
const [tax, , bank] = DEMO_SITES;
const newcomer = { first: 'Mia', last: 'Lawson', username: '70058821', password: 'Bank-Mia-44' };

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

// The panel and prompts live in a closed shadow root: read them through the accessibility tree (as e2e-windows.mjs).
async function ax(page) {
  page.cdp ??= await page.context().newCDPSession(page);
  const { nodes } = await page.cdp.send('Accessibility.getFullAXTree');
  return nodes.filter((n) => !n.ignored).map((n) => ({ role: n.role?.value, name: n.name?.value || '', node: n.backendDOMNodeId }));
}
const options = async (page) => (await ax(page)).filter((n) => n.role === 'option');
const hasText = async (page, s) => (await ax(page)).some((n) => n.name.includes(s));
const find = async (page, role, name) => (await ax(page)).find((n) => n.role === role && n.name === name);
async function box(page, node) {
  const { model } = await page.cdp.send('DOM.getBoxModel', { backendNodeId: node.node });
  const [x1, y1, , , x3, y3] = model.border;
  return { x: x1, y: y1, width: x3 - x1, height: y3 - y1 };
}
async function click(page, node) {
  const b = await box(page, node);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
// The EasyPass panel or prompt (role dialog, name EasyPass) that is showing.
const dialog = async (page) => {
  for (const n of (await ax(page)).filter((x) => x.role === 'dialog' && x.name === 'EasyPass')) {
    const b = await box(page, n).catch(() => null);
    if (b?.width) return b;
  }
  return null;
};

// A screenshot of the area around the given boxes, with some room around them.
async function shot(page, name, boxes, pad = 20) {
  const vp = page.viewportSize();
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  await page.screenshot({ path: path.join(out, `${name}.png`), clip: { x, y, width: right - x, height: bottom - y } });
  console.log('wrote', `${name}.png`);
}
const card = (page) => page.locator('main').boundingBox();
const heroHtml = (host, png) => `<!doctype html><body style="margin:0">
<div id="hero" style="padding:44px 56px 56px;background:linear-gradient(135deg,#E3F1EE 0%,#F6F5F2 60%)">
  <div style="width:1280px;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 30px 70px rgba(14,124,107,.20),0 4px 14px rgba(0,0,0,.08)">
    <div style="height:46px;display:flex;align-items:center;gap:8px;padding:0 18px;background:#F1F1F3;border-bottom:1px solid #E4E4E7">
      ${['#F87171', '#FBBF24', '#34D399'].map((c) => `<i style="width:12px;height:12px;border-radius:50%;background:${c}"></i>`).join('')}
      <div style="margin-left:18px;flex:1;max-width:520px;height:28px;border-radius:14px;background:#fff;display:flex;align-items:center;
        padding:0 14px;font:13px 'Segoe UI',system-ui,sans-serif;color:#52525B">🔒&nbsp; ${host}/login</div>
    </div>
    <img src="data:image/png;base64,${png.toString('base64')}" style="display:block;width:1280px">
  </div>
</div></body>`;

const ctx = await chromium.launchPersistentContext(path.join(home, 'chrome-profile'), {
  executablePath: exe, headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2,
  env: { ...process.env, EASYPASS_HOME: home },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP *.test 127.0.0.1',
    '--ignore-certificate-errors', '--no-first-run', '--no-default-browser-check'],
});

try {
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const opened = () => waitFor(() => dialog(page), 'panel opened by itself');

  // 1. The login page opens the panel by itself, five clients of this site listed
  await page.goto(sites.url(tax.host, '/login'));
  await opened();
  await waitFor(async () => (await options(page)).length === 5, 'five options');
  await shot(page, 'panel', [await card(page), await dialog(page)]);
  const loginPage = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 580 } });

  // 2. Typing in the username field narrows the list
  await page.keyboard.type('ol');
  await waitFor(async () => (await options(page)).length === 2, 'Olivia and Collins');
  await shot(page, 'typing', [await card(page), await dialog(page)]);

  // 3. Pick → filled; the eye shows the password
  await page.keyboard.type('i');
  await waitFor(async () => (await options(page)).length === 1, 'one hit');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitFor(async () => (await page.inputValue('#pass')) === tax.users[0].password, 'password filled');
  await click(page, (await ax(page)).filter((n) => n.role === 'button' && n.name === 'Show password').at(-1));
  await waitFor(async () => (await page.getAttribute('#pass', 'type')) === 'text', 'password shown');
  await shot(page, 'filled', [await card(page)]);

  // 4. Sign-up on the bank: the save prompt with the form's details, secrets masked
  await page.goto(sites.url(bank.host, '/register'));
  await page.fill('#fullname', `${newcomer.first} ${newcomer.last}`);
  for (const x of bank.signup) await page.fill('#' + x.id, x.value);
  await page.fill('#user', newcomer.username);
  await page.fill('#pass', newcomer.password);
  await page.fill('#pass2', newcomer.password);
  await page.click('#signup');
  await page.waitForSelector('#registered');
  await waitFor(() => hasText(page, 'Save it?'), 'save prompt');
  await sleep(300);
  await shot(page, 'save-prompt', [await card(page), await dialog(page)]);
  await click(page, await find(page, 'button', 'Save'));
  await waitFor(async () => vault.readEntries().some((e) => e.username === newcomer.username), 'saved to the vault');

  // 5. Signed in with the saved login, then a password change on the site → update prompt
  // (the prompt follows a login EasyPass filled: a change form has no username field to tell whose password it is)
  await page.goto(sites.url(bank.host, '/logout'));
  await opened();
  await page.click('#user');
  await page.keyboard.type(newcomer.first.toLowerCase());
  await waitFor(async () => (await options(page)).length === 1, 'the new client listed');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitFor(async () => (await page.inputValue('#pass')) === newcomer.password, 'new login filled');
  await page.click('#go');
  await page.waitForSelector('#welcome');
  await page.click('#to-account');
  await page.fill('#cur', newcomer.password);
  await page.fill('#new1', newcomer.password + '-v2');
  await page.fill('#new2', newcomer.password + '-v2');
  await page.click('#save');
  await page.waitForSelector('#changed');
  await waitFor(() => hasText(page, 'Update it in EasyPass?'), 'update prompt');
  await sleep(300);
  await shot(page, 'update-prompt', [await card(page), await dialog(page)]);
  await click(page, await find(page, 'button', 'Update'));
  await waitFor(async () => vault.readEntries().find((e) => e.username === newcomer.username)?.password === newcomer.password + '-v2', 'updated');

  // 6. Toolbar popup: every site's clients; details with the password on request
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${ID}/popup.html`);
  await waitFor(async () => (await p.locator('#list .opt').count()) > 10, 'popup list');
  await p.locator('body').screenshot({ path: path.join(out, 'popup-list.png') });
  await p.keyboard.type('olivia');
  await waitFor(async () => (await p.locator('#list .opt').count()) === 2, 'Olivia on two sites');
  await p.locator('#list .opt', { hasText: tax.host }).click();
  await p.waitForSelector('#detail:not([hidden])');
  await p.getByRole('button', { name: 'Show' }).click();
  await p.locator('body').screenshot({ path: path.join(out, 'popup-detail.png') });
  console.log('wrote popup-list.png, popup-detail.png');
  await p.close();

  // Hero: the login page with the panel, in a plain browser frame
  const h = await ctx.newPage();
  await h.setViewportSize({ width: 1392, height: 800 });
  await h.setContent(heroHtml(tax.host, loginPage));
  await h.locator('#hero').screenshot({ path: path.join(out, 'hero.png') });
  console.log('wrote hero.png');
  await h.close();
} finally {
  await ctx.close();
  sites.server.close();
}

// 7. Monthly work for a few demo clients, saved through the real host (as the page panel does). A reminder that is
// already due (the host accepts up to 5 minutes back) makes the reminder window appear when the app starts.
async function seedWork() {
  const host = spawn(path.join(installed, 'EasyPass.Host.exe'), [], { env: { ...process.env, EASYPASS_HOME: home } });
  let buf = Buffer.alloc(0);
  const waiting = [];
  host.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readInt32LE(0)) {
      const n = buf.readInt32LE(0);
      waiting.shift()(JSON.parse(buf.subarray(4, 4 + n)));
      buf = buf.subarray(4 + n);
    }
  });
  const call = (o) => new Promise((resolve) => {
    waiting.push(resolve);
    const b = Buffer.from(JSON.stringify(o));
    const len = Buffer.alloc(4);
    len.writeInt32LE(b.length);
    host.stdin.write(Buffer.concat([len, b]));
  });
  const { items } = await call({ id: 1, cmd: 'all', q: '' });
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const due = new Date(Date.now() - 2 * 60000).toISOString();
  const plan = [
    [{ 'task-vat': 'done', 'task-payroll': 'partial' }, { 'task-payroll': due }],
    [{ 'task-vat': 'done', 'task-payroll': 'done' }, {}],
    [{ 'task-annual': 'partial' }, { 'task-annual': new Date(Date.now() + 26 * 3600000).toISOString() }],
    [{ 'task-vat': 'partial' }, { 'task-vat': new Date(Date.now() + 5 * 3600000).toISOString() }],
    [{ 'task-vat': 'done' }, {}],
  ];
  for (const [i, [statuses, reminders]] of plan.entries()) {
    const r = await call({ id: 10 + i, cmd: 'work_save', site: items[i].site, entryId: items[i].id, month, statuses, reminders });
    if (!r.ok) throw new Error('work_save failed: ' + r.error);
  }
  host.stdin.end();
}
await seedWork();

// 8. The app with the same vault: Mia Lawson with the details from the bank's sign-up, Settings, the work tabs and
// the reminder window. English into docs/images; Russian and Turkish next to it in docs/images/i18n (same files, lang prefix).
const appShots = (dir, prefix) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'app-shots.ps1'),
  '-AppHome', home, '-Exe', path.join(installed, 'EasyPass.exe'), '-Out', dir, '-Search', newcomer.first, '-Prefix', prefix], { stdio: 'inherit' });
appShots(out, '');
const settingsFile = path.join(home, 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
fs.mkdirSync(path.join(out, 'i18n'), { recursive: true });
for (const lang of ['ru', 'tr']) {
  fs.writeFileSync(settingsFile, JSON.stringify({ ...settings, lang }));
  appShots(path.join(out, 'i18n'), lang + '-');
}
fs.writeFileSync(settingsFile, JSON.stringify(settings));
