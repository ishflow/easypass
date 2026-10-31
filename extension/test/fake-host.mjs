// Minimal stand-in for EasyPass.Host (spec §5): length-prefixed JSON over stdio, in-memory entries.
// Appends every request to $EP_LOG (one JSON per line) so the test can assert what reached the host.
// $EP_EXTERNAL (JSON array of entries) stands in for the WPF app writing the vault: re-read on every request.
// Monthly work is the protocol twin of HostApi.cs (plan: Host protocol). $EP_SALYK adds the salyk site's customers, without
// names (the first three have all tasks chosen, spec §7d; every other customer starts unassigned); $EP_NO_TASKS: no tasks defined; $EP_OLD_HOST: a v1.5 host; $EP_LOCK (a file): while it exists, work commands say locked.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const fold = (s) => s.toLocaleLowerCase('tr').replace(/[şçğıöü]/g, (c) => 'scgiou'['şçğıöü'.indexOf(c)]);
let n = 0;
const entry = (site, firstName, lastName, username, password, extra1 = '', extra2 = '') =>
  ({ id: 'e' + ++n, site, firstName, lastName, extra1, extra2, username, password, fields: [], updatedAt: n, taskIds: null });
const entries = [
  entry('portal-x.test', 'Ahmet', 'Yılmaz', 'ahmet.yilmaz', 'eski123', 'Kadıköy şube'),
  entry('portal-x.test', 'Ahmet', 'Kaya', 'akaya', 'kaya999'),
  entry('portal-x.test', 'Mehmet', 'Ahmetoğlu', 'mehmet.a', 'mm111'),
  entry('portal-x.test', 'Şükrü', 'Öztürk', 'sukru', 'sk222', '', 'VIP'),
  entry('portal-x.test', 'Ayşe', 'Demir', 'ayse.demir', 'ad333'),
  entry('portal-x.test', 'Gül', 'Tan', 'gul.tan', 'gt555'), // 6th on portal-x: the panel lists only 5 until you type
  // Second site: same customer/username, different password, plus one customer only here.
  entry('portal-y.test', 'Ahmet', 'Yılmaz', 'ahmet.yilmaz', 'lh-pass'),
  entry('portal-y.test', 'Lale', 'Host', 'lale', 'll444'),
];
if (process.env.EP_SALYK) {
  for (const [login, password] of [['91000000000123', 'Salyk-111'], ['92000000000456', 'Salyk-222'], ['93000000000789123', 'Salyk-333']]) {
    entries.push({ ...entry('salykkabinet.test', '', '', login, password), taskIds: process.env.EP_LONG_TASK ? ['t1', 't2'] : ['t1', 't2', 't3'] });
  }
  entries.push(entry('salykkabinet.test', '', '', '96000000000001', 'Salyk-444'));
  if (process.env.EP_LONG_TASK) for (const e of entries.filter((x) => x.site === 'salykkabinet.test')) [e.firstName, e.lastName] = ['Гульнара-Айгерим Асанбековна', 'Абдыкадырова-Жолдошбекова-Кыдырмышева'];
}
const matches = (entrySite, site) => site === entrySite || site.endsWith('.' + entrySite); // spec §3a

// Vault.Search: every word in name/username/extras (plus the site in the popup's all-sites search), first-word hits first.
function searchIn(pool, q, withSite) {
  const words = fold(q || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [...pool].sort((a, b) => b.updatedAt - a.updatedAt);
  const open = (e) => (e.fields || []).filter((f) => !f.secret).map((f) => f.value).join(' '); // sign-up details, not secrets
  const text = (e) => fold([e.firstName, e.lastName, e.username, e.extra1, e.extra2, open(e), withSite ? e.site : ''].join(' '));
  const first = (e) => (fold(e.firstName).startsWith(words[0]) || fold(e.lastName).startsWith(words[0]) ? 0 : 1);
  return pool.filter((e) => words.every((w) => text(e).includes(w)))
    .sort((a, b) => first(a) - first(b) || fold(a.firstName + ' ' + a.lastName).localeCompare(fold(b.firstName + ' ' + b.lastName)));
}

// $EP_LONG_TASK: two tasks and the salyk customers with names of 80-120 characters (the layout test); the first three customers have t1 and t2
const LONG = ['Подготовка и сдача годового отчёта по налогу на добавленную стоимость с проверкой всех входящих счетов-фактур за год',
  'Страхование ответственности сотрудников и контроль выплат по социальным отчислениям за весь квартал и прошлый год'];
const tasks = process.env.EP_NO_TASKS ? [] : process.env.EP_LONG_TASK ? [{ id: 't1', name: 'Страховка' }, { id: 't2', name: LONG[0] }, { id: 't3', name: LONG[1] }]
  : [{ id: 't1', name: 'Страховка' }, { id: 't2', name: 'НДС' }, { id: 't3', name: 'Отчёт' }];
const work = []; // { entryId, month, tasks }
const reminders = []; // { entryId, taskId, month, dueAt, dismissedAt, resolvedAt }
const WORK_CMDS = ['work_get', 'work_save', 'work_assign', 'set_name', 'summary'];
const monthOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const fullName = (e) => `${e.firstName} ${e.lastName}`.trim();
const isObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const better = (a, b) => (a === 'partial' || b === 'partial' ? 'partial' : a ?? b);
const statusOf = (record) => Object.values(record?.tasks || {}).reduce(better, null);
const chosenOf = (e) => (e.taskIds?.filter((id) => tasks.some((t) => t.id === id)) || []).length ? e.taskIds.filter((id) => tasks.some((t) => t.id === id)) : null; // Work.Chosen
const ownOf = (e) => chosenOf(e) ?? tasks.map((t) => t.id); // Work.OwnTasks
// Work.MonthStatus / GroupOf: the dot and the summary group, by the customer's own tasks
const groupOf = (e, record) => {
  const chosen = chosenOf(e), marks = record?.tasks || {};
  if (!chosen) return { partial: 'partial', done: 'done' }[statusOf(record)] ?? null;
  return chosen.every((id) => marks[id] === 'done') ? 'done' : chosen.some((id) => id in marks) ? 'partial' : null;
};
const recordOf = (entryId, month) => work.find((w) => w.entryId === entryId && w.month === month);

// Work.ParseName
function parseName(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const name = words.join(' ');
  if (words.length < 2 || name.length >= 100 || /\p{Nd}/u.test(name)) return null;
  const company = /["«»“”„]/.test(name) || ['осоо', 'оао', 'зао', 'ип'].includes(words[0].toLowerCase());
  return company ? [name, ''] : [words[0], words.slice(1).join(' ')];
}

function workSave(r, find) {
  if (!r.entryId || typeof r.month !== 'string' || !isObject(r.statuses) || !isObject(r.reminders)
    || Object.keys(r.statuses).length > 200 || Object.keys(r.reminders).length > 200) return { ok: false, error: 'bad_request' };
  const now = new Date();
  if (r.month !== monthOf(now) && r.month !== monthOf(new Date(now.getFullYear(), now.getMonth() - 1, 1))) return { ok: false, error: 'bad_request' };
  const due = {};
  for (const [task, text] of Object.entries(r.reminders)) {
    const at = typeof text === 'string' ? new Date(text) : new Date(NaN);
    if (isNaN(at) || at < now - 5 * 60_000 || at > +now + 365 * 86_400_000) return { ok: false, error: 'bad_request' };
    due[task] = at.toISOString();
  }
  if (!find(r.entryId)) return { ok: false, error: 'not_found' };
  const own = ownOf(find(r.entryId));
  if (Object.entries(r.statuses).some(([t, s]) => !own.includes(t) || !['done', 'partial'].includes(s))
    || Object.keys(due).some((t) => r.statuses[t] !== 'partial')) return { ok: false, error: 'bad_request' };
  const record = recordOf(r.entryId, r.month);
  // history of tasks off the customer's list stays (Work.Save)
  const merged = { ...Object.fromEntries(Object.entries(record?.tasks || {}).filter(([t]) => !own.includes(t))), ...r.statuses };
  if (!Object.keys(merged).length) {
    if (record) work.splice(work.indexOf(record), 1);
  } else if (record) record.tasks = merged;
  else work.push({ entryId: r.entryId, month: r.month, tasks: merged });
  const existing = reminders.filter((x) => x.entryId === r.entryId && x.month === r.month);
  for (const x of existing) if (!x.resolvedAt && r.statuses[x.taskId] !== 'partial') x.resolvedAt = now.toISOString();
  for (const [taskId, dueAt] of Object.entries(due)) {
    const x = existing.find((y) => y.taskId === taskId);
    if (x) Object.assign(x, { dueAt, dismissedAt: null, resolvedAt: null });
    else reminders.push({ entryId: r.entryId, taskId, month: r.month, dueAt, dismissedAt: null, resolvedAt: null });
  }
  return { ok: true };
}

function workAssign(r, find) {
  if (!r.site || !r.entryId || !Array.isArray(r.taskIds) || r.taskIds.length > 200 || r.taskIds.some((x) => typeof x !== 'string')) return { ok: false, error: 'bad_request' };
  const e = find(r.entryId);
  if (!e) return { ok: false, error: 'not_found' };
  const ids = r.taskIds;
  if (!ids.length || new Set(ids).size !== ids.length || !ids.every((id) => tasks.some((t) => t.id === id))) return { ok: false, error: 'bad_request' };
  e.taskIds = ids;
  for (const x of reminders) if (x.entryId === e.id && !x.resolvedAt && !ids.includes(x.taskId)) x.resolvedAt = new Date().toISOString();
  return { ok: true };
}

function handle(r) {
  if (WORK_CMDS.includes(r.cmd) && process.env.EP_OLD_HOST) return { ok: false, error: 'bad_request' };
  if (WORK_CMDS.includes(r.cmd) && process.env.EP_LOCK && existsSync(process.env.EP_LOCK)) return { ok: false, error: 'locked' };
  if (['search', 'check', 'add', 'get', 'update'].includes(r.cmd) && !r.site) return { ok: false, error: 'bad_request' };
  const all = (id) => entries.find((e) => e.id === id);
  const find = (id) => entries.find((e) => e.id === id && matches(e.site, r.site));
  const mine = () => entries.filter((e) => matches(e.site, r.site));
  const ext = process.env.EP_EXTERNAL;
  if (ext && existsSync(ext)) for (const e of JSON.parse(readFileSync(ext, 'utf8'))) if (!all(e.id)) entries.push(e);
  switch (r.cmd) {
    case 'status': return { ok: true, locked: false, count: entries.length, lang: process.env.EP_LANG || 'ru' };
    case 'search':
      return {
        ok: true,
        items: searchIn(mine(), r.q, false).slice(0, 20).map(({ password, updatedAt, site, fields, taskIds, ...e }) =>
          (process.env.EP_OLD_HOST ? e : { ...e, monthStatus: recordOf(e.id, monthOf(new Date())) ? groupOf(e, recordOf(e.id, monthOf(new Date()))) : null })),
      };
    case 'all': // the toolbar popup: every site, with the site, still without passwords
      return { ok: true, items: searchIn(entries, r.q, true).slice(0, 200).map(({ password, updatedAt, fields, taskIds, ...e }) => e) };
    case 'entry': {
      const e = all(r.entryId);
      if (!e) return { ok: false, error: 'not_found' };
      const { id, updatedAt, taskIds, ...rest } = e;
      return { ok: true, ...rest };
    }
    case 'get': {
      const e = find(r.entryId);
      return e ? { ok: true, username: e.username, password: e.password } : { ok: false, error: 'not_found' };
    }
    case 'check': {
      const byId = r.entryId && find(r.entryId);
      const same = byId ? [byId] : mine().filter((e) => e.username.toLowerCase() === (r.username || '').toLowerCase());
      if (!same.length) return { ok: true, result: 'new' };
      if (same.length > 1) return { ok: true, result: same.some((e) => e.password === r.password) ? 'same' : 'ambiguous' };
      const e = same[0];
      return { ok: true, result: e.password === r.password ? 'same' : 'changed', entryId: e.id, name: `${e.firstName} ${e.lastName}` };
    }
    case 'update': {
      const e = find(r.entryId);
      if (!e) return { ok: false, error: 'not_found' };
      e.password = r.password;
      e.updatedAt = ++n;
      return { ok: true };
    }
    case 'add': {
      const e = { ...entry(r.site, r.firstName, r.lastName, r.username, r.password), fields: r.fields || [] };
      entries.push(e);
      return { ok: true, entryId: e.id };
    }
    case 'work_get': {
      const month = r.month ?? monthOf(new Date());
      if (!r.site || !r.entryId || !isMonth(month)) return { ok: false, error: 'bad_request' };
      const e = find(r.entryId);
      if (!e) return { ok: false, error: 'not_found' };
      const own = ownOf(e), chosen = e.taskIds ? tasks.filter((t) => e.taskIds.includes(t.id)) : [];
      return {
        ok: true, username: e.username, name: fullName(e), month, assigned: chosen.length > 0, tasks: chosen, allTasks: tasks,
        statuses: Object.fromEntries(Object.entries(recordOf(e.id, month)?.tasks || {}).filter(([t]) => own.includes(t))),
        reminders: reminders.filter((x) => x.entryId === e.id && x.month === month && !x.resolvedAt)
          .map((x) => ({ taskId: x.taskId, dueAt: x.dueAt, dismissed: !!x.dismissedAt })),
      };
    }
    case 'work_save': return r.site ? workSave(r, find) : { ok: false, error: 'bad_request' };
    case 'work_assign': return workAssign(r, find);
    case 'set_name': {
      if (!r.site || !r.entryId || typeof r.text !== 'string' || r.text.length > 100) return { ok: false, error: 'bad_request' };
      const e = find(r.entryId);
      if (!e) return { ok: false, error: 'not_found' };
      const name = !e.firstName.trim() && !e.lastName.trim() && parseName(r.text);
      if (name) [e.lastName, e.firstName] = name;
      return { ok: true, firstName: e.firstName, lastName: e.lastName, changed: !!name };
    }
    case 'summary': {
      const month = monthOf(new Date());
      const listed = entries.filter((e) => chosenOf(e) || work.some((w) => w.entryId === e.id && w.month <= month));
      const count = (status) => listed.filter((e) => groupOf(e, recordOf(e.id, month)) === status).length;
      return { ok: true, month, done: count('done'), partial: count('partial'), notStarted: count(null) };
    }
    case '__dismiss': // the app closing a reminder window; tests only
      for (const x of reminders) x.dismissedAt = new Date().toISOString();
      return { ok: true };
    default: return { ok: false, error: 'bad_request' };
  }
}

let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
    const len = buf.readUInt32LE(0);
    const req = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
    buf = buf.subarray(4 + len);
    if (process.env.EP_LOG) appendFileSync(process.env.EP_LOG, JSON.stringify({ t: Date.now(), ...req }) + '\n');
    const body = Buffer.from(JSON.stringify({ id: req.id, ...handle(req) }), 'utf8');
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length);
    process.stdout.write(Buffer.concat([head, body]));
  }
});
process.stdin.on('end', () => process.exit(0));
