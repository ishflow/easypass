(() => {
  const USER_TYPES = new Set(['text', 'email', 'tel']);
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, error: 'no_host' }));
  // Language comes from the EasyPass app settings (host status), not from the browser.
  const TEXT = {
    ru: {
      search: 'Найти клиента…', searchLabel: 'Поиск клиента', list: 'Клиенты', none: 'Ничего не найдено',
      hint: '↑ ↓ выбор · Enter заполнить · Esc закрыть',
      locked: 'Хранилище заблокировано — откройте EasyPass и введите мастер-пароль',
      noHost: 'Нет связи — запустите install.ps1', error: 'Ошибка: ',
      insecure: 'Небезопасная страница (http) — EasyPass здесь не заполняет',
      changed: 'Пароль изменён. Обновить в EasyPass?', update: 'Обновить', no: 'Нет',
      added: 'Этого входа нет в EasyPass. Сохранить?', first: 'Имя', last: 'Фамилия', save: 'Сохранить',
      showPw: 'Показать пароль', fromSite: 'Данные, введённые на сайте',
    },
    tr: {
      search: 'Müşteri ara…', searchLabel: 'Müşteri ara', list: 'Müşteriler', none: 'Sonuç yok',
      hint: '↑ ↓ seç · Enter doldur · Esc kapat',
      locked: "Kilitli — EasyPass'i açıp ana şifreyi girin",
      noHost: 'Bağlantı yok — kurulum betiğini çalıştırın', error: 'Hata: ',
      insecure: 'Güvensiz sayfa (http) — EasyPass burada doldurmaz',
      changed: "Şifre değişti. EasyPass'te güncellensin mi?", update: 'Güncelle', no: 'Hayır',
      added: "Bu giriş EasyPass'te yok. Kaydedilsin mi?", first: 'Ad', last: 'Soyad', save: 'Kaydet',
      showPw: 'Şifreyi göster', fromSite: 'Sitede girilen bilgiler',
    },
  };
  // Asked once per page, only when a page has password fields (so idle pages never start the host).
  let T = null, asked = null;
  const texts = () => (asked ??= send({ cmd: 'lang' }).then((lang) => (T = TEXT[lang] || TEXT.ru)));
  const message = (error) => ({ locked: T.locked, no_host: T.noHost, insecure: T.insecure })[error] ?? T.error + error;

  // Password inputs our eye switched to type=text are still password fields for everything here.
  const revealed = new WeakSet();
  const isPassword = (el) => el.type === 'password' || revealed.has(el);

  // Username field = last visible text/email/tel input before the first visible password input (same form).
  function pairFor(el) {
    const inputs = [...(el.form || document).querySelectorAll('input')].filter(visible);
    const i = inputs.findIndex(isPassword);
    if (i < 0) return null;
    return { user: inputs.slice(0, i).findLast((x) => USER_TYPES.has(x.type)), pass: inputs[i] };
  }

  function setValue(el, value) {
    // Native setter + events so React/Vue controlled inputs pick the value up.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const ICON = 20; // px, the round buttons inside the field's right edge
  const GAP = 4; // px between two of our buttons, or ours and the site's own control
  const MIN_FIELD = 80; // px, narrower fields get no icon (it would cover the text)
  const MAX_ITEMS = 5; // the panel lists at most this many; typing narrows the search down to the rest
  const svg = (paths) => `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" stroke-width="2.6"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const KEY = svg('<circle cx="8" cy="16" r="4"/><path d="M11 13l8-8m-3 3l2.5 2.5M14 10l2 2"/>');
  const EYE = svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
  const EYE_OFF = svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>');

  let host, root, panel, input, list, status, toast;
  let field = null, pair = null, items = [], active = -1, query = 0;
  const icons = new Map(); // field → { key, eye }: the buttons drawn in it (key opens the panel, eye shows the password)

  // Shadow root with the styles. Icons need it from page load; the panel and toast are added on first use.
  function shell() {
    if (host) return;
    host = document.createElement('easypass-ui');
    host.style.cssText = 'all:initial;position:absolute;top:0;left:0;z-index:2147483647';
    root = host.attachShadow({ mode: 'closed' }); // page scripts can't read the panel's DOM (customer names)
    root.innerHTML = `<style>
      :host{all:initial}
      *{box-sizing:border-box;margin:0;font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif}
      [hidden]{display:none!important}
      .box{background:#fff;color:#1C1F23;border:1px solid #E3E1DC;border-radius:8px;box-shadow:0 8px 24px rgba(28,31,35,.14);font-size:14px}
      .panel{position:absolute;z-index:1;width:320px;padding:8px} /* above the field icons */
      .site{padding:0 2px 6px;font-size:12px;font-weight:600;color:#0E7C6B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      input{width:100%;height:36px;padding:0 10px;border:1px solid #E3E1DC;border-radius:8px;background:#fff;color:#1C1F23;font-size:14px;outline:none}
      input:focus{border-color:#0E7C6B;box-shadow:0 0 0 2px #E3F1EE}
      #list{max-height:308px;overflow:auto}
      #list:not(:empty){margin-top:6px}
      .opt{display:flex;flex-direction:column;justify-content:center;width:100%;height:44px;padding:0 10px;border:0;border-radius:8px;background:none;color:#1C1F23;text-align:left;cursor:pointer}
      .opt:hover{background:#F6F5F2}
      .opt[aria-selected=true]{background:#E3F1EE}
      .n,.s{display:block;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .n{font-size:14px;font-weight:600}
      .s{font-size:12px;color:#5B6168}
      .status{padding:6px 10px 2px;font-size:12px;color:#5B6168}
      .status:empty{display:none}
      .hint{padding:6px 10px 0;font-size:12px;color:#5B6168}
      .toast{position:fixed;z-index:1;top:16px;right:16px;width:360px;padding:14px;display:grid;gap:10px}
      .toast .t{font-weight:600}
      .toast .s:empty{display:none}
      .fields{display:grid;gap:4px;max-height:260px;overflow:auto;padding:8px 10px;border:1px solid #E3E1DC;border-radius:8px;background:#F6F5F2}
      .fields:empty{display:none}
      .f{display:grid;grid-template-columns:120px 1fr auto;gap:8px;align-items:center;min-height:22px;font-size:12px}
      .fl{color:#5B6168;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fv{color:#1C1F23;overflow-wrap:anywhere}
      .feye{display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:50%;background:#0E7C6B;cursor:pointer}
      .feye[aria-pressed=true]{background:#0A5F52}
      .row{display:flex;gap:8px}
      label{display:grid;gap:4px;font-size:12px;color:#5B6168;flex:1}
      .btn{height:36px;padding:0 14px;border:1px solid #E3E1DC;border-radius:8px;background:#fff;color:#1C1F23;font-size:14px;font-weight:600;cursor:pointer}
      .primary{background:#0E7C6B;border-color:#0E7C6B;color:#fff}
      :focus-visible{outline:2px solid #0E7C6B;outline-offset:2px}
      .icon{position:absolute;display:grid;place-items:center;width:${ICON}px;height:${ICON}px;padding:0;border:0;border-radius:50%;
        background:#0E7C6B;box-shadow:0 1px 3px rgba(28,31,35,.3);cursor:pointer}
      .icon:hover,.icon[aria-expanded=true],.icon[aria-pressed=true]{background:#0A5F52}
    </style>`;
    // Keep our keystrokes away from page shortcuts. Page capture listeners on window/document still see the keys
    // (and so the search text) before this; accepted for v1, a browser-side popup would hide them (v2).
    for (const type of ['keydown', 'keyup', 'keypress', 'input']) root.addEventListener(type, (e) => e.stopPropagation());
    document.documentElement.append(host);
  }

  function ui() {
    shell();
    if (panel) return;
    const t = T;
    const tpl = document.createElement('template'); // a ShadowRoot has no insertAdjacentHTML; innerHTML += would drop the icons
    tpl.innerHTML = `
    <div class="box panel" role="dialog" aria-label="EasyPass" hidden>
      <p class="site"></p>
      <input type="search" role="combobox" aria-label="${t.searchLabel}" aria-expanded="true" aria-controls="list"
        aria-autocomplete="list" aria-describedby="hint" placeholder="${t.search}" autocomplete="off" spellcheck="false">
      <div id="list" role="listbox" aria-label="${t.list}"></div>
      <p class="status" role="status"></p>
      <p class="hint" id="hint">${t.hint}</p>
    </div>
    <div class="box toast" role="dialog" aria-label="EasyPass" aria-live="polite" hidden></div>`;
    root.append(tpl.content);
    [panel, input, list, status, toast] = ['.panel', 'input', '#list', '.status', '.toast'].map((s) => root.querySelector(s));
    root.querySelector('.site').textContent = location.hostname; // shown only; background sends the real host
    input.addEventListener('input', () => search(input.value, true));
    input.addEventListener('keydown', (e) => { if (navigate(e.key)) e.preventDefault(); });
  }

  // ↑ ↓ move the highlight, Enter fills the highlighted entry, Esc closes the panel. true = the key was ours.
  function navigate(key) {
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const step = key === 'ArrowDown' ? 1 : -1;
      if (items.length) active = active < 0 ? (step > 0 ? 0 : items.length - 1) : (active + step + items.length) % items.length;
      mark();
    } else if (key === 'Enter') {
      if (!items[active]) return false; // nothing highlighted: Enter is the page's (submit a login typed by hand)
      fill(items[active]);
    } else if (key === 'Escape') {
      close(true);
    } else return false;
    return true;
  }

  const expand = (on) => icons.get(field)?.key?.setAttribute('aria-expanded', on);

  // Right of the field when it fits, else below it. Re-run when the page moves the field.
  function placePanel() {
    const r = field.getBoundingClientRect();
    const right = r.right + 8 + 320 <= document.documentElement.clientWidth;
    panel.style.left = (right ? r.right + 8 : r.left) + scrollX + 'px';
    panel.style.top = (right ? r.top : r.bottom + 4) + scrollY + 'px';
  }

  async function open(f, p) {
    await texts();
    ui();
    expand(false); // the panel may have been open for another field
    field = f;
    pair = p;
    expand(true);
    placePanel();
    panel.hidden = false;
    // The panel never takes the caret: typing stays in the page field (a login that isn't in EasyPass is typed by hand)
    // and, in the username field, narrows the list. What is typed in a password field never goes to a search.
    input.value = f === p.user ? f.value : '';
    search(input.value, false);
  }

  function close(back) {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    expand(false);
    query++; // drop late search replies
    if (back) field.focus();
  }

  // Icon click: opens the panel for its field, or closes it if it is already open there.
  function toggle(f) {
    if (panel && !panel.hidden && field === f) return close(true);
    const p = pairFor(f);
    if (p) open(f, p).then(() => f.focus()); // the click moved the caret to the icon: back to the field
  }

  // highlight: the first hit is pre-selected (typing in the panel's own search box). Typing in the page field
  // selects nothing until ↓, so Enter there still submits a login typed by hand.
  async function search(text, highlight) {
    const mine = ++query;
    const r = await send({ cmd: 'search', q: text });
    if (mine !== query) return;
    items = r.ok ? r.items.slice(0, MAX_ITEMS) : [];
    active = highlight && items.length ? 0 : -1;
    status.textContent = r.ok ? (items.length ? '' : T.none) : message(r.error);
    list.replaceChildren(...items.map((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.id = 'o' + i;
      b.tabIndex = -1;
      b.setAttribute('role', 'option');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `${it.firstName} ${it.lastName}`.trim() || it.username;
      const s = document.createElement('span');
      s.className = 's';
      s.textContent = [it.username, it.extra1, it.extra2].filter(Boolean).join(' · ');
      b.append(n, s);
      b.addEventListener('click', () => fill(it));
      return b;
    }));
    mark();
  }

  function mark() {
    [...list.children].forEach((b, i) => b.setAttribute('aria-selected', i === active));
    const b = list.children[active];
    if (b) {
      input.setAttribute('aria-activedescendant', b.id);
      b.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  async function fill(item) {
    const r = await send({ cmd: 'get', entryId: item.id });
    if (!r.ok) return void (status.textContent = message(r.error));
    if (pair.user) setValue(pair.user, r.username);
    setValue(pair.pass, r.password);
    close(true);
  }

  // One line of the save prompt's field list; a secret value stays dots until its eye is pressed.
  function fieldRow(f) {
    const row = document.createElement('div');
    row.className = 'f';
    const label = document.createElement('span');
    label.className = 'fl';
    label.textContent = f.label || '—';
    label.title = f.label;
    const value = document.createElement('span');
    value.className = 'fv';
    row.append(label, value);
    if (!f.secret) {
      value.textContent = f.value;
      return row;
    }
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'feye';
    eye.setAttribute('aria-label', `${T.showPw}: ${f.label}`);
    const show = (on) => {
      value.textContent = on ? f.value : '•'.repeat(Math.min(f.value.length, 12));
      eye.innerHTML = on ? EYE_OFF : EYE;
      eye.setAttribute('aria-pressed', on);
    };
    eye.addEventListener('click', () => show(eye.getAttribute('aria-pressed') !== 'true'));
    show(false);
    row.append(eye);
    return row;
  }

  async function prompt(p) {
    if (!p?.result) return;
    const t = await texts();
    ui();
    toast.innerHTML = p.result === 'changed'
      ? `<p class="t">${t.changed}</p><p class="s"></p>
         <div class="row"><button class="btn primary" data-a="update">${t.update}</button><button class="btn" data-a="no">${t.no}</button></div>`
      : `<p class="t">${t.added}</p>
         <div class="row"><label>${t.first}<input name="first"></label><label>${t.last}<input name="last"></label></div>
         <div class="fields" role="group" aria-label="${t.fromSite}"></div><p class="s"></p>
         <div class="row"><button class="btn primary" data-a="add">${t.save}</button><button class="btn" data-a="no">${t.no}</button></div>`;
    const info = toast.querySelector('.s');
    if (p.result === 'changed' || !p.fields?.length) info.textContent = p.name ? `${p.name} · ${p.username}` : p.username;
    if (p.result !== 'changed') {
      // names as typed on the site (still editable); every filled field under the site's own label
      toast.querySelector('[name=first]').value = p.firstName || '';
      toast.querySelector('[name=last]').value = p.lastName || '';
      toast.querySelector('.fields').replaceChildren(...(p.fields || []).map(fieldRow));
    }
    toast.hidden = false;
    toast.onkeydown = (e) => { if (e.key === 'Escape') answer('no'); }; // returning false would cancel typing
    toast.onclick = (e) => { if (e.target.dataset.a) answer(e.target.dataset.a); };
    async function answer(a) {
      const v = (name) => toast.querySelector(`[name=${name}]`).value.trim();
      // the background answers with the login it captured; only the names typed here travel with the request
      const r = await send(a === 'no' ? { cmd: 'dismiss' } : a === 'update' ? { cmd: 'update' }
        : { cmd: 'add', firstName: v('first'), lastName: v('last') });
      if (r.ok) toast.hidden = true;
      else info.textContent = message(r.error);
    }
  }

  let sent = '';
  function captured(scope) {
    // back to dots before the form goes out, so the browser never keeps the password as a plain text entry
    for (const el of scope.querySelectorAll('input')) if (revealed.has(el) && el.type !== 'password') reveal(el, false);
    const pws = [...scope.querySelectorAll('input[type=password]')].filter((x) => x.value && visible(x));
    if (!pws.length) return;
    const user = pairFor(pws[0])?.user;
    const username = user?.value.trim() || '';
    const password = pws.at(-1).value; // change-password form: last field is the new password
    if (sent === username + '\n' + password) return; // submit + click + Enter fire for one login
    sent = username + '\n' + password;
    send({ cmd: 'submitted', username, password, change: pws.length > 1, ...formFields(scope, user, pws) }).then(prompt);
  }

  // --- What the form asked for: a sign-up form's fields under the site's own labels, for the save prompt and the vault ---
  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file', 'range', 'color']);
  const MAX_FIELDS = 30;
  // Shown masked until asked (by label, name or id): passwords, ID and passport numbers, bank and card data.
  const SECRET = /pass|parol|şifre|sifre|пароль|kimlik|tckn|\btc\b|tc.?no|national|identity|ssn|passport|pasaport|паспорт|iban|card|kart|cvv|cvc|\bpin\b|security|güvenlik|guvenlik|снилс|инн/i;
  // Where the person's name was typed: one "full name" field, or separate first / last name fields.
  const FULL_LABEL = /\bad[a-z]*\s*(ve\s*)?soyad|isim\s*soyisim|full\s*name|^name$|^фио$|имя и фамилия/;
  const FULL_KEY = /full.?name|ad.?soyad|isim.?soyisim|^fio$/;
  const FIRST_LABEL = /^(ad|adi|adiniz|isim|isminiz|first name|given name|имя)$/;
  const FIRST_KEY = /first.?name|given.?name|^ad$|^isim$/;
  const LAST_LABEL = /^(soyad|soyadi|soyadiniz|soyisim|last name|surname|family name|фамилия)$/;
  const LAST_KEY = /last.?name|family.?name|surname|soyad|soyisim/;
  const fold = (s) => (s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/\s+/g, ' ').trim();

  // The label's own words: without the field itself or a show-password button inside the <label>, and without " *:".
  function labelOf(el) {
    const own = (label) => {
      const copy = label.cloneNode(true);
      copy.querySelectorAll('input, select, textarea, button').forEach((x) => x.remove());
      return copy.textContent.replace(/\s+/g, ' ').trim();
    };
    const byIds = (ids) => (ids || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent.trim()).filter(Boolean).join(' ');
    const label = [...(el.labels || [])].map(own).find(Boolean) || el.getAttribute('aria-label') || byIds(el.getAttribute('aria-labelledby'))
      || el.placeholder || el.name || el.id || '';
    return label.replace(/[\s*:]+$/, '').slice(0, 100);
  }

  function nameKind(el, label) {
    const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
    const l = fold(label);
    const keys = [el.name, el.id].map(fold);
    if (auto === 'name' || FULL_LABEL.test(l) || keys.some((k) => FULL_KEY.test(k))) return 'full';
    if (auto === 'given-name' || FIRST_LABEL.test(l) || keys.some((k) => FIRST_KEY.test(k))) return 'first';
    if (auto === 'family-name' || LAST_LABEL.test(l) || keys.some((k) => LAST_KEY.test(k))) return 'last';
    return null;
  }

  // role marks the login itself (username / password): the prompt lists it, the vault keeps it in its own fields.
  function formFields(scope, user, pws) {
    const fields = [];
    const names = {};
    for (const el of scope.querySelectorAll('input, select, textarea')) {
      if (fields.length >= MAX_FIELDS) break;
      if (!visible(el) || el.disabled || (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type))) continue;
      if (el instanceof HTMLSelectElement && !el.value) continue; // "Choose…" placeholder option
      const value = (el instanceof HTMLSelectElement ? el.selectedOptions[0]?.textContent : el.value)?.trim().slice(0, 1000);
      if (!value) continue;
      const label = labelOf(el);
      const role = el === user ? 'username' : pws.includes(el) ? 'password' : undefined;
      const kind = !role && nameKind(el, label);
      if (kind) names[kind] ??= value;
      fields.push({ label, value, secret: role === 'password' || SECRET.test(`${label} ${el.name} ${el.id}`), ...(role && { role }) });
    }
    let { first = '', last = '' } = names;
    if (!first && !last && names.full) { // "Ahmet Can Yılmaz" → first "Ahmet Can", last "Yılmaz"
      const words = names.full.split(/\s+/);
      last = words.length > 1 ? words.pop() : '';
      first = words.join(' ');
    }
    return { fields, firstName: first, lastName: last };
  }

  // The site's own show-password control near the field: an eye in/next to it, or a "show password" checkbox or
  // button just below. Then we draw no eye (two eyes on one field would confuse). Matches common names in the UI languages.
  const TOGGLE = /show|hide|reveal|eye|göster|gizle|показ|скры|глаз|(pass|pw|şifre|парол)\S{0,12}(toggle|visib)|(toggle|visib)\S{0,12}(pass|pw|şifre|парол)/i;
  function ownToggle(f) {
    const r = f.getBoundingClientRect();
    const scope = f.form || f.parentElement?.parentElement?.parentElement || document.body;
    for (const el of scope.querySelectorAll('button, [role=button], [role=switch], [role=checkbox], input[type=checkbox], a, label, svg, i, span')) {
      const b = el.getBoundingClientRect();
      if (!b.width || b.bottom < r.top - 8 || b.top > r.bottom + 64 || b.right < r.left - 8 || b.left > r.right + 64) continue;
      const text = el.textContent.length <= 40 ? el.textContent : '';
      const names = ['aria-label', 'title', 'id', 'class', 'data-testid'].map((a) => el.getAttribute(a) || '').join(' ');
      if (TOGGLE.test(names + ' ' + text) && visible(el)) return el;
    }
    return null;
  }

  // What each field gets: the key on the username field (on the password field when the form has none),
  // and the eye on every password field the site gives no show-password control of its own.
  function wanted() {
    const want = new Map();
    const add = (f, w) => want.set(f, { ...want.get(f), ...w });
    for (const el of document.querySelectorAll('input')) {
      if (!isPassword(el) || !visible(el)) continue;
      const p = pairFor(el);
      if (p?.pass === el) add(p.user || el, { key: true });
      const own = ownToggle(el);
      add(el, own ? { own } : { eye: true });
    }
    return want;
  }

  function button(f, kind) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon';
    if (kind === 'key') {
      b.setAttribute('aria-label', 'EasyPass');
      b.setAttribute('aria-expanded', 'false');
      b.innerHTML = KEY;
      b.addEventListener('click', () => toggle(f));
    } else {
      b.setAttribute('aria-label', T.showPw);
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = EYE;
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the caret in the field while peeking
      b.addEventListener('click', () => reveal(f, f.type === 'password'));
    }
    root.append(b);
    return b;
  }

  function reveal(f, show) {
    revealed.add(f);
    f.type = show ? 'text' : 'password';
    const b = icons.get(f)?.eye;
    if (!b) return;
    b.innerHTML = show ? EYE_OFF : EYE;
    b.setAttribute('aria-pressed', show);
  }

  // Inside the field's right edge, vertically centred: the eye rightmost, the key left of it.
  // A site control sitting in that corner (its own eye) pushes ours left so nothing is covered.
  function place(f, have, own) {
    const r = f.getBoundingClientRect();
    const hidden = r.width < MIN_FIELD || r.height < ICON || !visible(f);
    let right = r.right - Math.min((r.height - ICON) / 2, 10);
    const o = own?.getBoundingClientRect();
    if (o && o.left < r.right && o.right > r.right - 64 && o.top < r.bottom && o.bottom > r.top) right = Math.min(right, o.left - GAP);
    for (const b of [have.eye, have.key]) {
      if (!b) continue;
      b.hidden = hidden;
      b.style.left = right - ICON + scrollX + 'px';
      b.style.top = r.top + (r.height - ICON) / 2 + scrollY + 'px';
      right -= ICON + GAP;
    }
  }

  function placeIcons() {
    const want = wanted();
    for (const [f, have] of icons) {
      for (const kind of ['key', 'eye']) {
        if (!have[kind] || want.get(f)?.[kind]) continue;
        if (kind === 'key' && f === field) close(false);
        have[kind].remove();
        delete have[kind];
      }
      if (!have.key && !have.eye) icons.delete(f);
    }
    if (!want.size) return;
    if (!T) return void texts().then(schedule); // the eye's label is in the app's language
    shell();
    for (const [f, w] of want) {
      const have = icons.get(f) || {};
      for (const kind of ['key', 'eye']) if (w[kind] && !have[kind]) have[kind] = button(f, kind);
      icons.set(f, have);
      place(f, have, w.own);
    }
    if (panel && !panel.hidden) placePanel();
    autoOpen();
  }

  // A login form has exactly one password field. Sign-up and change-password forms have more: nothing to fill there.
  const loginForm = (p) => [...(p.pass.form || document).querySelectorAll('input')].filter((x) => isPassword(x) && visible(x)).length === 1;

  // A login form (nothing typed yet) opens the panel by itself, once per form.
  const autoOpened = new WeakSet(); // password fields whose form already had its turn
  function autoOpen() {
    if (panel && !panel.hidden) return;
    for (const [f, have] of icons) {
      const p = have.key && pairFor(f);
      if (!p || autoOpened.has(p.pass)) continue;
      autoOpened.add(p.pass);
      if (!loginForm(p) || p.pass.value || p.user?.value) continue;
      // nothing focused yet: put the caret in the field, so typing right away narrows the list (or types a new login)
      return void open(f, p).then(() => { if (!document.activeElement || document.activeElement === document.body) f.focus(); });
    }
  }

  // A mouse click in a login form's username field (re)opens the panel there, the caret staying in the field.
  function clickOpens(t) {
    const p = t instanceof HTMLInputElement && icons.get(t)?.key && pairFor(t);
    return p && p.user === t && loginForm(p) ? p : null;
  }

  // At most one re-placement per frame, however many scroll/mutation events arrive.
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      placeIcons();
    });
  }

  // SPAs add login fields late and move them around (steps, animations, show-password toggles).
  // Our own shadow DOM is not observed, so placing icons doesn't retrigger this.
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'type'],
  });
  for (const type of ['scroll', 'resize', 'transitionend', 'animationend']) {
    addEventListener(type, schedule, { capture: true, passive: true });
  }

  // Pressing the username field must not close the panel on the way (mousedown, then its focus) only to reopen it on click.
  let pressed = null;
  document.addEventListener('mousedown', (e) => {
    pressed = clickOpens(e.target) ? e.target : null;
    if (e.target !== host && !pressed) close(false);
  }, true);
  document.addEventListener('focusin', (e) => {
    if (e.target !== host && e.target !== pressed && e.target !== field) close(false);
  }, true);
  document.addEventListener('click', (e) => {
    const p = e.isTrusted && e.target === pressed && clickOpens(e.target);
    pressed = null;
    if (p && !(panel && !panel.hidden && field === e.target)) open(e.target, p); // already open there: just stays open
  }, true);

  // The open panel's username field drives it: typing narrows the list, ↑ ↓ Enter Esc work as in the panel's search box.
  const panelUserField = (t) => panel && !panel.hidden && t === field && t === pair?.user;
  document.addEventListener('input', (e) => {
    if (!e.isTrusted || !panelUserField(e.target)) return; // isTrusted: not our own fill, not page scripts
    input.value = field.value;
    search(field.value, false);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!e.isTrusted || !panelUserField(e.target) || !navigate(e.key)) return;
    e.preventDefault();
    e.stopPropagation(); // the page must not also act on a key that picked an entry or closed the panel
  }, true);
  // isTrusted: a page script must not make us ask the host about logins it invents
  document.addEventListener('submit', (e) => e.isTrusted && captured(e.target), true);
  document.addEventListener('click', (e) => {
    const b = e.isTrusted && e.target.closest?.('button, input[type=submit], input[type=image]');
    if (b?.form && (b.type === 'submit' || b.type === 'image')) captured(b.form);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.isTrusted && e.key === 'Enter' && e.target instanceof HTMLInputElement && isPassword(e.target)) captured(e.target.form || document);
  }, true);

  schedule();
  send({ cmd: 'pending' }).then(prompt);
})();
