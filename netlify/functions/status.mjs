import { store } from '../lib/store.mjs';
import { json, readJson, notPost, rateLimit, tooMany, clientIp, CFG } from '../lib/core.mjs';

export const config = { path: '/api/status' };

export default async (req, context) => {
  const bad = notPost(req); if (bad) return bad;
  if (!(await rateLimit('status', CFG.limitStatus, clientIp(req, context)))) return tooMany();

  const inp = await readJson(req);
  const ref = String(inp.reference ?? '').trim().toUpperCase();
  const phone = String(inp.phone ?? '').replace(/[\s\-()]/g, '');

  // Reference AND phone must both match, so references can't be guessed.
  const a = /^KM-[0-9A-F]{8}$/.test(ref) ? await (await store()).get(`app:${ref}`, { type: 'json' }) : null;
  if (!a || a.phone !== phone)
    return json({ ok: false, error: 'No application found for that reference and phone number.' }, 404);

  const { reference, status, amount, months, monthly_payment, total_repayable, decision_note, created_at, updated_at } = a;
  return json({ ok: true, application: { reference, status, amount, months, monthly_payment, total_repayable, decision_note, created_at, updated_at } });
};
