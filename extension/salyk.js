// Monthly work on the tracked sites only (manifest): reads the customer's name, and after a logout asks what was done.
// No timers: it acts on page load and on clicks. The background keeps the session; login and password never come here from it.
(() => {
  // The organization page (spec §8), the only place that reads the site's structure.
  const SELECT = { row: 'tr', name: 'span.text-gray-800', number: 'span.text-gray-600' };
  const LOGOUT = 'a[href*="logout" i], form[action*="logout" i] button, form[action*="logout" i] input[type=submit]';
  const MAX_HOURS = 8760, MAX_DAYS = 364; // the host refuses a reminder over a year away

  const TEXT = {
    en: {
      done: 'Done', partial: 'Not finished', save: 'Save', close: 'Close', retry: 'Try again',
      h2: '2 hours', h5: '5 hours', tomorrow: 'Tomorrow', d2: 'In 2 days', custom: 'Custom reminder', hours: 'hours', days: 'days',
      remind: 'Reminder:', reminderClosed: 'reminder closed', noTasks: 'Add tasks in EasyPass', update: 'Update EasyPass',
      locked: 'Vault locked — open EasyPass and enter the master password', noHost: 'Not connected — run the EasyPass setup again', error: 'Error: ',
    },
    ru: {
      done: 'Сделано', partial: 'Не завершено', save: 'Сохранить', close: 'Закрыть', retry: 'Повторить',
      h2: '2 часа', h5: '5 часов', tomorrow: 'Завтра', d2: 'Через 2 дня', custom: 'Своё напоминание', hours: 'часов', days: 'дней',
      remind: 'Напоминание:', reminderClosed: 'напоминание закрыто', noTasks: 'Добавьте работы в EasyPass', update: 'Обновите EasyPass',
      locked: 'Хранилище заблокировано — откройте EasyPass и введите мастер-пароль', noHost: 'Нет связи — запустите install.ps1', error: 'Ошибка: ',
    },
    tr: {
      done: 'Yapıldı', partial: 'Bitmedi', save: 'Kaydet', close: 'Kapat', retry: 'Yeniden dene',
      h2: '2 saat', h5: '5 saat', tomorrow: 'Yarın', d2: '2 gün sonra', custom: 'Özel hatırlatma', hours: 'saat', days: 'gün',
      remind: 'Hatırlatma:', reminderClosed: 'hatırlatma kapatıldı', noTasks: "EasyPass'te iş ekleyin", update: "EasyPass'i güncelleyin",
      locked: "Kilitli — EasyPass'i açıp ana şifreyi girin", noHost: 'Bağlantı yok — kurulum betiğini çalıştırın', error: 'Hata: ',
    },
  };
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, error: 'no_host' }));

  const inHours = (n) => new Date(Date.now() + n * 3600_000).toISOString();
  // Day choices ring at 09:00 local, so no reminder wakes anyone at night.
  const inDays = (n) => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 9).toISOString();
  };

  let host, root, T, lang, dialog, entryId; // entryId: whom the panel on this page asks about

  function shell() {
    host = document.createElement('easypass-work');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647'; // no size of its own: only what it shows covers the page
    root = host.attachShadow({ mode: 'closed' }); // page scripts can't read the customer's name
    root.innerHTML = `<style>
      :host{all:initial}
      *{box-sizing:border-box;margin:0;font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif}
      [hidden]{display:none!important}
      .back{position:fixed;inset:0;display:grid;place-items:center;padding:16px;background:rgba(28,31,35,.5)}
      .box{display:grid;gap:12px;width:480px;max-width:100%;max-height:100%;overflow:auto;padding:16px;background:#fff;color:#1C1F23;
        border:1px solid #E3E1DC;border-radius:8px;box-shadow:0 8px 24px rgba(28,31,35,.14);font-size:14px}
      h2{font-size:16px;font-weight:600;overflow-wrap:anywhere}
      .rows{display:grid;gap:8px}
      .row{display:grid;gap:8px;padding:8px 10px;border:1px solid #E3E1DC;border-radius:8px}
      .top{display:flex;align-items:center;gap:8px}
      .task{flex:1;min-width:0;font-weight:600;overflow-wrap:anywhere}
      .pair,.when,.actions{display:flex;flex-wrap:wrap;gap:6px}
      .btn{height:32px;padding:0 10px;border:1px solid #E3E1DC;border-radius:8px;background:#fff;color:#1C1F23;font-size:13px;font-weight:600;cursor:pointer}
      .btn[aria-pressed=true],.primary{background:#0E7C6B;border-color:#0E7C6B;color:#fff}
      .btn.orange[aria-pressed=true]{background:#C2410C;border-color:#C2410C}
      .btn:disabled{opacity:.5;cursor:default}
      .custom{display:flex;gap:6px}
      input,select{height:32px;padding:0 8px;border:1px solid #E3E1DC;border-radius:8px;background:#fff;color:#1C1F23;font-size:13px}
      input{width:72px}
      .note{font-size:12px;color:#5B6168}
      .note:empty{display:none}
      .err{font-size:13px;color:#B91C1C}
      .err:empty{display:none}
      .actions{justify-content:flex-end}
      .actions .btn{height:36px;padding:0 14px;font-size:14px}
      :focus-visible{outline:2px solid #0E7C6B;outline-offset:2px}
      .hint{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;color:#1C1F23;
        border:1px solid #E3E1DC;border-radius:8px;box-shadow:0 8px 24px rgba(28,31,35,.14);font-size:13px}
    </style>`;
    document.documentElement.append(host);
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const btn = (cls, text, click) => {
    const b = el('button', 'btn ' + cls, text);
    b.type = 'button';
    b.addEventListener('click', click);
    return b;
  };

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSession();
    }
  }

  // Modal: Tab stays inside, and the page gets none of our keys.
  function trapTab(e) {
    e.stopPropagation();
    if (e.key !== 'Tab') return;
    const all = [...dialog.querySelectorAll('button:not(:disabled), input, select')].filter((x) => x.getClientRects().length);
    const at = all.indexOf(root.activeElement);
    if (at === (e.shiftKey ? 0 : all.length - 1) || at < 0) {
      e.preventDefault();
      all.at(e.shiftKey ? -1 : 0)?.focus();
    }
  }

  function openModal() {
    if (dialog) return dialog.replaceChildren();
    shell();
    const back = el('div', 'back');
    dialog = el('div', 'box');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'EasyPass');
    back.append(dialog);
    root.append(back);
    for (const type of ['keydown', 'keyup', 'keypress', 'input']) root.addEventListener(type, (e) => e.stopPropagation());
    root.addEventListener('keydown', trapTab);
    document.addEventListener('keydown', onKey, true);
    document.dispatchEvent(new CustomEvent('easypass:work-panel', { detail: { open: true } }));
  }

  function closeModal() {
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    host = root = dialog = null;
    document.dispatchEvent(new CustomEvent('easypass:work-panel', { detail: { open: false } }));
  }

  function closeSession() {
    send({ cmd: 'work_close', entryId });
    closeModal();
  }

  // bad_request while reading the tasks can only mean a host that doesn't know the command (the session's month and site are valid).
  const message = (error, reading) => ({ locked: T.locked, no_host: T.noHost, ...(reading && { bad_request: T.update }) })[error] ?? T.error + error;

  function showError(error) {
    openModal();
    const again = btn('primary', T.retry, pageLoaded);
    const line = el('p', 'err', message(error, true));
    line.setAttribute('role', 'alert');
    const actions = el('div', 'actions');
    actions.append(again);
    actions.append(btn('', T.close, closeSession));
    dialog.append(el('h2', '', 'EasyPass'), line, actions);
    again.focus();
  }

  function showHint() {
    send({ cmd: 'work_close', entryId }); // nothing to ask: this visit is over
    shell();
    const box = el('div', 'hint', T.noTasks);
    box.setAttribute('role', 'status');
    box.append(btn('', T.close, () => { host.remove(); host = root = null; }));
    root.append(box);
  }

  function showPanel(w) {
    openModal();
    const when = (iso) => new Date(iso).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const statuses = { ...w.statuses };
    const picked = {}; // taskId → UTC ISO; only what is chosen now goes to the host, never the reminder it already has
    const existing = Object.fromEntries(w.reminders.map((r) => [r.taskId, r]));
    const refreshers = [];
    const refresh = () => {
      for (const f of refreshers) f();
      save.disabled = busy || w.tasks.some((x) => statuses[x.id] === 'partial' && !picked[x.id] && !existing[x.id]);
    };
    let busy = false;

    const rows = w.tasks.map((task) => {
      const row = el('div', 'row');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', task.name);
      const top = el('div', 'top');
      const pair = el('div', 'pair');
      const toggle = (status, cls, text) => {
        const b = btn(cls, text, () => {
          if (statuses[task.id] === status) delete statuses[task.id];
          else statuses[task.id] = status;
          refresh();
        });
        b.setAttribute('aria-label', `${task.name}: ${text}`);
        refreshers.push(() => b.setAttribute('aria-pressed', statuses[task.id] === status));
        return b;
      };
      pair.append(toggle('done', '', T.done), toggle('partial', 'orange', T.partial));
      top.append(el('span', 'task', task.name), pair);

      const below = el('div', 'when');
      const note = el('p', 'note');
      const number = el('input');
      const unit = el('select');
      const pick = (value, chosen) => {
        if (value) picked[task.id] = value;
        else delete picked[task.id];
        for (const [b, name] of presets) b.setAttribute('aria-pressed', name === chosen);
        refresh();
      };
      const presets = [[T.h2, () => inHours(2)], [T.h5, () => inHours(5)], [T.tomorrow, () => inDays(1)], [T.d2, () => inDays(2)]].map(([text, at]) => {
        const b = btn('', text, () => {
          number.value = '';
          pick(at(), text);
        });
        b.setAttribute('aria-label', `${task.name}: ${text}`);
        b.setAttribute('aria-pressed', 'false');
        below.append(b);
        return [b, text];
      });
      number.type = 'number';
      number.min = 1;
      number.step = 1;
      number.setAttribute('aria-label', `${task.name}: ${T.custom}`);
      unit.setAttribute('aria-label', `${task.name}: ${T.hours} / ${T.days}`);
      unit.append(new Option(T.hours, 'h'), new Option(T.days, 'd'));
      const typed = () => {
        const n = Number(number.value);
        const max = unit.value === 'h' ? MAX_HOURS : MAX_DAYS;
        pick(Number.isInteger(n) && n >= 1 && n <= max ? (unit.value === 'h' ? inHours(n) : inDays(n)) : null);
      };
      number.addEventListener('input', typed);
      unit.addEventListener('change', typed);
      const custom = el('div', 'custom');
      custom.append(number, unit);
      below.append(custom);

      refreshers.push(() => {
        const orange = statuses[task.id] === 'partial';
        below.hidden = note.hidden = !orange;
        const r = existing[task.id];
        note.textContent = picked[task.id] ? `${T.remind} ${when(picked[task.id])}`
          : r?.dismissed ? T.reminderClosed : r ? `${T.remind} ${when(r.dueAt)}` : '';
      });
      row.append(top, below, note);
      return row;
    });

    const list = el('div', 'rows');
    list.append(...rows);
    const error = el('p', 'err');
    error.setAttribute('role', 'alert');
    const actions = el('div', 'actions');
    const save = btn('primary', T.save, doSave);
    actions.append(save, btn('', T.close, closeSession));
    async function doSave() {
      busy = true;
      error.textContent = '';
      refresh();
      const reminders = {};
      for (const [id, at] of Object.entries(picked)) if (statuses[id] === 'partial') reminders[id] = at;
      const r = await send({ cmd: 'work_save', entryId, statuses, reminders });
      busy = false;
      if (r.ok || r.error === 'not_found') return closeModal(); // not_found: answered in another tab
      error.textContent = message(r.error, false);
      save.textContent = T.retry;
      refresh();
    }

    const title = el('h2', '', [w.name, w.username].filter(Boolean).join(' · '));
    dialog.setAttribute('aria-label', title.textContent);
    dialog.append(title, list, error, actions);
    refresh();
    dialog.querySelector('button').focus();
  }

  function readName(username) {
    const rows = [...document.querySelectorAll(SELECT.row)].filter((r) => r.querySelector(SELECT.name));
    const mine = rows.length === 1 ? rows : rows.filter((r) => {
      const number = r.querySelector(SELECT.number)?.textContent.trim();
      return number && username.startsWith(number);
    });
    if (mine.length !== 1) return; // never a wrong name: leave it empty
    const text = mine[0].querySelector(SELECT.name).textContent.replace(/\s+/g, ' ').trim();
    if (text.split(' ').length >= 2 && !/\d/.test(text) && text.length < 100) send({ cmd: 'salyk_name', text });
  }

  async function pageLoaded() {
    const r = await send({ cmd: 'salyk_page' });
    if (r?.readName) readName(r.username);
    if (r?.panel === undefined && r?.ok !== false) return void (dialog && closeModal()); // nothing to ask (any more)
    entryId = r.panel?.entryId;
    const asked = await send({ cmd: 'lang' });
    lang = TEXT[asked] ? asked : 'ru';
    T = TEXT[lang];
    if (r.ok === false) return showError(r.error); // the extension itself could not answer
    if (!r.panel.ok) return showError(r.panel.error);
    if (r.panel.tasks.length) return showPanel(r.panel);
    if (dialog) closeModal();
    showHint();
  }

  document.addEventListener('click', (e) => {
    if (e.isTrusted && e.target.closest?.(LOGOUT)) send({ cmd: 'salyk_logout' });
  }, true);
  chrome.runtime.onMessage.addListener((r) => { if (r.readName) readName(r.username); }); // a login saved on this page
  pageLoaded();
})();
