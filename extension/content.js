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
    },
    tr: {
      search: 'Müşteri ara…', searchLabel: 'Müşteri ara', list: 'Müşteriler', none: 'Sonuç yok',
      hint: '↑ ↓ seç · Enter doldur · Esc kapat',
      locked: "Kilitli — EasyPass'i açıp ana şifreyi girin",
      noHost: 'Bağlantı yok — kurulum betiğini çalıştırın', error: 'Hata: ',
      insecure: 'Güvensiz sayfa (http) — EasyPass burada doldurmaz',
      changed: "Şifre değişti. EasyPass'te güncellensin mi?", update: 'Güncelle', no: 'Hayır',
      added: "Bu giriş EasyPass'te yok. Kaydedilsin mi?", first: 'Ad', last: 'Soyad', save: 'Kaydet',
    },
  };
  let T = null; // asked once per page, only when the UI is first needed (so idle pages never start the host)
  const texts = async () => (T ??= TEXT[await send({ cmd: 'lang' })] || TEXT.ru);
  const message = (error) => ({ locked: T.locked, no_host: T.noHost, insecure: T.insecure })[error] ?? T.error + error;

  // Username field = last visible text/email/tel input before the first visible password input (same form).
  function pairFor(el) {
    const inputs = [...(el.form || document).querySelectorAll('input')].filter(visible);
    const i = inputs.findIndex((x) => x.type === 'password');
    if (i < 0) return null;
    return { user: inputs.slice(0, i).findLast((x) => USER_TYPES.has(x.type)), pass: inputs[i] };
  }

  function setValue(el, value) {
    // Native setter + events so React/Vue controlled inputs pick the value up.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  let host, panel, input, list, status, toast;
  let field = null, pair = null, items = [], active = -1, query = 0, suppress = null;

  function ui() {
    if (host) return;
    const t = T;
    host = document.createElement('easypass-ui');
    host.style.cssText = 'all:initial;position:absolute;top:0;left:0;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' }); // page scripts can't read the panel's DOM (customer names)
    root.innerHTML = `<style>
      :host{all:initial}
      *{box-sizing:border-box;margin:0;font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif}
      [hidden]{display:none!important}
      .box{background:#fff;color:#1C1F23;border:1px solid #E3E1DC;border-radius:8px;box-shadow:0 8px 24px rgba(28,31,35,.14);font-size:14px}
      .panel{position:absolute;width:320px;padding:8px}
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
      .toast{position:fixed;top:16px;right:16px;width:340px;padding:14px;display:grid;gap:10px}
      .toast .t{font-weight:600}
      .row{display:flex;gap:8px}
      label{display:grid;gap:4px;font-size:12px;color:#5B6168;flex:1}
      .btn{height:36px;padding:0 14px;border:1px solid #E3E1DC;border-radius:8px;background:#fff;color:#1C1F23;font-size:14px;font-weight:600;cursor:pointer}
      .primary{background:#0E7C6B;border-color:#0E7C6B;color:#fff}
      :focus-visible{outline:2px solid #0E7C6B;outline-offset:2px}
    </style>
    <div class="box panel" role="dialog" aria-label="EasyPass" hidden>
      <p class="site"></p>
      <input type="search" role="combobox" aria-label="${t.searchLabel}" aria-expanded="true" aria-controls="list"
        aria-autocomplete="list" aria-describedby="hint" placeholder="${t.search}" autocomplete="off" spellcheck="false">
      <div id="list" role="listbox" aria-label="${t.list}"></div>
      <p class="status" role="status"></p>
      <p class="hint" id="hint">${t.hint}</p>
    </div>
    <div class="box toast" role="dialog" aria-label="EasyPass" aria-live="polite" hidden></div>`;
    [panel, input, list, status, toast] = ['.panel', 'input', '#list', '.status', '.toast'].map((s) => root.querySelector(s));
    root.querySelector('.site').textContent = location.hostname; // shown only; background sends the real host
    // Keep our keystrokes away from page shortcuts. Page capture listeners on window/document still see the keys
    // (and so the search text) before this; accepted for v1, a browser-side popup would hide them (v2).
    for (const type of ['keydown', 'keyup', 'keypress', 'input']) root.addEventListener(type, (e) => e.stopPropagation());
    input.addEventListener('input', () => search(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (items.length) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        mark();
      } else if (e.key === 'Enter') {
        if (items[active]) fill(items[active]);
      } else if (e.key === 'Escape') {
        close(true);
      } else return;
      e.preventDefault();
    });
    document.documentElement.append(host);
  }

  async function open(f, p) {
    await texts();
    ui();
    field = f;
    pair = p;
    const r = f.getBoundingClientRect();
    const right = r.right + 8 + 320 <= document.documentElement.clientWidth;
    panel.style.left = (right ? r.right + 8 : r.left) + scrollX + 'px';
    panel.style.top = (right ? r.top : r.bottom + 4) + scrollY + 'px';
    panel.hidden = false;
    input.value = '';
    input.focus();
    search('');
  }

  function close(back) {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    query++; // drop late search replies
    if (back) {
      suppress = field; // don't reopen until the field is focused again
      field.focus();
    }
  }

  async function search(text) {
    const mine = ++query;
    const r = await send({ cmd: 'search', q: text });
    if (mine !== query) return;
    items = r.ok ? r.items : [];
    active = items.length ? 0 : -1;
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

  async function prompt(p) {
    if (!p?.result) return;
    const t = await texts();
    ui();
    toast.innerHTML = p.result === 'changed'
      ? `<p class="t">${t.changed}</p><p class="s"></p>
         <div class="row"><button class="btn primary" data-a="update">${t.update}</button><button class="btn" data-a="no">${t.no}</button></div>`
      : `<p class="t">${t.added}</p><p class="s"></p>
         <div class="row"><label>${t.first}<input name="first"></label><label>${t.last}<input name="last"></label></div>
         <div class="row"><button class="btn primary" data-a="add">${t.save}</button><button class="btn" data-a="no">${t.no}</button></div>`;
    const info = toast.querySelector('.s');
    info.textContent = p.name ? `${p.name} · ${p.username}` : p.username;
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
    const pws = [...scope.querySelectorAll('input[type=password]')].filter((x) => x.value && visible(x));
    if (!pws.length) return;
    const username = pairFor(pws[0])?.user?.value.trim() || '';
    const password = pws.at(-1).value; // change-password form: last field is the new password
    if (sent === username + '\n' + password) return; // submit + click + Enter fire for one login
    sent = username + '\n' + password;
    send({ cmd: 'submitted', username, password, change: pws.length > 1 }).then(prompt);
  }

  // Opens the panel if t is a login field. true = opened.
  function offer(t) {
    if (t === suppress || !(t instanceof HTMLInputElement)) return false;
    const p = pairFor(t);
    if (!p || (t !== p.user && t !== p.pass)) return false;
    open(t, p);
    return true;
  }

  document.addEventListener('focusin', (e) => {
    if (e.target !== host && !offer(e.target)) close(false);
  }, true);
  document.addEventListener('focusout', (e) => {
    if (e.target === suppress) suppress = null;
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (e.target !== host && e.target !== field) close(false);
  }, true);
  // isTrusted: a page script must not make us ask the host about logins it invents
  document.addEventListener('submit', (e) => e.isTrusted && captured(e.target), true);
  document.addEventListener('click', (e) => {
    const b = e.isTrusted && e.target.closest?.('button, input[type=submit], input[type=image]');
    if (b?.form && (b.type === 'submit' || b.type === 'image')) captured(b.form);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.isTrusted && e.key === 'Enter' && e.target.type === 'password') captured(e.target.form || document);
  }, true);

  // autofocus: the field got focus before this script loaded, so no focusin will come (skip if already typed in)
  if (!document.activeElement?.value) offer(document.activeElement);
  send({ cmd: 'pending' }).then(prompt);
})();
