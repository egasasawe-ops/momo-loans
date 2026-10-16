// Storage layer. In production this is Netlify Blobs (no setup needed on a
// Netlify-deployed site). Tests inject an in-memory fake via globalThis.
export async function store() {
  if (globalThis.__KM_STORE__) return globalThis.__KM_STORE__;
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: 'kibet', consistency: 'strong' });
}
