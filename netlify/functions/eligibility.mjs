import { json, readJson, notPost, rateLimit, tooMany, clientIp, cleanInput, evaluate, CFG } from '../lib/core.mjs';

export const config = { path: '/api/eligibility' };

export default async (req, context) => {
  const bad = notPost(req); if (bad) return bad;
  if (!(await rateLimit('check', CFG.limitChecks, clientIp(req, context)))) return tooMany();

  const [v, errors] = cleanInput(await readJson(req));
  if (errors.length) return json({ ok: false, errors }, 422);
  return json({ ok: true, ...evaluate(v) });
};
