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
      h2s: '2 h', h5s: '5 h', d2s: '2 days', hoursS: 'h', daysS: 'd', willRemind: 'Will remind',
      remind: 'Reminder:', reminderClosed: 'reminder closed', noTasks: 'Add tasks in EasyPass', add: '+ Add a task', saved: 'Saved', ask: 'Which tasks are done for this client every month?', next: 'Next', edit: 'Edit task list', update: 'Update EasyPass',
      locked: 'Vault locked — open EasyPass and enter the master password', noHost: 'Not connected — run the EasyPass setup again', error: 'Error: ',
    },
    ru: {
      done: 'Сделано', partial: 'Не завершено', save: 'Сохранить', close: 'Закрыть', retry: 'Повторить',
      h2: '2 часа', h5: '5 часов', tomorrow: 'Завтра', d2: 'Через 2 дня', custom: 'Своё напоминание', hours: 'часов', days: 'дней',
      h2s: '2 ч', h5s: '5 ч', d2s: '2 дня', hoursS: 'ч', daysS: 'дн', willRemind: 'Напомнит',
      remind: 'Напоминание:', reminderClosed: 'напоминание закрыто', noTasks: 'Добавьте работы в EasyPass', add: '+ Добавить работу', saved: 'Сохранено', ask: 'Какие работы делаются этому клиенту каждый месяц?', next: 'Далее', edit: 'Изменить список работ', update: 'Обновите EasyPass',
      locked: 'Хранилище заблокировано — откройте EasyPass и введите мастер-пароль', noHost: 'Нет связи — запустите install.ps1', error: 'Ошибка: ',
    },
    tr: {
      done: 'Yapıldı', partial: 'Bitmedi', save: 'Kaydet', close: 'Kapat', retry: 'Yeniden dene',
      h2: '2 saat', h5: '5 saat', tomorrow: 'Yarın', d2: '2 gün sonra', custom: 'Özel hatırlatma', hours: 'saat', days: 'gün',
      h2s: '2 sa', h5s: '5 sa', d2s: '2 gün', hoursS: 'sa', daysS: 'gün', willRemind: 'Hatırlatılacak',
      remind: 'Hatırlatma:', reminderClosed: 'hatırlatma kapatıldı', noTasks: "EasyPass'te iş ekleyin", add: '+ İş ekle', saved: 'Kaydedildi', ask: 'Bu müşteriye her ay hangi işler yapılır?', next: 'İleri', edit: 'İş listesini değiştir', update: "EasyPass'i güncelleyin",
      locked: "Kilitli — EasyPass'i açıp ana şifreyi girin", noHost: 'Bağlantı yok — kurulum betiğini çalıştırın', error: 'Hata: ',
    },
  };
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, error: 'no_host' }));

  // @font-face does nothing inside a shadow root, so the font goes on the page's document under a private name (a site's own Onest stays
  // alone). Only this site may fetch it (manifest); a page that blocks it leaves the Segoe UI fallback. The file loads when text first uses it.
  for (const [file, weight] of [['Regular', '400'], ['Medium', '500'], ['SemiBold', '600']]) {
    document.fonts.add(new FontFace('EasyPass Onest', `url(${chrome.runtime.getURL(`fonts/Onest-${file}.woff2`)})`, { weight }));
  }
  const STACK = `'EasyPass Onest','Segoe UI Variable','Segoe UI',system-ui,sans-serif`;
  const VARS = '--ink:#16191F;--ink2:#5A6372;--ink3:#8A93A2;--line:#E3E6EC;--line2:#D3D8E1;--hair:rgba(22,25,31,.08);--s2:#F7F8FA;--s3:#EEF0F4;'
    + '--accent:#3449C8;--accent2:#2A3CAE;--tint:#EEF0FB;--done:#0F7A3C;--warn:#F08A1D;--warnink:#9A4B00;--warnline:#F3C38B;--danger:#B42318';
  // Status shapes of the design: filled check, half-filled circle (inline svg, so a page's img-src rule can't hide them).
  const CHECK = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.4l2.2 2.2 4.8-5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const HALF = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 1.4A4.6 4.6 0 0 0 6 10.6z" fill="currentColor"/></svg>';

  const inHours = (n) => new Date(Date.now() + n * 3600_000).toISOString();
  // Day choices ring at 09:00 local, so no reminder wakes anyone at night.
  const inDays = (n) => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 9).toISOString();
  };

  let host, root, T, lang, dialog, overlay, entryId; // entryId: whom the panel on this page asks about
  let carry = null; // the panel's unsaved toggles while the list changes: { ids: tasks that were on it, statuses, picked }

  function shell() {
    host = document.createElement('easypass-work');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647'; // no size of its own: only what it shows covers the page
    root = host.attachShadow({ mode: 'closed' }); // page scripts can't read the customer's name
    root.innerHTML = `<style>
      :host{all:initial;${VARS}}
      *{box-sizing:border-box;margin:0;font-family:${STACK}}
      [hidden]{display:none!important}
      svg{flex:none}
      .back{position:fixed;inset:0;display:grid;place-items:center;padding:16px;background:rgba(22,25,31,.42)}
      .box{display:flex;flex-direction:column;width:560px;max-width:100%;max-height:100%;overflow:hidden;background:#fff;color:var(--ink);
        border-radius:10px;box-shadow:0 1px 2px rgba(22,25,31,.06),0 16px 40px -12px rgba(22,25,31,.22);font-size:13px;line-height:18px}
      .head{flex:none;padding:18px 22px 12px}
      .body{min-height:0;overflow:auto;padding:0 22px 8px}
      h2{font-size:16px;line-height:22px;font-weight:600;letter-spacing:-.01em;overflow-wrap:anywhere}
      .rows{display:flex;flex-direction:column}
      .row{display:grid;grid-template-columns:minmax(0,1fr);padding:0}
      .row+.row{border-top:1px solid var(--hair)}
      .top{display:flex;align-items:center;gap:12px;min-height:40px;padding:6px 0}
      .task{flex:1;min-width:0;font-weight:500;overflow-wrap:anywhere}
      .row.warn .task{color:var(--warnink)}
      .seg{display:inline-flex;flex:none;height:28px;overflow:hidden;border:1px solid var(--line2);border-radius:6px;background:#fff}
      .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--line2);border-radius:6px;
        background:#fff;color:var(--ink);font-size:13px;font-weight:500;white-space:nowrap;cursor:pointer}
      .btn:hover{background:var(--s2)}
      .btn:disabled{opacity:.5;cursor:default}
      .primary,.primary:hover{background:var(--accent);border-color:var(--accent2);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}
      .primary:hover{background:var(--accent2)}
      .primary:disabled{background:#AEB5E6;border-color:#AEB5E6;box-shadow:none;opacity:1}
      .btn.link{height:auto;padding:0;border:0;background:none;color:var(--accent);font-size:12px}
      .btn.link:hover{background:none;text-decoration:underline}
      .seg .btn{height:100%;padding:0 10px;border:0;border-right:1px solid var(--line2);border-radius:0;color:var(--ink2);font-size:12px}
      .seg .btn:last-child{border-right:0}
      .seg .btn:hover{background:var(--s3)}
      .btn svg{display:none}
      .btn[aria-pressed=true] svg{display:block}
      .seg .done[aria-pressed=true]{background:var(--done);color:#fff}
      .seg .partial[aria-pressed=true]{background:var(--warn);color:#2B1700}
      .seg .done[aria-pressed=true]:hover{background:var(--done)}
      .seg .partial[aria-pressed=true]:hover{background:var(--warn)}
      .remind{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;margin:0 0 10px;padding:8px 12px;border:1px solid var(--warnline);border-radius:8px;background:#fff}
      .when{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;white-space:nowrap}
      .rlabel{margin-right:4px;font-size:12px;color:var(--ink2)}
      .chip{flex:none;height:26px;padding:0 10px;border:1px solid var(--line2);border-radius:13px;background:#fff;color:var(--ink);font-size:12px;font-weight:500;cursor:pointer}
      .chip:hover{background:var(--s3)}
      .chip[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:#fff}
      .sh{display:none}
      .short .lg{display:none}
      .short .sh{display:inline}
      .bare .rlabel{display:none}
      .custom{display:inline-flex;flex:none;height:26px;overflow:hidden;border:1px solid var(--ink3);border-radius:4px;background:#fff}
      .custom:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--tint)}
      .custom input{width:44px;height:100%;padding:0 6px;border:0;outline:0;background:none;color:var(--ink);font-size:12px;text-align:right;font-variant-numeric:tabular-nums}
      .custom input::-webkit-inner-spin-button{appearance:none}
      .custom select{height:100%;padding:0 2px;border:0;border-left:1px solid var(--line2);outline:0;background:var(--s2);color:var(--ink2);font-size:12px;font-weight:500;cursor:pointer}
      .at{font-size:12px;line-height:16px;color:var(--ink2)}
      .at:empty{display:none}
      .at b{font-weight:500;color:var(--ink)}
      .check{display:flex;align-items:flex-start;gap:10px;min-height:36px;padding:9px 0;font-weight:500;cursor:pointer}
      .check span{min-width:0;overflow-wrap:anywhere}
      input[type=checkbox]{appearance:none;display:grid;place-content:center;flex:none;width:18px;height:18px;border:1.5px solid var(--ink3);border-radius:5px;background:#fff;cursor:pointer}
      input[type=checkbox]:checked{background:var(--accent);border-color:var(--accent)}
      input[type=checkbox]:checked::after{content:"";width:5px;height:9px;margin-top:-2px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
      .over{position:fixed;inset:0;display:grid;place-items:center;padding:16px;background:rgba(22,25,31,.42)}
      .small{width:360px}
      .scroll{display:flex;flex-direction:column;max-height:240px;overflow:auto}
      .note{margin-bottom:4px;font-size:12px;color:var(--ink2)}
      .err{margin-top:6px;font-size:12px;color:var(--danger)}
      .err:empty{display:none}
      .actions{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:14px 22px 18px;border-top:1px solid var(--line);background:var(--s2)}
      .spacer{flex:1}
      .actions .primary{margin-left:auto}
      :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
      .seg :focus-visible{outline-offset:-2px}
      .hint{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:12px;padding:10px 12px;background:#fff;color:var(--ink);
        border:1px solid var(--line);border-radius:8px;box-shadow:0 1px 2px rgba(22,25,31,.05),0 8px 24px -8px rgba(22,25,31,.18);font-size:13px}
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

  // Header, scrolling body, and the footer band (links on the left, buttons on the right).
  const frame = (box, title, body, links, ...buttons) => {
    const head = el('div', 'head');
    head.append(title);
    const main = el('div', 'body');
    main.append(...body);
    const foot = el('div', 'actions');
    foot.append(...links, el('span', 'spacer'), ...buttons);
    box.append(head, main, foot);
  };

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      overlay ? closeOverlay() : closeSession();
    }
  }

  // Modal: Tab stays inside, and the page gets none of our keys.
  function trapTab(e) {
    e.stopPropagation();
    if (e.key !== 'Tab') return;
    const all = [...(overlay || dialog).querySelectorAll('button:not(:disabled), input, select')].filter((x) => x.getClientRects().length);
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
    host = root = dialog = overlay = null;
    carry = null;
    document.dispatchEvent(new CustomEvent('easypass:work-panel', { detail: { open: false } }));
  }

  // A mark in a corner of the page, in its own closed shadow root: no focus, no click, gone after a second.
  function flashSaved() {
    const flash = document.createElement('easypass-saved');
    flash.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647';
    const r = flash.attachShadow({ mode: 'closed' });
    r.innerHTML = `<style>*{box-sizing:border-box;margin:0;font-family:${STACK}}`
      + '.saved{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:7px;height:32px;padding:0 12px 0 10px;border-radius:16px;background:#16191F;color:#fff;'
      + 'box-shadow:0 1px 2px rgba(22,25,31,.05),0 8px 24px -8px rgba(22,25,31,.18);font-size:12px;font-weight:500;pointer-events:none}</style>';
    const mark = el('div', 'saved');
    mark.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6.5" fill="#0F7A3C"/><path d="M4 7.2l2 2 4-4.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    mark.append(T.saved);
    mark.setAttribute('role', 'status');
    r.append(mark);
    document.documentElement.append(flash);
    setTimeout(() => flash.remove(), 1000);
  }

  function closeOverlay() {
    overlay.remove();
    overlay = null;
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
    frame(dialog, el('h2', '', 'EasyPass'), [line], [], btn('', T.close, closeSession), again);
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

  // Spec §7d: the pool as checkboxes, for a customer without a list yet or to change it. Далее stores the list; Close does not.
  function showChecklist(w, ticked) {
    openModal();
    const chosen = new Set(ticked);
    const error = el('p', 'err');
    error.setAttribute('role', 'alert');
    const next = btn('primary', T.next, async () => {
      next.disabled = true;
      error.textContent = '';
      const r = await send({ cmd: 'work_assign', entryId, taskIds: w.allTasks.map((x) => x.id).filter((id) => chosen.has(id)) });
      if (r.ok) return pageLoaded(); // the normal panel, now with the chosen tasks only
      if (r.error === 'not_found') return closeModal(); // answered in another tab
      error.textContent = message(r.error, false);
      next.disabled = false;
    });
    next.disabled = !chosen.size;
    const list = el('div', 'rows');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', T.ask);
    list.append(...w.allTasks.map((task) => {
      const label = el('label', 'check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = chosen.has(task.id);
      box.addEventListener('change', () => {
        box.checked ? chosen.add(task.id) : chosen.delete(task.id);
        next.disabled = !chosen.size;
      });
      label.append(box, el('span', '', task.name));
      return label;
    }));
    const title = el('h2', '', [w.name, w.username].filter(Boolean).join(' · '));
    dialog.setAttribute('aria-label', title.textContent);
    frame(dialog, title, [el('p', 'note', T.ask), list, error], [], btn('', T.close, closeSession), next);
    dialog.querySelector('input').focus();
  }

  // Spec §13: the pool's tasks that are not on the customer's list, in front of the panel. Save adds them to the list.
  function showAdd(w, addable, back, remember) {
    const chosen = new Set();
    const error = el('p', 'err');
    error.setAttribute('role', 'alert');
    const save = btn('primary', T.save, async () => {
      save.disabled = true;
      error.textContent = '';
      const keep = new Set([...w.tasks.map((x) => x.id), ...chosen]);
      const r = await send({ cmd: 'work_assign', entryId, taskIds: w.allTasks.map((x) => x.id).filter((id) => keep.has(id)) });
      if (r.ok) return void (remember(), closeOverlay(), pageLoaded()); // the panel again, with the new tasks and the old toggles
      if (r.error === 'not_found') return closeModal(); // answered in another tab
      error.textContent = message(r.error, false);
      save.disabled = false;
    });
    save.disabled = true;
    const list = el('div', 'scroll');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', T.add);
    list.append(...addable.map((task) => {
      const label = el('label', 'check');
      const box = el('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => {
        box.checked ? chosen.add(task.id) : chosen.delete(task.id);
        save.disabled = !chosen.size;
      });
      label.append(box, el('span', '', task.name));
      return label;
    }));
    const box = el('div', 'box small');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', T.add);
    frame(box, el('h2', '', T.add), [list, error], [], btn('', T.close, () => (closeOverlay(), back.focus())), save);
    overlay = el('div', 'over');
    overlay.append(box);
    root.append(overlay);
    list.querySelector('input').focus();
  }

  function showPanel(w) {
    openModal();
    const when = (iso) => new Date(iso).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const statuses = { ...w.statuses };
    const picked = {}; // taskId → UTC ISO; only what is chosen now goes to the host, never the reminder it already has
    if (carry) { // back from changing the list: what was pressed stays for the tasks that were already there
      for (const { id } of w.tasks.filter((x) => carry.ids.has(x.id))) {
        if (carry.statuses[id]) statuses[id] = carry.statuses[id];
        else delete statuses[id];
        if (carry.picked[id]) picked[id] = carry.picked[id];
      }
      carry = null;
    }
    const remember = () => { carry = { ids: new Set(w.tasks.map((x) => x.id)), statuses, picked }; };
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
      const pair = el('div', 'seg');
      const toggle = (status, cls, text, icon) => {
        const b = btn(cls, text, () => {
          if (statuses[task.id] === status) delete statuses[task.id];
          else statuses[task.id] = status;
          refresh();
        });
        b.insertAdjacentHTML('afterbegin', icon); // shown only while pressed
        b.setAttribute('aria-label', `${task.name}: ${text}`);
        refreshers.push(() => b.setAttribute('aria-pressed', statuses[task.id] === status));
        return b;
      };
      pair.append(toggle('done', 'done', T.done, CHECK), toggle('partial', 'partial', T.partial, HALF));
      top.append(el('span', 'task', task.name), pair);

      // One line, never wrapped: the box is a rectangle with its unit beside it, apart from the pill-shaped choices.
      const remind = el('div', 'remind');
      const below = el('div', 'when');
      const note = el('p', 'at');
      below.append(el('span', 'rlabel', T.remind));
      const number = el('input');
      const unit = el('select');
      const pick = (value, chosen) => {
        if (value) picked[task.id] = value;
        else delete picked[task.id];
        for (const [b, name] of presets) b.setAttribute('aria-pressed', name === chosen);
        refresh();
      };
      const presets = [[T.h2, T.h2s, () => inHours(2)], [T.h5, T.h5s, () => inHours(5)], [T.tomorrow, T.tomorrow, () => inDays(1)], [T.d2, T.d2s, () => inDays(2)]].map(([text, short, at]) => {
        const b = btn('chip', '', () => {
          number.value = '';
          pick(at(), text);
        });
        b.append(el('span', 'lg', text), el('span', 'sh', short));
        b.title = text;
        b.setAttribute('aria-label', `${task.name}: ${text}`);
        b.setAttribute('aria-pressed', 'false');
        below.append(b);
        return [b, text];
      });
      number.type = 'number';
      number.min = 1;
      number.step = 1;
      number.setAttribute('aria-label', `${task.name}: ${T.custom}`);
      number.title = T.custom;
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
      // Full words while they fit; then short ones; only then the row's own label goes. Measured, so any font does.
      const fit = () => {
        if (!below.clientWidth) return; // hidden
        below.classList.remove('short', 'bare');
        unit.options[0].text = T.hours;
        unit.options[1].text = T.days;
        const over = () => below.scrollWidth > below.clientWidth;
        if (!over()) return;
        below.classList.add('short');
        unit.options[0].text = T.hoursS;
        unit.options[1].text = T.daysS;
        if (over()) below.classList.add('bare');
      };
      const watch = new ResizeObserver(fit); // the box, and a font arriving late
      for (const e of [below, ...below.children]) watch.observe(e);
      remind.append(below, note);

      refreshers.push(() => {
        const orange = statuses[task.id] === 'partial';
        remind.hidden = !orange;
        row.classList.toggle('warn', orange);
        const r = existing[task.id];
        note.textContent = picked[task.id] ? `${T.willRemind} ${when(picked[task.id])}`
          : r?.dismissed ? T.reminderClosed : r ? `${T.willRemind} ${when(r.dueAt)}` : '';
      });
      row.append(top, remind);
      return row;
    });

    const list = el('div', 'rows');
    list.append(...rows);
    const error = el('p', 'err');
    error.setAttribute('role', 'alert');
    const save = btn('primary', T.save, doSave);
    const links = [];
    const addable = (w.allTasks || []).filter((x) => !w.tasks.some((y) => y.id === x.id));
    if (addable.length) {
      const add = btn('link', T.add, () => showAdd(w, addable, add, remember));
      links.push(add);
    }
    if (w.allTasks) links.push(btn('link', T.edit, () => (remember(), showChecklist(w, w.tasks.map((x) => x.id)))));
    async function doSave() {
      busy = true;
      error.textContent = '';
      refresh();
      const reminders = {};
      for (const [id, at] of Object.entries(picked)) if (statuses[id] === 'partial') reminders[id] = at;
      const r = await send({ cmd: 'work_save', entryId, statuses, reminders });
      busy = false;
      if (r.ok || r.error === 'not_found') {
        closeModal(); // not_found: answered in another tab
        if (r.ok) flashSaved();
        return;
      }
      error.textContent = message(r.error, false);
      save.textContent = T.retry;
      refresh();
    }

    const title = el('h2', '', [w.name, w.username].filter(Boolean).join(' · '));
    dialog.setAttribute('aria-label', title.textContent);
    frame(dialog, title, [list, error], links, btn('', T.close, closeSession), save);
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
    const { assigned = true, allTasks = r.panel.tasks } = r.panel; // a host from before §7d has one list for everybody
    if (!allTasks.length) {
      if (dialog) closeModal();
      return showHint();
    }
    if (!assigned) return showChecklist({ ...r.panel, allTasks }, allTasks.filter((x) => r.panel.statuses[x.id]).map((x) => x.id)); // marked ones come ticked
    showPanel(r.panel);
  }

  document.addEventListener('click', (e) => {
    if (e.isTrusted && e.target.closest?.(LOGOUT)) send({ cmd: 'salyk_logout' });
  }, true);
  chrome.runtime.onMessage.addListener((r) => { if (r.readName) readName(r.username); }); // a login saved on this page
  pageLoaded();
})();
