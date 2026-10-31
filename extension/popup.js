// Toolbar popup: connection status, then a search over every site's entries; a click opens one entry's details.
// Language comes from the EasyPass app settings (host status), default Russian.
const TEXT = {
  en: {
    ok: (n) => `Connected · ${n} ${n === 1 ? 'client' : 'clients'}`,
    locked: 'Vault locked — open EasyPass and enter the master password',
    noHost: 'Not connected — run the EasyPass setup again',
    search: 'Find a client or site…', searchLabel: 'Find a client', list: 'Clients', none: 'No matches',
    back: '← Back', site: 'Site', username: 'Username', password: 'Password', extra1: 'Note 1', extra2: 'Note 2',
    show: 'Show', hide: 'Hide', copy: 'Copy', copied: 'Copied', error: 'Error: ',
    summary: (r) => `This month: done ${r.done} · not finished ${r.partial} · not started ${r.notStarted}`,
    done: 'Done', partial: 'Not finished', close: 'Close', save: 'Save', saved: 'Saved', retry: 'Try again', noTasks: 'Add tasks in EasyPass', add: '+ Add a task', ask: 'Which tasks are done for this client every month?', next: 'Next', edit: 'Edit task list',
    h2: '2 hours', h5: '5 hours', tomorrow: 'Tomorrow', d2: 'In 2 days', custom: 'Custom reminder', hours: 'hours', days: 'days',
    h2s: '2 h', h5s: '5 h', d2s: '2 days', hoursS: 'h', daysS: 'd', willRemind: 'Will remind',
    remind: 'Reminder:', reminderClosed: 'reminder closed',
  },
  ru: {
    ok: (n) => `Подключено · ${n} ${{ one: 'клиент', few: 'клиента' }[new Intl.PluralRules('ru').select(n)] || 'клиентов'}`,
    locked: 'Хранилище заблокировано — откройте EasyPass и введите мастер-пароль',
    noHost: 'Нет связи — запустите install.ps1',
    search: 'Найти клиента или сайт…', searchLabel: 'Поиск клиента', list: 'Клиенты', none: 'Ничего не найдено',
    back: '← Назад', site: 'Сайт', username: 'Логин', password: 'Пароль', extra1: 'Доп. информация 1', extra2: 'Доп. информация 2',
    show: 'Показать', hide: 'Скрыть', copy: 'Копировать', copied: 'Скопировано', error: 'Ошибка: ',
    summary: (r) => `Этот месяц: готово ${r.done} · не завершено ${r.partial} · не начато ${r.notStarted}`,
    done: 'Сделано', partial: 'Не завершено', close: 'Закрыть', save: 'Сохранить', saved: 'Сохранено', retry: 'Повторить', noTasks: 'Добавьте работы в EasyPass', add: '+ Добавить работу', ask: 'Какие работы делаются этому клиенту каждый месяц?', next: 'Далее', edit: 'Изменить список работ',
    h2: '2 часа', h5: '5 часов', tomorrow: 'Завтра', d2: 'Через 2 дня', custom: 'Своё напоминание', hours: 'часов', days: 'дней',
    h2s: '2 ч', h5s: '5 ч', d2s: '2 дня', hoursS: 'ч', daysS: 'дн', willRemind: 'Напомнит',
    remind: 'Напоминание:', reminderClosed: 'напоминание закрыто',
  },
  tr: {
    ok: (n) => `Bağlı · ${n} müşteri`,
    locked: "Kilitli — EasyPass'i açıp ana şifreyi girin",
    noHost: 'Bağlantı yok — kurulum betiğini çalıştırın',
    search: 'Müşteri ya da site ara…', searchLabel: 'Müşteri ara', list: 'Müşteriler', none: 'Sonuç yok',
    back: '← Geri', site: 'Site', username: 'Kullanıcı adı', password: 'Şifre', extra1: 'Ek bilgi 1', extra2: 'Ek bilgi 2',
    show: 'Göster', hide: 'Gizle', copy: 'Kopyala', copied: 'Kopyalandı', error: 'Hata: ',
    summary: (r) => `Bu ay: bitti ${r.done} · yarım ${r.partial} · başlanmadı ${r.notStarted}`,
    done: 'Yapıldı', partial: 'Bitmedi', close: 'Kapat', save: 'Kaydet', saved: 'Kaydedildi', retry: 'Yeniden dene', noTasks: "EasyPass'te iş ekleyin", add: '+ İş ekle', ask: 'Bu müşteriye her ay hangi işler yapılır?', next: 'İleri', edit: 'İş listesini değiştir',
    h2: '2 saat', h5: '5 saat', tomorrow: 'Yarın', d2: '2 gün sonra', custom: 'Özel hatırlatma', hours: 'saat', days: 'gün',
    h2s: '2 sa', h5s: '5 sa', d2s: '2 gün', hoursS: 'sa', daysS: 'gün', willRemind: 'Hatırlatılacak',
    remind: 'Hatırlatma:', reminderClosed: 'hatırlatma kapatıldı',
  },
};
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, error: 'no_host' }));
let t = TEXT.ru, items = [], active = -1, query = 0, opened = 0;
let carry = null; // the unsaved toggles while the list changes: { ids: tasks that were on it, statuses, picked }

function showStatus(r) {
  t = TEXT[r?.lang] || TEXT.ru;
  document.documentElement.lang = TEXT[r?.lang] ? r.lang : 'ru';
  const ready = r?.ok && !r.locked;
  $('status').textContent = ready ? t.ok(r.count) : r?.locked || r?.error === 'locked' ? t.locked : t.noHost;
  $('status').className = ready ? 'ok' : '';
  return ready;
}

// One host search per keystroke, like the page panel; late replies of older keystrokes are dropped.
async function search(text) {
  const mine = ++query;
  const r = await send({ cmd: 'all', q: text });
  if (mine !== query) return;
  items = r.ok ? r.items : [];
  active = items.length ? 0 : -1;
  $('empty').hidden = !!items.length;
  $('empty').textContent = r.ok ? t.none : t.error + r.error;
  $('list').replaceChildren(...items.map((it, i) => {
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
    s.textContent = [it.site, it.username].filter(Boolean).join(' · ');
    b.append(n, s);
    b.addEventListener('click', () => openEntry(it));
    return b;
  }));
  mark();
}

function mark() {
  [...$('list').children].forEach((b, i) => b.setAttribute('aria-selected', i === active));
  const b = $('list').children[active];
  if (b) {
    $('q').setAttribute('aria-activedescendant', b.id);
    b.scrollIntoView({ block: 'nearest' });
  } else $('q').removeAttribute('aria-activedescendant');
}

function copyButton(value) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = t.copy;
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value());
      $('note').textContent = t.copied;
    } catch (e) {
      $('note').textContent = t.error + e.message;
    }
  });
  return b;
}

function field(label, value, { copy = false, secret = false } = {}) {
  const box = document.createElement('div');
  box.className = 'field';
  const l = document.createElement('div');
  l.className = 'label';
  l.textContent = label;
  const row = document.createElement('div');
  row.className = 'row';
  const v = document.createElement('span');
  v.className = 'value';
  row.append(v);
  if (secret) {
    // shown only on request: the popup may be open while someone looks at the screen
    let shown = false;
    const render = () => {
      v.textContent = shown ? value : '•'.repeat(Math.min(value.length, 12));
      v.classList.toggle('secret', !shown);
      toggle.textContent = shown ? t.hide : t.show;
    };
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn';
    toggle.addEventListener('click', () => { shown = !shown; render(); });
    row.append(toggle);
    render();
  } else v.textContent = value;
  if (copy) row.append(copyButton(() => value));
  box.append(l, row);
  return box;
}

// This month's work of a tracked-site customer, edited without signing in (spec §7c). Same rules and texts as the page panel
// in salyk.js (a content script cannot be imported here). The background refuses sites that are not tracked.
const MAX_HOURS = 8760, MAX_DAYS = 364; // the host refuses a reminder over a year away
const inHours = (n) => new Date(Date.now() + n * 3600_000).toISOString();
// Day choices ring at 09:00 local, so no reminder wakes anyone at night.
const inDays = (n) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 9).toISOString();
};
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
// Status shapes of the design; shown only while a toggle is pressed.
const CHECK = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.4l2.2 2.2 4.8-5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const HALF = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 1.4A4.6 4.6 0 0 0 6 10.6z" fill="currentColor"/></svg>';
const fail = (error) => ({ locked: t.locked, no_host: t.noHost })[error] ?? t.error + error;

// Spec §7d: the pool as checkboxes, for a customer without a list yet or to change it.
function showChecklist(item, w, ticked) {
  const chosen = new Set(ticked);
  const error = el('p', 'err');
  error.setAttribute('role', 'alert');
  const mine = opened;
  const next = btn('primary', t.next, async () => {
    next.disabled = true;
    error.textContent = '';
    const r = await send({ cmd: 'work_assign', site: item.site, entryId: item.id, taskIds: w.allTasks.map((x) => x.id).filter((id) => chosen.has(id)) });
    if (mine !== opened) return;
    if (r.ok) return showWork(item, await send({ cmd: 'work_get', site: item.site, entryId: item.id }));
    error.textContent = fail(r.error);
    next.disabled = false;
  });
  next.disabled = !chosen.size;
  const list = el('div', 'checks');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', t.ask);
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
  const actions = el('div', 'actions');
  actions.append(el('span', 'spacer'), next);
  $('work').replaceChildren(el('p', 'ask', t.ask), list, error, actions);
}

// Spec §13: the pool's tasks that are not on the customer's list, in front of the details. Save adds them to the list.
function showAdd(item, w, addable, back, remember) {
  const mine = opened;
  const chosen = new Set();
  const over = el('div', 'over');
  const close = () => {
    over.remove();
    back.focus();
  };
  const error = el('p', 'err');
  error.setAttribute('role', 'alert');
  const save = btn('primary', t.save, async () => {
    save.disabled = true;
    error.textContent = '';
    const keep = new Set([...w.tasks.map((x) => x.id), ...chosen]);
    const r = await send({ cmd: 'work_assign', site: item.site, entryId: item.id, taskIds: w.allTasks.map((x) => x.id).filter((id) => keep.has(id)) });
    if (mine !== opened) return void over.remove();
    if (r.ok) {
      remember();
      over.remove();
      return showWork(item, await send({ cmd: 'work_get', site: item.site, entryId: item.id }));
    }
    error.textContent = fail(r.error);
    save.disabled = false;
  });
  save.disabled = true;
  const list = el('div', 'checks scroll');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', t.add);
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
  const actions = el('div', 'actions');
  actions.append(el('span', 'spacer'), btn('', t.close, close), save);
  const box = el('div', 'obox');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', t.add);
  box.append(el('p', 'ask', t.add), list, error, actions);
  over.append(box);
  over.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.append(over);
  list.querySelector('input').focus();
}

function showWork(item, w, saved = false) {
  const box = $('work');
  if (!w.ok && w.error === 'bad_request') return void (box.hidden = true); // another site, or a host without this command
  box.hidden = false;
  const { assigned = true, allTasks = w.tasks } = w; // a host from before §7d has one list for everybody
  if (!w.ok || !allTasks.length) return box.replaceChildren(el('p', w.ok ? 'hint' : 'err', w.ok ? t.noTasks : fail(w.error)));
  if (!assigned) return showChecklist(item, { ...w, allTasks }, allTasks.filter((x) => w.statuses[x.id]).map((x) => x.id)); // marked ones come ticked
  const when = (iso) => new Date(iso).toLocaleString(document.documentElement.lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
  let busy = false;
  const refresh = () => {
    for (const f of refreshers) f();
    save.disabled = busy || w.tasks.some((x) => statuses[x.id] === 'partial' && !picked[x.id] && !existing[x.id]);
  };
  const rows = w.tasks.map((task) => {
    const row = el('div', 'wrow');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', task.name);
    const toggle = (status, cls, text, icon) => {
      const b = btn(cls, text, () => {
        if (statuses[task.id] === status) delete statuses[task.id];
        else statuses[task.id] = status;
        refresh();
      });
      b.insertAdjacentHTML('afterbegin', icon);
      b.setAttribute('aria-label', `${task.name}: ${text}`);
      refreshers.push(() => b.setAttribute('aria-pressed', statuses[task.id] === status));
      return b;
    };
    const top = el('div', 'top');
    const pair = el('div', 'seg');
    pair.append(toggle('done', 'done', t.done, CHECK), toggle('partial', 'partial', t.partial, HALF));
    top.append(el('span', 'task', task.name), pair);

    // One line, never wrapped: the box is a rectangle with its unit beside it, apart from the pill-shaped choices.
    const remind = el('div', 'remind');
    const below = el('div', 'when');
    const hint = el('p', 'hint');
    below.append(el('span', 'rlabel', t.remind));
    const number = el('input');
    const unit = el('select');
    const pick = (value, chosen) => {
      if (value) picked[task.id] = value;
      else delete picked[task.id];
      for (const [b, name] of presets) b.setAttribute('aria-pressed', name === chosen);
      refresh();
    };
    const presets = [[t.h2, t.h2s, () => inHours(2)], [t.h5, t.h5s, () => inHours(5)], [t.tomorrow, t.tomorrow, () => inDays(1)], [t.d2, t.d2s, () => inDays(2)]].map(([text, short, at]) => {
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
    number.setAttribute('aria-label', `${task.name}: ${t.custom}`);
    number.title = t.custom;
    unit.setAttribute('aria-label', `${task.name}: ${t.hours} / ${t.days}`);
    unit.append(new Option(t.hours, 'h'), new Option(t.days, 'd'));
    const typed = () => {
      const n = Number(number.value);
      pick(Number.isInteger(n) && n >= 1 && n <= (unit.value === 'h' ? MAX_HOURS : MAX_DAYS) ? (unit.value === 'h' ? inHours(n) : inDays(n)) : null);
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
      unit.options[0].text = t.hours;
      unit.options[1].text = t.days;
      const over = () => below.scrollWidth > below.clientWidth;
      if (!over()) return;
      below.classList.add('short');
      unit.options[0].text = t.hoursS;
      unit.options[1].text = t.daysS;
      if (over()) below.classList.add('bare');
    };
    const watch = new ResizeObserver(fit); // the box, and a font arriving late
    for (const e of [below, ...below.children]) watch.observe(e);
    remind.append(below, hint);

    refreshers.push(() => {
      const orange = statuses[task.id] === 'partial';
      remind.hidden = !orange;
      row.classList.toggle('warn', orange);
      const r = existing[task.id];
      hint.textContent = picked[task.id] ? `${t.willRemind} ${when(picked[task.id])}`
        : r?.dismissed ? t.reminderClosed : r ? `${t.willRemind} ${when(r.dueAt)}` : '';
    });
    row.append(top, remind);
    return row;
  });

  const error = el('p', 'err');
  error.setAttribute('role', 'alert');
  const save = btn('primary', t.save, async () => {
    busy = true;
    error.textContent = '';
    refresh();
    const reminders = {};
    for (const [id, at] of Object.entries(picked)) if (statuses[id] === 'partial') reminders[id] = at;
    const r = await send({ cmd: 'work_save', site: item.site, entryId: item.id, statuses, reminders });
    busy = false;
    if (r.ok && opened === mine) return showWork(item, await send({ cmd: 'work_get', site: item.site, entryId: item.id }), true);
    if (opened !== mine) return;
    error.textContent = fail(r.error);
    save.textContent = t.retry;
    refresh();
  });
  const mine = opened;
  const actions = el('div', 'actions');
  const addable = (w.allTasks || []).filter((x) => !w.tasks.some((y) => y.id === x.id));
  if (addable.length) {
    const add = btn('link', t.add, () => showAdd(item, w, addable, add, remember));
    actions.append(add);
  }
  if (w.allTasks) actions.append(btn('link', t.edit, () => (remember(), showChecklist(item, w, w.tasks.map((x) => x.id)))));
  actions.append(el('span', 'spacer'), save);
  box.replaceChildren(...rows, error, actions);
  if (saved) { // a mark that closes itself: no click, no focus
    const mark = el('p', 'saved');
    mark.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6.5" fill="#0F7A3C"/><path d="M4 7.2l2 2 4-4.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    mark.append(t.saved);
    mark.setAttribute('role', 'status');
    box.append(mark);
    setTimeout(() => mark.remove(), 1000);
  }
  refresh();
}

async function openEntry(item) {
  const mine = ++opened;
  carry = null;
  // the work of a tracked site's customer is asked together with the entry: one render, tasks above login and password
  const [r, w] = await Promise.all([send({ cmd: 'entry', entryId: item.id }), send({ cmd: 'work_get', site: item.site, entryId: item.id })]);
  if (mine !== opened) return;
  if (!r.ok) {
    $('empty').hidden = false;
    $('empty').textContent = t.error + r.error;
    return;
  }
  $('name').textContent = `${r.firstName} ${r.lastName}`.trim() || r.username;
  $('fields').replaceChildren(
    field(t.site, r.site),
    field(t.username, r.username, { copy: true }),
    field(t.password, r.password, { copy: true, secret: true }),
    ...[[t.extra1, r.extra1], [t.extra2, r.extra2]].filter(([, v]) => v).map(([l, v]) => field(l, v)),
    // what the sign-up form asked for, under the site's own labels
    ...(r.fields || []).map((f) => field(f.label || '—', f.value, { copy: true, secret: f.secret })),
  );
  showWork(item, w);
  $('note').textContent = '';
  $('browse').hidden = true;
  $('detail').hidden = false;
  $('back').focus();
}

function backToList() {
  $('detail').hidden = true;
  opened++; // a late reply of the closed details is dropped
  carry = null;
  $('work').replaceChildren();
  $('fields').replaceChildren(); // the password leaves the page with the details
  $('browse').hidden = false;
  $('q').focus();
}

$('q').addEventListener('input', () => search($('q').value));
$('q').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (items.length) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    mark();
  } else if (e.key === 'Enter') {
    if (items[active]) openEntry(items[active]);
  } else return;
  e.preventDefault();
});
$('back').addEventListener('click', backToList);

send({ cmd: 'status' }).then((r) => {
  if (!showStatus(r)) return;
  $('q').placeholder = t.search;
  $('q').setAttribute('aria-label', t.searchLabel);
  $('list').setAttribute('aria-label', t.list);
  $('back').textContent = t.back;
  $('browse').hidden = false;
  $('q').focus();
  search('');
  // an older host doesn't know it: then there is simply no such line
  send({ cmd: 'summary' }).then((s) => {
    if (!s.ok) return;
    $('summary').textContent = t.summary(s);
    $('summary').hidden = false;
  });
});
