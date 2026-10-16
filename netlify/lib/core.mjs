import crypto from 'node:crypto';
import { store } from './store.mjs';

// ---------------------------------------------------------------
// Lending rules (same formula as the homepage calculator)
// ---------------------------------------------------------------
export const CFG = {
  interestRate: 10,                 // flat %, total = amount * (1 + rate/100)
  minAmount: 50, maxAmount: 5000,   // USD
  allowedMonths: [1, 3, 6, 12],
  maxRepaymentRatio: 0.40,          // monthly repayment <= 40% of income
  minAge: 18, maxAge: 70,
  employment: ['Employed', 'Self-employed', 'Business owner', 'Student', 'Unemployed'],
  ineligibleEmployment: ['Unemployed'],
  countries: ['Ghana', 'Uganda', 'Zambia', 'Cameroon', "Côte d'Ivoire", 'Guinea', 'Benin', 'South Sudan'],
  limitChecks: [30, 3600],          // 30 eligibility checks / hour / IP
  limitApply: [5, 3600],            // 5 applications / hour / IP
  limitStatus: [20, 3600],
};

// ---------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });

export async function readJson(req) {
  try {
    const d = await req.json();
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }
}

export const clientIp = (req, ctx) =>
  ctx?.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';

export const notPost = (req) =>
  req.method !== 'POST' ? json({ ok: false, error: 'Method not allowed.' }, 405, { allow: 'POST' }) : null;

export async function rateLimit(action, [max, windowSec], ip) {
  const s = await store();
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${action}:${ip}:${bucket}`;
  const cur = (await s.get(key, { type: 'json' }))?.n ?? 0;
  if (cur >= max) return false;
  await s.setJSON(key, { n: cur + 1 });
  return true;
}
export const tooMany = () => json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);

// ---------------------------------------------------------------
// Validation + eligibility
// ---------------------------------------------------------------
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function calcLoan(amount, months, rate) {
  const total = amount * (1 + rate / 100);
  return { total: round2(total), monthly: round2(total / Math.max(1, months)) };
}

export function cleanInput(inp) {
  const e = [];
  const v = {};
  v.full_name = str(inp.full_name).trim();
  if (v.full_name.length < 2 || v.full_name.length > 100) e.push('Enter your full name.');

  v.phone = str(inp.phone).replace(/[\s\-()]/g, '');
  if (!/^\+?[0-9]{8,15}$/.test(v.phone)) e.push('Enter a valid phone number (8-15 digits).');

  v.email = str(inp.email).trim();
  if (v.email && (v.email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))) e.push('Email address is not valid.');

  v.country = str(inp.country);
  if (!CFG.countries.includes(v.country)) e.push('Select a supported country.');

  v.age = Math.trunc(Number(inp.age)) || 0;
  v.employment = str(inp.employment);
  if (!CFG.employment.includes(v.employment)) e.push('Select your employment status.');

  v.monthly_income = round2(Number(inp.monthly_income) || 0);
  v.amount = round2(Number(inp.amount) || 0);
  v.months = Math.trunc(Number(inp.months)) || 0;
  return [v, e];
}

export function evaluate(v) {
  const reasons = [];
  if (v.age < CFG.minAge || v.age > CFG.maxAge)
    reasons.push(`Applicants must be between ${CFG.minAge} and ${CFG.maxAge} years old.`);
  if (v.amount < CFG.minAmount || v.amount > CFG.maxAmount)
    reasons.push(`Loan amount must be between $${CFG.minAmount} and $${CFG.maxAmount}.`);
  const monthsOk = CFG.allowedMonths.includes(v.months);
  if (!monthsOk) reasons.push('Choose a valid repayment period.');
  if (CFG.ineligibleEmployment.includes(v.employment))
    reasons.push('We need a regular source of income to assess an application.');

  const months = monthsOk ? v.months : 1;
  const calc = calcLoan(v.amount, months, CFG.interestRate);
  const cap = v.monthly_income * CFG.maxRepaymentRatio;

  if (v.monthly_income <= 0) reasons.push('Enter your monthly income.');
  else if (calc.monthly > cap)
    reasons.push(`The monthly repayment ($${calc.monthly.toFixed(2)}) is more than ${Math.round(CFG.maxRepaymentRatio * 100)}% of your income. Try a smaller amount or a longer period.`);

  let maxAffordable = Math.floor((cap * months) / (1 + CFG.interestRate / 100));
  maxAffordable = Math.max(0, Math.min(maxAffordable, CFG.maxAmount));

  return { eligible: reasons.length === 0, reasons, monthly: calc.monthly, total: calc.total, max_affordable: maxAffordable };
}

// ---------------------------------------------------------------
// Admin auth: scrypt password + signed, expiring session cookie
// ---------------------------------------------------------------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const secret = () => process.env.SESSION_SECRET || '';
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export const adminConfigured = () => secret().length >= 16 && !!process.env.ADMIN_PASSWORD_HASH;

export function makeSessionCookie(req) {
  const payload = b64u(JSON.stringify({ exp: Date.now() + 8 * 3600 * 1000 }));
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `km_session=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`;
}
export const clearSessionCookie = () => 'km_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';

export function isAdmin(req) {
  if (secret().length < 16) return false;
  const m = /(?:^|;\s*)km_session=([^;]+)/.exec(req.headers.get('cookie') || '');
  if (!m) return false;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig || !safeEq(sig, sign(payload))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); }
  catch { return false; }
}

/** CSRF defence for admin writes: JSON content-type + same-origin. */
export function sameOriginJson(req) {
  if (!(req.headers.get('content-type') || '').includes('application/json')) return false;
  const origin = req.headers.get('origin');
  return !origin || new URL(origin).host === new URL(req.url).host;
}
