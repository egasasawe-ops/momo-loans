import { store } from '../lib/store.mjs';
import {
  json, readJson, adminConfigured, verifyPassword, makeSessionCookie, clearSessionCookie,
  isAdmin, sameOriginJson, rateLimit, tooMany, clientIp,
} from '../lib/core.mjs';

export const config = { path: '/api/admin/*' };

const STATUSES = ['pending', 'approved', 'rejected'];

export default async (req, context) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/admin\/?/, '').replace(/\/$/, '');

  // ---- Login ----
  if (route === 'login' && req.method === 'POST') {
    if (!sameOriginJson(req)) return json({ ok: false, error: 'Bad request.' }, 403);
    if (!adminConfigured()) return json({ ok: false, error: 'Admin is not configured. Set ADMIN_PASSWORD_HASH and SESSION_SECRET.' }, 503);
    if (!(await rateLimit('login', [10, 900], clientIp(req, context)))) return tooMany();

    const { user, pass } = await readJson(req);
    const userOk = String(user ?? '') === (process.env.ADMIN_USER || 'admin');
    const passOk = verifyPassword(String(pass ?? ''), process.env.ADMIN_PASSWORD_HASH);
    if (!(userOk && passOk)) return json({ ok: false, error: 'Wrong username or password.' }, 401);
    return json({ ok: true }, 200, { 'set-cookie': makeSessionCookie(req) });
  }

  if (route === 'logout' && req.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  }

  // Everything below needs a valid session.
  if (!isAdmin(req)) return json({ ok: false, error: 'Not signed in.' }, 401);

  // ---- List ----
  if (route === 'list' && req.method === 'GET') {
    const filter = new URL(req.url).searchParams.get('filter') || '';
    const s = await store();
    const { blobs } = await s.list({ prefix: 'app:' });
    const apps = (await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' })))).filter(Boolean);
    const counts = { pending: 0, approved: 0, rejected: 0 };
    apps.forEach((a) => { if (a.status in counts) counts[a.status]++; });
    const rows = apps
      .filter((a) => !STATUSES.includes(filter) || a.status === filter)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 200);
    return json({ ok: true, counts, applications: rows });
  }

  // ---- Decide ----
  if (route === 'decide' && req.method === 'POST') {
    if (!sameOriginJson(req)) return json({ ok: false, error: 'Bad request.' }, 403);
    const { reference, status, note } = await readJson(req);
    if (!STATUSES.includes(status) || !/^KM-[0-9A-F]{8}$/.test(String(reference))) return json({ ok: false, error: 'Invalid data.' }, 422);
    const s = await store();
    const a = await s.get(`app:${reference}`, { type: 'json' });
    if (!a) return json({ ok: false, error: 'Application not found.' }, 404);
    a.status = status;
    a.decision_note = String(note ?? '').trim().slice(0, 255);
    a.updated_at = new Date().toISOString();
    await s.setJSON(`app:${reference}`, a);
    return json({ ok: true, application: a });
  }

  return json({ ok: false, error: 'Not found.' }, 404);
};
