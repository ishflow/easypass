// Language comes from the EasyPass app settings (host status), default Russian.
const TEXT = {
  ru: {
    ok: (n) => `Подключено · ${n} ${{ one: 'клиент', few: 'клиента' }[new Intl.PluralRules('ru').select(n)] || 'клиентов'}`,
    locked: 'Хранилище заблокировано — откройте EasyPass и введите мастер-пароль',
    noHost: 'Нет связи — запустите install.ps1',
  },
  tr: {
    ok: (n) => `Bağlı · ${n} müşteri`,
    locked: "Kilitli — EasyPass'i açıp ana şifreyi girin",
    noHost: 'Bağlantı yok — kurulum betiğini çalıştırın',
  },
};
const el = document.getElementById('status');
chrome.runtime.sendMessage({ cmd: 'status' }).catch(() => null).then((r) => {
  const t = TEXT[r?.lang] || TEXT.ru;
  document.documentElement.lang = TEXT[r?.lang] ? r.lang : 'ru';
  if (r?.ok && !r.locked) {
    el.textContent = t.ok(r.count);
    el.className = 'ok';
  } else {
    el.textContent = r?.locked || r?.error === 'locked' ? t.locked : t.noHost;
  }
});
