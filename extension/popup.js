// Toolbar popup: connection status, then a search over every site's entries; a click opens one entry's details.
// Language comes from the EasyPass app settings (host status), default Russian.
const TEXT = {
  ru: {
    ok: (n) => `Подключено · ${n} ${{ one: 'клиент', few: 'клиента' }[new Intl.PluralRules('ru').select(n)] || 'клиентов'}`,
    locked: 'Хранилище заблокировано — откройте EasyPass и введите мастер-пароль',
    noHost: 'Нет связи — запустите install.ps1',
    search: 'Найти клиента или сайт…', searchLabel: 'Поиск клиента', list: 'Клиенты', none: 'Ничего не найдено',
    back: '← Назад', site: 'Сайт', username: 'Логин', password: 'Пароль', extra1: 'Доп. информация 1', extra2: 'Доп. информация 2',
    show: 'Показать', hide: 'Скрыть', copy: 'Копировать', copied: 'Скопировано', error: 'Ошибка: ',
  },
  tr: {
    ok: (n) => `Bağlı · ${n} müşteri`,
    locked: "Kilitli — EasyPass'i açıp ana şifreyi girin",
    noHost: 'Bağlantı yok — kurulum betiğini çalıştırın',
    search: 'Müşteri ya da site ara…', searchLabel: 'Müşteri ara', list: 'Müşteriler', none: 'Sonuç yok',
    back: '← Geri', site: 'Site', username: 'Kullanıcı adı', password: 'Şifre', extra1: 'Ek bilgi 1', extra2: 'Ek bilgi 2',
    show: 'Göster', hide: 'Gizle', copy: 'Kopyala', copied: 'Kopyalandı', error: 'Hata: ',
  },
};
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, error: 'no_host' }));
let t = TEXT.ru, items = [], active = -1, query = 0;

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

async function openEntry(item) {
  const r = await send({ cmd: 'entry', entryId: item.id });
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
  $('note').textContent = '';
  $('browse').hidden = true;
  $('detail').hidden = false;
  $('back').focus();
}

function backToList() {
  $('detail').hidden = true;
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
});
