// Shared helpers for the form pages
async function postJSON(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  let body = {};
  try { body = await res.json(); } catch (e) { body = { ok: false, error: 'Unexpected server response.' }; }
  return body;
}
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function showBox(el, kind, html) { el.className = 'box show ' + kind; el.innerHTML = html; }
const money = n => '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Mobile menu (same behaviour as the homepage)
const mt = document.getElementById('menuToggle'), nl = document.getElementById('navLinks');
if (mt && nl) mt.addEventListener('click', () => nl.classList.toggle('active'));
