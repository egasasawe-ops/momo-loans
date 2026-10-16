import crypto from 'node:crypto';
import { store } from '../lib/store.mjs';
import { json, readJson, notPost, rateLimit, tooMany, clientIp, cleanInput, evaluate, CFG } from '../lib/core.mjs';

export const config = { path: '/api/apply' };

export default async (req, context) => {
  const bad = notPost(req); if (bad) return bad;
  const inp = await readJson(req);

  // Honeypot: real users never fill this hidden field.
  if (inp.website) return json({ ok: true, reference: 'KM-00000000' });

  const ip = clientIp(req, context);
  if (!(await rateLimit('apply', CFG.limitApply, ip))) return tooMany();

  if (inp.consent !== true)
    return json({ ok: false, errors: ['You must agree to the terms and data use to apply.'] }, 422);

  const [v, errors] = cleanInput(inp);
  if (errors.length) return json({ ok: false, errors }, 422);

  // Always re-check on the server; never trust the browser's result.
  const r = evaluate(v);
  if (!r.eligible) return json({ ok: false, errors: r.reasons }, 422);

  const s = await store();

  // One open application per phone number.
  const prevRef = (await s.get(`phone:${v.phone}`, { type: 'json' }))?.ref;
  if (prevRef) {
    const prev = await s.get(`app:${prevRef}`, { type: 'json' });
    if (prev && prev.status === 'pending')
      return json({ ok: false, errors: ['You already have an application under review. Use "Track Application" to see its status.'] }, 409);
  }

  const reference = 'KM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const ts = new Date().toISOString();
  await s.setJSON(`app:${reference}`, {
    reference, ...v,
    interest_rate: CFG.interestRate,
    monthly_payment: r.monthly, total_repayable: r.total,
    status: 'pending', decision_note: '', ip,
    created_at: ts, updated_at: ts,
  });
  await s.setJSON(`phone:${v.phone}`, { ref: reference });

  return json({ ok: true, reference, monthly: r.monthly, total: r.total }, 201);
};
