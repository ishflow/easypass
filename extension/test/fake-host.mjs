// Minimal stand-in for EasyPass.Host (spec §5): length-prefixed JSON over stdio, in-memory entries.
// Appends every request to $EP_LOG (one JSON per line) so the test can assert what reached the host.
// $EP_EXTERNAL (JSON array of entries) stands in for the WPF app writing the vault: re-read on every request.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const fold = (s) => s.toLocaleLowerCase('tr').replace(/[şçğıöü]/g, (c) => 'scgiou'['şçğıöü'.indexOf(c)]);
let n = 0;
const entry = (site, firstName, lastName, username, password, extra1 = '', extra2 = '') =>
  ({ id: 'e' + ++n, site, firstName, lastName, extra1, extra2, username, password, updatedAt: n });
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
const matches = (entrySite, site) => site === entrySite || site.endsWith('.' + entrySite); // spec §3a

function handle(r) {
  if (['search', 'check', 'add', 'get', 'update'].includes(r.cmd) && !r.site) return { ok: false, error: 'bad_request' };
  const all = (id) => entries.find((e) => e.id === id);
  const find = (id) => entries.find((e) => e.id === id && matches(e.site, r.site));
  const mine = () => entries.filter((e) => matches(e.site, r.site));
  const ext = process.env.EP_EXTERNAL;
  if (ext && existsSync(ext)) for (const e of JSON.parse(readFileSync(ext, 'utf8'))) if (!all(e.id)) entries.push(e);
  switch (r.cmd) {
    case 'status': return { ok: true, locked: false, count: entries.length, lang: process.env.EP_LANG || 'ru' };
    case 'search': {
      const words = fold(r.q || '').split(/\s+/).filter(Boolean);
      const hits = words.length
        ? mine().filter((e) => words.every((w) => fold([e.firstName, e.lastName, e.username, e.extra1, e.extra2].join(' ')).includes(w)))
          .sort((a, b) => {
            const first = (e) => (fold(e.firstName).startsWith(words[0]) || fold(e.lastName).startsWith(words[0]) ? 0 : 1);
            return first(a) - first(b) || fold(a.firstName + ' ' + a.lastName).localeCompare(fold(b.firstName + ' ' + b.lastName));
          })
        : mine().sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, items: hits.slice(0, 20).map(({ password, updatedAt, site, ...e }) => e) };
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
      const e = entry(r.site, r.firstName, r.lastName, r.username, r.password);
      entries.push(e);
      return { ok: true, entryId: e.id };
    }
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
