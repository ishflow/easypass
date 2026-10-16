// Five throwaway customer portals for end-to-end runs: login, sign-up, change password, each with its own users.
// One server; the site is picked by the first label of the Host header, so hizlikargo.test (HTTPS, e2e runs:
// *.test → 127.0.0.1 via --host-resolver-rules) and hizlikargo.localhost (plain http, any Chrome) are the same site.
// Standalone, for trying by hand in your own Chrome: node sites.mjs [port=8080] [--vault <new file.ezp>]
//   serves http://<site>.localhost:<port> until stopped; --vault also writes a vault with each site's users
//   (master password test1234) to open in EasyPass ("Var olan kasayı aç").
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
export const SITES = [
  {
    host: 'hizlikargo.test', name: 'HızlıKargo', color: '#C2410C', userLabel: 'Kullanıcı adı', userType: 'text',
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
    users: [
      { first: 'Ahmet', last: 'Yılmaz', username: 'ahmet@yilmazltd.com', password: 'Fatura-111' },
      { first: 'Zeynep', last: 'Kaya', username: 'zeynep@kayatekstil.com', password: 'Fatura-222' },
    ],
  },
  {
    host: 'demobank.test', name: 'DemoBank', color: '#047857', userLabel: 'Müşteri no', userType: 'text', spa: true,
    users: [
      { first: 'Hasan', last: 'Öztürk', username: '10024587', password: 'Bank-111' },
      { first: 'Ayşe', last: 'Demir', username: '10031122', password: 'Bank-222' },
      { first: 'Can', last: 'Arslan', username: '10047790', password: 'Bank-333' },
    ],
  },
  {
    host: 'guvensigorta.test', name: 'Güven Sigorta', color: '#7C3AED', userLabel: 'TC kimlik no', userType: 'text', ownEye: 'button',
    users: [
      { first: 'Fatma', last: 'Aydın', username: '12345678901', password: 'Sigorta-111' },
      { first: 'Mehmet', last: 'Koç', username: '23456789012', password: 'Sigorta-222' },
    ],
  },
  {
    host: 'defteronline.test', name: 'Defter Online', color: '#0F766E', userLabel: 'E-posta', userType: 'email', ownEye: 'checkbox',
    users: [
      { first: 'Selin', last: 'Yıldız', username: 'selin@yildizmuhasebe.com', password: 'Defter-111' },
      { first: 'Burak', last: 'Polat', username: 'burak@polatinsaat.com', password: 'Defter-222' },
      { first: 'Deniz', last: 'Er', username: 'deniz@erlojistik.com', password: 'Defter-333' },
    ],
  },
];

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
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)} · ${esc(site.name)}</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,"Segoe UI",sans-serif;background:#F4F4F5;color:#18181B}
  header{background:${site.color};color:#fff;padding:14px 32px;font-weight:700;font-size:18px}
  main{max-width:420px;margin:48px auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 4px 18px rgba(0,0,0,.08)}
  h1{font-size:22px;margin:0 0 18px} label{display:block;font-size:13px;color:#52525B;margin:12px 0 4px}
  input{width:100%;height:40px;padding:0 10px;border:1px solid #D4D4D8;border-radius:8px;font-size:15px}
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
    return `<div class="pw">${input}<button type="button" class="pw-eye" aria-label="Şifreyi göster" onclick="${flip}">👁</button></div>`;
  }
  if (site.ownEye === 'checkbox') return `${input}<label class="show"><input type="checkbox" onchange="${flip}"> Şifreyi göster</label>`;
  return input;
};

const loginForm = (site, msg) => `<h1>Giriş yap</h1>${msg}
<form id="login" method="post" action="/login">
  <label for="user">${esc(site.userLabel)}</label><input id="user" name="username" type="${site.userType}" autocomplete="off">
  <label for="pass">Şifre</label>${passwordField(site)}
  <button id="go">Giriş</button>
</form>
<p>Hesabınız yok mu? <a id="to-register" href="/register">Üye ol</a></p>`;

const registerForm = (site, msg) => `<h1>Üye ol</h1>${msg}
<form id="register" method="post" action="/register">
  <label for="fullname">Ad Soyad</label><input id="fullname" name="fullname" autocomplete="off">
  <label for="user">${esc(site.userLabel)}</label><input id="user" name="username" type="${site.userType}" autocomplete="off">
  <label for="pass">Şifre</label><input id="pass" name="password" type="password">
  <label for="pass2">Şifre (tekrar)</label><input id="pass2" name="password2" type="password">
  <button id="signup">Üye ol</button>
</form>
<p>Zaten üye misiniz? <a href="/login">Giriş yap</a></p>`;

const home = (u, note = '') => `<h1 id="welcome">Hoş geldiniz, ${esc(u.first)} ${esc(u.last)}</h1>${note}
<p>Kullanıcı: <b id="who">${esc(u.username)}</b></p>
<p><a id="to-account" href="/account">Şifre değiştir</a> · <a id="logout" href="/logout">Çıkış</a></p>`;

const accountForm = (msg) => `<h1>Şifre değiştir</h1>${msg}
<form id="account" method="post" action="/account">
  <label for="cur">Mevcut şifre</label><input id="cur" name="current" type="password">
  <label for="new1">Yeni şifre</label><input id="new1" name="next" type="password">
  <label for="new2">Yeni şifre (tekrar)</label><input id="new2" name="next2" type="password">
  <button id="save">Şifreyi değiştir</button>
</form>`;

function createState(site) {
  return {
    users: site.users.map((u) => ({ ...u })),
    sessions: new Map(), // sid → username
    find(username) { return this.users.find((u) => u.username.toLowerCase() === username.toLowerCase()); },
  };
}

async function body(req) {
  let s = '';
  for await (const chunk of req) s += chunk;
  return Object.fromEntries(new URLSearchParams(s));
}

const slug = (host) => host.split('.')[0];

function handler(states) {
  return async (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const site = SITES.find((x) => slug(x.host) === slug(host));
    if (!site) return res.writeHead(404).end('unknown site');
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

    if (req.method === 'GET') {
      switch (url.pathname) {
        case '/': return res.writeHead(302, { location: me ? '/home' : '/login' }).end();
        case '/login': return html('Giriş', loginForm(site, url.searchParams.has('e') ? '<p class="err" id="error">Kullanıcı adı ya da şifre hatalı.</p>' : ''));
        case '/register': return html('Üye ol', registerForm(site, ''));
        case '/home': {
          if (!me) return res.writeHead(302, { location: '/login' }).end();
          const note = url.searchParams.has('changed') ? '<p class="ok" id="changed">Şifreniz değişti.</p>'
            : url.searchParams.has('registered') ? '<p class="ok" id="registered">Üyeliğiniz oluşturuldu.</p>' : '';
          return html('Hesabım', home(me, note));
        }
        case '/account': return me ? html('Şifre değiştir', accountForm('')) : res.writeHead(302, { location: '/login' }).end();
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
          return reply({ to: '/login?e=1', inner: loginForm(site, '<p class="err" id="error">Kullanıcı adı ya da şifre hatalı.</p>') });
        }
        return reply({ to: '/home', inner: home(u), headers: login(u) });
      }
      case '/register': {
        const [first, ...rest] = (f.fullname || '').trim().split(/\s+/);
        if (!f.username || !f.password || f.password !== f.password2 || st.find(f.username)) {
          return reply({ title: 'Üye ol', inner: registerForm(site, '<p class="err" id="error">Bilgileri kontrol edin.</p>') });
        }
        const u = { first: first || '', last: rest.join(' '), username: f.username, password: f.password };
        st.users.push(u);
        return reply({ to: '/home?registered=1', inner: home(u, '<p class="ok" id="registered">Üyeliğiniz oluşturuldu.</p>'), headers: login(u) });
      }
      case '/account': {
        if (!me) return res.writeHead(302, { location: '/login' }).end();
        if (me.password !== f.current || !f.next || f.next !== f.next2) {
          return reply({ title: 'Şifre değiştir', inner: accountForm('<p class="err" id="error">Mevcut şifre yanlış ya da yeni şifreler farklı.</p>') });
        }
        me.password = f.next;
        return reply({ to: '/home?changed=1', inner: home(me, '<p class="ok" id="changed">Şifreniz değişti.</p>') });
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
export async function startSites({ port = 0, certDir = os.tmpdir() } = {}) {
  const states = new Map(SITES.map((s) => [slug(s.host), createState(s)]));
  const server = certDir ? https.createServer(certificate(certDir), handler(states)) : http.createServer(handler(states));
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
      writeVault(file, local, 'test1234');
      console.log(`Test kasası yazıldı: ${file} (ana şifre test1234)`);
    }
  }
  const { url } = await startSites({ port, certDir: null });
  console.log('Test siteleri hazır:');
  for (const s of local) console.log(`  ${s.name.padEnd(18)} ${url(s.host)}`);
}
