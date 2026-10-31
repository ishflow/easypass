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
    done: 'Done', partial: 'Not finished', save: 'Save', saved: 'Saved', retry: 'Try again', noTasks: 'Add tasks in EasyPass',
    h2: '2 hours', h5: '5 hours', tomorrow: 'Tomorrow', d2: 'In 2 days', custom: 'Custom reminder', hours: 'hours', days: 'days',
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
    done: 'Сделано', partial: 'Не завершено', save: 'Сохранить', saved: 'Сохранено', retry: 'Повторить', noTasks: 'Добавьте работы в EasyPass',
    h2: '2 часа', h5: '5 часов', tomorrow: 'Завтра', d2: 'Через 2 дня', custom: 'Своё напоминание', hours: 'часов', days: 'дней',
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
    done: 'Yapıldı', partial: 'Bitmedi', save: 'Kaydet', saved: 'Kaydedildi', retry: 'Yeniden dene', noTasks: "EasyPass'te iş ekleyin",
    h2: '2 saat', h5: '5 saat', tomorrow: 'Yarın', d2: '2 gün sonra', custom: 'Özel hatırlatma', hours: 'saat', days: 'gün',
    remind: 'Hatırlatma:', reminderClosed: 'hatırlatma kapatıldı',
  },
};
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, error: 'no_host' }));
let t = TEXT.ru, items = [], active = -1, query = 0, opened = 0;

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
const fail = (error) => ({ locked: t.locked, no_host: t.noHost })[error] ?? t.error + error;

function showWork(item, w, note = '') {
  const box = $('work');
  if (!w.ok && w.error === 'bad_request') return void (box.hidden = true); // another site, or a host without this command
  box.hidden = false;
  if (!w.ok || !w.tasks.length) return box.replaceChildren(el('p', w.ok ? 'hint' : 'err', w.ok ? t.noTasks : fail(w.error)));
  const when = (iso) => new Date(iso).toLocaleString(document.documentElement.lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const statuses = { ...w.statuses };
  const picked = {}; // taskId → UTC ISO; only what is chosen now goes to the host, never the reminder it already has
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
    const top = el('div', 'top');
    const pair = el('div', 'pair');
    pair.append(toggle('done', 'green', t.done), toggle('partial', 'orange', t.partial));
    top.append(el('span', 'task', task.name), pair);

    const below = el('div', 'when');
    const hint = el('p', 'hint');
    const number = el('input');
    const unit = el('select');
    const pick = (value, chosen) => {
      if (value) picked[task.id] = value;
      else delete picked[task.id];
      for (const [b, name] of presets) b.setAttribute('aria-pressed', name === chosen);
      refresh();
    };
    const presets = [[t.h2, () => inHours(2)], [t.h5, () => inHours(5)], [t.tomorrow, () => inDays(1)], [t.d2, () => inDays(2)]].map(([text, at]) => {
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
    number.setAttribute('aria-label', `${task.name}: ${t.custom}`);
    unit.setAttribute('aria-label', `${task.name}: ${t.hours} / ${t.days}`);
    unit.append(new Option(t.hours, 'h'), new Option(t.days, 'd'));
    const typed = () => {
      const n = Number(number.value);
      pick(Number.isInteger(n) && n >= 1 && n <= (unit.value === 'h' ? MAX_HOURS : MAX_DAYS) ? (unit.value === 'h' ? inHours(n) : inDays(n)) : null);
    };
    number.addEventListener('input', typed);
    unit.addEventListener('change', typed);
    below.append(number, unit);

    refreshers.push(() => {
      const orange = statuses[task.id] === 'partial';
      below.hidden = hint.hidden = !orange;
      const r = existing[task.id];
      hint.textContent = picked[task.id] ? `${t.remind} ${when(picked[task.id])}`
        : r?.dismissed ? t.reminderClosed : r ? `${t.remind} ${when(r.dueAt)}` : '';
    });
    row.append(top, below, hint);
    return row;
  });

  const error = el('p', 'err');
  error.setAttribute('role', 'alert');
  const save = btn('green', t.save, async () => {
    busy = true;
    error.textContent = '';
    refresh();
    const reminders = {};
    for (const [id, at] of Object.entries(picked)) if (statuses[id] === 'partial') reminders[id] = at;
    const r = await send({ cmd: 'work_save', site: item.site, entryId: item.id, statuses, reminders });
    busy = false;
    if (r.ok && opened === mine) return showWork(item, await send({ cmd: 'work_get', site: item.site, entryId: item.id }), t.saved);
    if (opened !== mine) return;
    error.textContent = fail(r.error);
    save.textContent = t.retry;
    refresh();
  });
  const mine = opened;
  box.replaceChildren(...rows, error, el('div', 'actions', undefined), el('p', 'ok', note));
  box.querySelector('.actions').append(save);
  refresh();
}

async function openEntry(item) {
  const mine = ++opened;
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
