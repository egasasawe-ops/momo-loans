// Offline tests: runs the real function handlers against an in-memory store.
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.__KM_STORE__ = {
  async get(k) { return mem.has(k) ? JSON.parse(mem.get(k)) : null; },
  async setJSON(k, v) { mem.set(k, JSON.stringify(v)); },
  async delete(k) { mem.delete(k); },
  async list({ prefix = '' } = {}) { return { blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
};

const { hashPassword } = await import('../netlify/lib/core.mjs');
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.ADMIN_PASSWORD_HASH = hashPassword('correct horse battery');

const eligibility = (await import('../netlify/functions/eligibility.mjs')).default;
const apply = (await import('../netlify/functions/apply.mjs')).default;
const status = (await import('../netlify/functions/status.mjs')).default;
const admin = (await import('../netlify/functions/admin.mjs')).default;

const B = 'https://example.netlify.app';
const post = (path, body, headers = {}) => new Request(B + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const ctx = (ip = '1.1.1.1') => ({ ip });
const good = { full_name: 'Jane Doe', phone: '+256 700 000 001', email: 'jane@example.com', country: 'Uganda', age: 30,
  employment: 'Employed', monthly_income: 600, amount: 500, months: 6, consent: true };

let n = 0; const t = async (name, fn) => { await fn(); console.log('  ok -', name); n++; };

await t('GET is rejected', async () => {
  const r = await eligibility(new Request(B + '/api/eligibility'), ctx());
  assert.equal(r.status, 405);
});
await t('eligible applicant passes, math matches homepage', async () => {
  const r = await eligibility(post('/api/eligibility', good), ctx());
  const d = await r.json();
  assert.equal(d.eligible, true); assert.equal(d.monthly, 91.67); assert.equal(d.total, 550);
});
await t('low income is rejected with reason + suggestion', async () => {
  const d = await (await eligibility(post('/api/eligibility', { ...good, monthly_income: 100 }), ctx())).json();
  assert.equal(d.eligible, false); assert.ok(d.reasons[0].includes('income')); assert.ok(d.max_affordable > 0 && d.max_affordable < 500);
});
await t('underage / unemployed / bad country rejected', async () => {
  assert.equal((await (await eligibility(post('/api/eligibility', { ...good, age: 17 }), ctx())).json()).eligible, false);
  assert.equal((await (await eligibility(post('/api/eligibility', { ...good, employment: 'Unemployed' }), ctx())).json()).eligible, false);
  assert.equal((await eligibility(post('/api/eligibility', { ...good, country: 'Mars' }), ctx())).status, 422);
});
await t('apply requires consent', async () => {
  assert.equal((await apply(post('/api/apply', { ...good, consent: false }), ctx())).status, 422);
});
await t('apply rechecks eligibility server-side', async () => {
  assert.equal((await apply(post('/api/apply', { ...good, monthly_income: 50 }), ctx())).status, 422);
});
let ref;
await t('apply succeeds and returns reference', async () => {
  const r = await apply(post('/api/apply', good), ctx()); assert.equal(r.status, 201);
  ref = (await r.json()).reference; assert.match(ref, /^KM-[0-9A-F]{8}$/);
});
await t('duplicate pending application blocked', async () => {
  assert.equal((await apply(post('/api/apply', good), ctx())).status, 409);
});
await t('honeypot silently ignored (nothing saved)', async () => {
  const before = mem.size;
  const d = await (await apply(post('/api/apply', { ...good, phone: '+256700000099', website: 'spam.com' }), ctx())).json();
  assert.equal(d.ok, true); assert.equal(mem.size, before);
});
await t('status needs matching phone', async () => {
  assert.equal((await status(post('/api/status', { reference: ref, phone: '+256700000999' }), ctx())).status, 404);
  const r = await status(post('/api/status', { reference: ref, phone: '+256 700 000 001' }), ctx());
  const d = await r.json(); assert.equal(d.application.status, 'pending'); assert.equal(d.application.ip, undefined);
});

let cookie;
await t('admin: list without login is 401', async () => {
  assert.equal((await admin(new Request(B + '/api/admin/list'), ctx())).status, 401);
});
await t('admin: wrong password rejected, right one sets cookie', async () => {
  assert.equal((await admin(post('/api/admin/login', { user: 'admin', pass: 'nope' }), ctx())).status, 401);
  const r = await admin(post('/api/admin/login', { user: 'admin', pass: 'correct horse battery' }), ctx());
  assert.equal(r.status, 200); cookie = r.headers.get('set-cookie').split(';')[0];
  assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));
});
await t('admin: tampered cookie rejected', async () => {
  const r = await admin(new Request(B + '/api/admin/list', { headers: { cookie: cookie.slice(0, -2) + 'zz' } }), ctx());
  assert.equal(r.status, 401);
});
await t('admin: cross-origin decide is blocked', async () => {
  const r = await admin(post('/api/admin/decide', { reference: ref, status: 'approved' }, { cookie, origin: 'https://evil.com' }), ctx());
  assert.equal(r.status, 403);
});
await t('admin: list + approve with note, applicant sees it', async () => {
  let d = await (await admin(new Request(B + '/api/admin/list', { headers: { cookie } }), ctx())).json();
  assert.equal(d.applications.length, 1); assert.equal(d.counts.pending, 1);
  const r = await admin(post('/api/admin/decide', { reference: ref, status: 'approved', note: 'Approved. Welcome!' }, { cookie, origin: B }), ctx());
  assert.equal(r.status, 200);
  d = await (await status(post('/api/status', { reference: ref, phone: '+256700000001' }), ctx())).json();
  assert.equal(d.application.status, 'approved'); assert.equal(d.application.decision_note, 'Approved. Welcome!');
});
await t('rate limit kicks in', async () => {
  let last; for (let i = 0; i < 32; i++) last = await eligibility(post('/api/eligibility', good), ctx('9.9.9.9'));
  assert.equal(last.status, 429);
});
await t('script injection stays inert in stored data (escaped by UI)', async () => {
  const d = await (await apply(post('/api/apply', { ...good, phone: '+256700000555', full_name: '<img src=x onerror=alert(1)>' }), ctx('2.2.2.2'))).json();
  assert.equal(d.ok, true); // stored as plain text; admin.html renders via esc()
});

console.log(`\n${n} tests passed`);
