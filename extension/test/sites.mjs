// Five throwaway customer portals for end-to-end runs: login, sign-up, change password, each with its own users.
// One server; the site is picked by the first label of the Host header, so hizlikargo.test (HTTPS, e2e runs:
// *.test → 127.0.0.1 via --host-resolver-rules) and hizlikargo.localhost (plain http, any Chrome) are the same site.
// Standalone, for trying by hand in your own Chrome: node sites.mjs [port=8080] [--vault <new file.ezp>]
//   serves http://<site>.localhost:<port> until stopped; --vault also writes a vault with each site's users
//   (no master password) to open in EasyPass (Ayarlar → "Başka kasa aç…").
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVault } from './test-vault.mjs';

// Seeded users exist both on the site and in the test vault (see e2e-windows.mjs).
// Ahmet Yılmaz is on two sites with different passwords: each site must fill its own.
// HızlıKargo has 7 users (the panel lists 5 until you type); two sites bring their own show-password control (ownEye).
// signup: what each sign-up form asks for besides name and login (with the value the e2e run types; secret = shown masked).
export const SITES = [
  {
    host: 'hizlikargo.test', name: 'HızlıKargo', color: '#C2410C', userLabel: 'Kullanıcı adı', userType: 'text',
    signup: [
      { id: 'phone', label: 'Telefon', type: 'tel', value: '0532 111 22 33' },
      { id: 'address', label: 'Adres', type: 'textarea', value: 'Moda Cad. 5, Kadıköy' },
    ],
    users: [
      { first: 'Ahmet', last: 'Yılmaz', username: 'ahmet.yilmaz', password: 'Kargo-111' },
      { first: 'Elif', last: 'Şahin', username: 'elif.sahin', password: 'Kargo-222' },
      { first: 'Murat', last: 'Çelik', username: 'murat.celik', password: 'Kargo-333' },
      { first: 'Ali', last: 'Vural', username: 'ali.vural', password: 'Kargo-444' },
      { first: 'Sevgi', last: 'Önal', username: 'sevgi.onal', password: 'Kargo-555' },
      { first: 'Kemal', last: 'Uçar', username: 'kemal.ucar', password: 'Kargo-666' },
      { first: 'Gamze', last: 'Bulut', username: 'gamze.bulut', password: 'Kargo-777' },
    ],
  },
  {
    host: 'efatura.test', name: 'e-Fatura Portalı', color: '#1D4ED8', userLabel: 'E-posta', userType: 'email',
    signup: [
      { id: 'company', label: 'Şirket adı', value: 'Toprak Tarım Ltd.' },
      { id: 'taxno', label: 'Vergi no', value: '1234567890' },
    ],
    users: [
      { first: 'Ahmet', last: 'Yılmaz', username: 'ahmet@yilmazltd.example', password: 'Fatura-111' },
      { first: 'Zeynep', last: 'Kaya', username: 'zeynep@kayatekstil.example', password: 'Fatura-222' },
    ],
  },
  {
    host: 'demobank.test', name: 'DemoBank', color: '#047857', userLabel: 'Müşteri no', userType: 'text', spa: true,
    signup: [
      { id: 'tckn', label: 'TC kimlik no', value: '12345678901', secret: true },
      { id: 'iban', label: 'IBAN', value: 'TR12 0006 4000 0011 2345 6789 01', secret: true },
    ],
    users: [
      { first: 'Hasan', last: 'Öztürk', username: '10024587', password: 'Bank-111' },
      { first: 'Ayşe', last: 'Demir', username: '10031122', password: 'Bank-222' },
      { first: 'Can', last: 'Arslan', username: '10047790', password: 'Bank-333' },
    ],
  },
  {
    host: 'guvensigorta.test', name: 'Güven Sigorta', color: '#7C3AED', userLabel: 'TC kimlik no', userType: 'text', ownEye: 'button',
    signup: [
      { id: 'birth', label: 'Doğum tarihi', type: 'date', value: '1990-05-01' },
      { id: 'mobile', label: 'Cep telefonu', type: 'tel', value: '0555 444 33 22' },
    ],
    users: [
      { first: 'Fatma', last: 'Aydın', username: '12345678901', password: 'Sigorta-111' },
      { first: 'Mehmet', last: 'Koç', username: '23456789012', password: 'Sigorta-222' },
    ],
  },
  {
    host: 'defteronline.test', name: 'Defter Online', color: '#0F766E', userLabel: 'E-posta', userType: 'email', ownEye: 'checkbox',
    signup: [
      { id: 'city', label: 'Şehir', type: 'select', options: [['ist', 'İstanbul'], ['ank', 'Ankara']], value: 'ist', shown: 'İstanbul' },
    ],
    users: [
      { first: 'Selin', last: 'Yıldız', username: 'selin@yildizmuhasebe.example', password: 'Defter-111' },
      { first: 'Burak', last: 'Polat', username: 'burak@polatinsaat.example', password: 'Defter-222' },
      { first: 'Deniz', last: 'Er', username: 'deniz@erlojistik.example', password: 'Defter-333' },
    ],
  },
  {
    // like cabinet.salyk.kg: the login (INN, 14 or 17 digits) is an <input type="number">; made-up numbers (no INN starts with 9)
    // flow: its /account/* pages (spec §8) are served too, next to the plain portal pages the Windows run walks through
    host: 'salykkabinet.test', name: 'Кабинет налогоплательщика', color: '#1E40AF', userLabel: 'Логин', userType: 'number', flow: 'salyk',
    signup: [
      { id: 'phone', label: 'Телефон', type: 'tel', value: '0555 123 456' },
    ],
    users: [
      { first: 'Aibek', last: 'Toktogulov', username: '91000000000123', password: 'Salyk-111', org: 'Токтогулов Айбек Маратович' },
      { first: 'Nurgul', last: 'Asanova', username: '92000000000456', password: 'Salyk-222', org: 'Асанова Нургуль Бакытовна' },
      { first: 'Bakyt', last: 'Osmonov', username: '93000000000789123', password: 'Salyk-333', org: 'ОсОО "Ак-Жол"' },
    ],
  },
];

// The portals' own words, by site.lang (default tr). The e2e run reads some of them, e.g. the "Ad Soyad" label.
const PAGE_TEXT = {
  tr: {
    signIn: 'Giriş yap', signInButton: 'Giriş', password: 'Şifre', password2: 'Şifre (tekrar)', noAccount: 'Hesabınız yok mu?',
    signUp: 'Üye ol', member: 'Zaten üye misiniz?', fullName: 'Ad Soyad', choose: 'Seçiniz', showPw: 'Şifreyi göster',
    welcome: 'Hoş geldiniz,', user: 'Kullanıcı:', changePw: 'Şifre değiştir', logout: 'Çıkış', account: 'Hesabım',
    current: 'Mevcut şifre', next: 'Yeni şifre', next2: 'Yeni şifre (tekrar)', change: 'Şifreyi değiştir',
    badLogin: 'Kullanıcı adı ya da şifre hatalı.', changed: 'Şifreniz değişti.', registered: 'Üyeliğiniz oluşturuldu.',
    checkForm: 'Bilgileri kontrol edin.', badChange: 'Mevcut şifre yanlış ya da yeni şifreler farklı.',
  },
  en: {
    signIn: 'Sign in', signInButton: 'Sign in', password: 'Password', password2: 'Confirm password', noAccount: 'No account yet?',
    signUp: 'Create account', member: 'Already registered?', fullName: 'Full name', choose: 'Choose…', showPw: 'Show password',
    welcome: 'Welcome,', user: 'Signed in as', changePw: 'Change password', logout: 'Sign out', account: 'My account',
    current: 'Current password', next: 'New password', next2: 'Confirm new password', change: 'Change password',
    badLogin: 'Wrong username or password.', changed: 'Your password was changed.', registered: 'Your account was created.',
    checkForm: 'Please check the form.', badChange: 'The current password is wrong or the new ones differ.',
  },
};
const say = (site) => PAGE_TEXT[site.lang || 'tr'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// SPA variant: forms post with fetch and swap the card in place, no navigation (like React login screens).
const spaForms = (site, html) => (site.spa ? html.replace(/<form /g, '<form data-spa ') : html);
const spaScript = `<script>
  document.addEventListener('submit', async (e) => {
    const f = e.target;
    if (!f.matches('form[data-spa]')) return;
    e.preventDefault();
    const r = await fetch(f.action, { method: 'POST', body: new URLSearchParams(new FormData(f)) });
    document.querySelector('main').innerHTML = await r.text();
  });
</script>`;

function page(site, title, body) {
  return `<!doctype html><html lang="${site.lang || 'tr'}"><head><meta charset="utf-8"><title>${esc(title)} · ${esc(site.name)}</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,"Segoe UI",sans-serif;background:#F4F4F5;color:#18181B}
  header{background:${site.color};color:#fff;padding:14px 32px;font-weight:700;font-size:18px}
  main{max-width:420px;margin:48px auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 4px 18px rgba(0,0,0,.08)}
  h1{font-size:22px;margin:0 0 18px} label{display:block;font-size:13px;color:#52525B;margin:12px 0 4px}
  input,select,textarea{width:100%;height:40px;padding:0 10px;border:1px solid #D4D4D8;border-radius:8px;font:inherit;font-size:15px}
  textarea{height:64px;padding:8px 10px}
  button{margin-top:18px;width:100%;height:42px;border:0;border-radius:8px;background:${site.color};color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  p{font-size:14px} a{color:${site.color}} .err{color:#B91C1C} .ok{color:#15803D}
  .pw{position:relative} .pw input{padding-right:40px}
  .pw-eye{position:absolute;right:8px;top:8px;width:24px;height:24px;margin:0;padding:0;border:0;background:none;color:#52525B;font-size:16px}
  .show{display:flex;align-items:center;gap:6px;margin-top:8px;color:#3F3F46} .show input{width:auto;height:auto}
</style></head><body><header>${esc(site.name)}</header><main>${spaForms(site, body)}</main>${site.spa ? spaScript : ''}</body></html>`;
}

// The login password field, with the site's own show-password control when it has one.
const passwordField = (site) => {
  const input = '<input id="pass" name="password" type="password">';
  const flip = "const p = document.getElementById('pass'); p.type = p.type === 'password' ? 'text' : 'password'";
  if (site.ownEye === 'button') {
    return `<div class="pw">${input}<button type="button" class="pw-eye" aria-label="${say(site).showPw}" onclick="${flip}">👁</button></div>`;
  }
  if (site.ownEye === 'checkbox') return `${input}<label class="show"><input type="checkbox" onchange="${flip}"> ${say(site).showPw}</label>`;
  return input;
};

const loginForm = (site, msg, t = say(site)) => `<h1>${t.signIn}</h1>${msg}
<form id="login" method="post" action="/login">
  <label for="user">${esc(site.userLabel)}</label><input id="user" name="username" type="${site.userType}" autocomplete="off">
  <label for="pass">${t.password}</label>${passwordField(site)}
  <button id="go">${t.signInButton}</button>
</form>
<p>${t.noAccount} <a id="to-register" href="/register">${t.signUp}</a></p>`;

// One extra sign-up field (site.signup), labelled with <label for>.
function signupField(x, t) {
  const label = `<label for="${x.id}">${esc(x.label)}</label>`;
  if (x.type === 'textarea') return `${label}<textarea id="${x.id}" name="${x.id}"></textarea>`;
  if (x.type === 'select') {
    const options = x.options.map(([v, text]) => `<option value="${v}">${esc(text)}</option>`).join('');
    return `${label}<select id="${x.id}" name="${x.id}"><option value="">${t.choose}</option>${options}</select>`;
  }
  return `${label}<input id="${x.id}" name="${x.id}" type="${x.type || 'text'}" autocomplete="off">`;
}

const registerForm = (site, msg, t = say(site)) => `<h1>${t.signUp}</h1>${msg}
<form id="register" method="post" action="/register">
  <label for="fullname">${t.fullName}</label><input id="fullname" name="fullname" autocomplete="off">
  ${(site.signup || []).map((x) => signupField(x, t)).join('')}
  <label for="user">${esc(site.userLabel)}</label><input id="user" name="username" type="${site.userType}" autocomplete="off">
  <label for="pass">${t.password}</label><input id="pass" name="password" type="password">
  <label for="pass2">${t.password2}</label><input id="pass2" name="password2" type="password">
  <button id="signup">${t.signUp}</button>
</form>
<p>${t.member} <a href="/login">${t.signIn}</a></p>`;

const home = (site, u, note = '', t = say(site)) => `<h1 id="welcome">${t.welcome} ${esc(u.first)} ${esc(u.last)}</h1>${note}
<p>${t.user} <b id="who">${esc(u.username)}</b></p>
<p><a id="to-account" href="/account">${t.changePw}</a> · <a id="logout" href="/logout">${t.logout}</a></p>`;

const accountForm = (site, msg, t = say(site)) => `<h1>${t.changePw}</h1>${msg}
<form id="account" method="post" action="/account">
  <label for="cur">${t.current}</label><input id="cur" name="current" type="password">
  <label for="new1">${t.next}</label><input id="new1" name="next" type="password">
  <label for="new2">${t.next2}</label><input id="new2" name="next2" type="password">
  <button id="save">${t.change}</button>
</form>`;

// salyk flow: the login page keeps its query string in the form, like the real ASP.NET page keeps ReturnUrl.
const salykLogin = (site, search, msg) => loginForm(site, msg)
  .replace('action="/login"', `action="/account/login${esc(search)}"`).replace('name="username"', 'name="Username"');
// The organization page. ?multi=1: two rows, of which only a login starting with 93000000000789 finds its own.
function salykSelect(u, multi) {
  const rows = multi ? [['ОсОО "Ак-Жол"', '93000000000789'], ['Осмонов Бакыт Эркинович', '93000000000111']]
    : [[u.org || `${u.first} ${u.last}`, u.username.slice(0, 14)]];
  return `<h1>Войти через</h1><table>${rows.map(([name, number]) => `<tr>
    <td><span class="text-gray-800">${esc(name)}</span><br><span class="text-gray-600">${number}</span></td>
    <td><a class="btn-light-primary" href="/account/setorganization?organizationId=${number}">Войти</a></td></tr>`).join('')}</table>`;
}

function createState(site) {
  return {
    users: site.users.map((u) => ({ ...u })),
    sessions: new Map(), // sid → username
    half: new Map(), // salyk flow: sid → username, password accepted but no organization chosen yet
    find(username) { return this.users.find((u) => u.username.toLowerCase() === username.toLowerCase()); },
  };
}

async function body(req) {
  let s = '';
  for await (const chunk of req) s += chunk;
  return Object.fromEntries(new URLSearchParams(s));
}

const slug = (host) => host.split('.')[0];

function handler(sites, states) {
  return async (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const site = sites.find((x) => slug(x.host) === slug(host));
    if (!site) return res.writeHead(404).end('unknown site');
    const t = say(site);
    const st = states.get(slug(host));
    const url = new URL(req.url, `https://${host}`);
    const secure = req.socket.encrypted ? '; Secure' : '';
    const sid = /(?:^|; )sid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    const me = sid && st.find(st.sessions.get(sid) || '');
    const html = (title, inner, code = 200) =>
      res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }).end(page(site, title, inner));
    // A form post answers the SPA with the next card, a classic page with a redirect (to) or a full error page (title).
    const reply = ({ to, title, inner, headers = {} }) => {
      if (site.spa) return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers }).end(spaForms(site, inner));
      return to ? res.writeHead(302, { location: to, ...headers }).end() : html(title, inner, 400);
    };
    const login = (u) => {
      const id = crypto.randomUUID();
      st.sessions.set(id, u.username);
      return { 'set-cookie': `sid=${id}; Path=/; HttpOnly${secure}; SameSite=Lax` };
    };

    if (site.flow === 'salyk') {
      const cookie = (u) => {
        const id = crypto.randomUUID();
        st.half.set(id, u.username);
        return { 'set-cookie': `sid=${id}; Path=/; HttpOnly${secure}; SameSite=Lax` };
      };
      const toLogin = () => res.writeHead(302, { location: '/account/login?ReturnUrl=%2F' }).end();
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /': // ?nolink: an inside page without a logout link
          return me ? html(t.account, url.searchParams.has('nolink') ? home(site, me).replace(/ · <a id="logout".*?<\/a>/, '')
            : home(site, me).replace('href="/logout"', 'href="/account/logout"')) : toLogin();
        case 'GET /account/login': return html(t.signIn, salykLogin(site, url.search, ''));
        case 'GET /account/forgotpassword': return html(t.signIn, '<h1>Забыли пароль?</h1>'); // public: no password passed yet
        case 'POST /account/login': {
          st.posts = (st.posts || 0) + 1;
          const f = await body(req);
          const u = st.find(f.Username || '');
          if (!u || u.password !== f.password) return html(t.signIn, salykLogin(site, url.search, `<p class="err" id="error">${t.badLogin}</p>`));
          const multi = url.searchParams.has('multi') ? '&multi=1' : '';
          return res.writeHead(302, { location: `/account/selectorganization?userName=${encodeURIComponent(u.username)}${multi}`, ...cookie(u) }).end();
        }
        case 'GET /account/selectorganization': {
          const u = st.half.has(sid) && st.find(url.searchParams.get('userName') || '');
          return u ? html('Войти через', salykSelect(u, url.searchParams.has('multi'))) : toLogin();
        }
        case 'GET /account/setorganization': {
          if (!st.half.has(sid)) return toLogin();
          st.sessions.set(sid, st.half.get(sid));
          st.half.delete(sid);
          return res.writeHead(302, { location: '/' }).end();
        }
        case 'GET /account/logout':
          st.logouts = (st.logouts || 0) + 1;
          if (st.stuck) return res.writeHead(302, { location: '/' }).end(); // test hook: logging out leaves the tab signed in
          st.sessions.delete(sid);
          return res.writeHead(302, { location: '/account/login', 'set-cookie': 'sid=; Path=/; Max-Age=0' }).end();
        case 'GET /__expire': // test hook: the site's session times out
          st.sessions.clear();
          st.half.clear();
          return res.writeHead(200, { 'content-type': 'text/plain' }).end('expired');
      }
    }

    if (req.method === 'GET') {
      switch (url.pathname) {
        case '/': return res.writeHead(302, { location: me ? '/home' : '/login' }).end();
        case '/login': return html(t.signIn, loginForm(site, url.searchParams.has('e') ? `<p class="err" id="error">${t.badLogin}</p>` : ''));
        case '/register': return html(t.signUp, registerForm(site, ''));
        case '/home': {
          if (!me) return res.writeHead(302, { location: '/login' }).end();
          const note = url.searchParams.has('changed') ? `<p class="ok" id="changed">${t.changed}</p>`
            : url.searchParams.has('registered') ? `<p class="ok" id="registered">${t.registered}</p>` : '';
          return html(t.account, home(site, me, note));
        }
        case '/account': return me ? html(t.changePw, accountForm(site, '')) : res.writeHead(302, { location: '/login' }).end();
        case '/logout':
          if (sid) st.sessions.delete(sid);
          return res.writeHead(302, { location: '/login', 'set-cookie': 'sid=; Path=/; Max-Age=0' }).end();
        default: return res.writeHead(404).end('not found');
      }
    }

    const f = await body(req);
    switch (url.pathname) {
      case '/login': {
        const u = st.find(f.username || '');
        if (!u || u.password !== f.password) {
          return reply({ to: '/login?e=1', inner: loginForm(site, `<p class="err" id="error">${t.badLogin}</p>`) });
        }
        return reply({ to: '/home', inner: home(site, u), headers: login(u) });
      }
      case '/register': {
        const [first, ...rest] = (f.fullname || '').trim().split(/\s+/);
        if (!f.username || !f.password || f.password !== f.password2 || st.find(f.username)) {
          return reply({ title: t.signUp, inner: registerForm(site, `<p class="err" id="error">${t.checkForm}</p>`) });
        }
        const u = { first: first || '', last: rest.join(' '), username: f.username, password: f.password };
        st.users.push(u);
        return reply({ to: '/home?registered=1', inner: home(site, u, `<p class="ok" id="registered">${t.registered}</p>`), headers: login(u) });
      }
      case '/account': {
        if (!me) return res.writeHead(302, { location: '/login' }).end();
        if (me.password !== f.current || !f.next || f.next !== f.next2) {
          return reply({ title: t.changePw, inner: accountForm(site, `<p class="err" id="error">${t.badChange}</p>`) });
        }
        me.password = f.next;
        return reply({ to: '/home?changed=1', inner: home(site, me, `<p class="ok" id="changed">${t.changed}</p>`) });
      }
      default: return res.writeHead(404).end('not found');
    }
  };
}

// Self-signed certificate for *.test, made with the openssl that ships with Git for Windows (or the system one).
function certificate(dir) {
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (!fs.existsSync(cert)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=easypass-e2e.test',
      '-keyout', key, '-out', cert], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

// HTTPS with a self-signed certificate (e2e runs), or plain http when certDir is null (*.localhost by hand).
// sites: SITES (Turkish portals, the e2e run) or another set, e.g. DEMO_SITES (English, docs/screenshots).
export async function startSites({ port = 0, certDir = os.tmpdir(), sites = SITES } = {}) {
  const states = new Map(sites.map((s) => [slug(s.host), createState(s)]));
  const server = certDir ? https.createServer(certificate(certDir), handler(sites, states)) : http.createServer(handler(sites, states));
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const p = server.address().port;
  const scheme = certDir ? 'https' : 'http';
  return { server, port: p, url: (host, pathname = '/login') => `${scheme}://${host}:${p}${pathname}`, states };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const vaultAt = args.indexOf('--vault');
  const port = Number(args.find((a, i) => /^\d+$/.test(a) && i !== vaultAt + 1) || 8080);
  const local = SITES.map((s) => ({ ...s, host: slug(s.host) + '.localhost' }));
  if (vaultAt >= 0) {
    const file = path.resolve(args[vaultAt + 1]);
    if (fs.existsSync(file)) {
      console.log(`Kasa zaten var, dokunulmadı: ${file}`);
    } else {
      writeVault(file, local);
      console.log(`Test kasası yazıldı (şifresiz): ${file}`);
    }
  }
  const { url } = await startSites({ port, certDir: null });
  console.log('Test siteleri hazır:');
  for (const s of local) console.log(`  ${s.name.padEnd(18)} ${url(s.host)}`);
}
