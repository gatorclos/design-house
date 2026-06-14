// Property-data adapter — RentCast (https://api.rentcast.io).
//
// Returns real public-record house facts (beds/baths/sqft/year) for an address.
// Free tier: ~50 requests/month. No silent mock: if no key is configured,
// callers get a clear error.
//
// Accepts the RentCast-named env vars first, falling back to the generic ones,
// so it works whether the key is set as RENTCAST_API_KEY or PROPERTY_API_KEY.

const KEY = process.env.RENTCAST_API_KEY || process.env.PROPERTY_API_KEY || '';
const HOST = (process.env.RENTCAST_API_HOST || process.env.PROPERTY_API_HOST || 'api.rentcast.io')
  .replace(/^https?:\/\//, '').replace(/\/$/, '');

export function propertyInfo() {
  return { provider: KEY ? 'rentcast' : 'none', host: HOST, hasKey: Boolean(KEY) };
}

/**
 * Look up public-record facts for an address.
 * @param {string} address
 * @returns {Promise<{address: string, beds: number, baths: number, sqft: number,
 *   yearBuilt: number|null, propertyType: string|null}>}
 */
export async function lookupAddress(address) {
  const query = (address || '').trim();
  if (!query) {
    const e = new Error('address required');
    e.status = 400;
    throw e;
  }
  if (!KEY) {
    const e = new Error('House lookup is not configured. Set PROPERTY_API_KEY (RentCast) in the environment.');
    e.status = 503;
    throw e;
  }

  const url = `https://${HOST}/v1/properties?address=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'X-Api-Key': KEY, Accept: 'application/json' } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const e = new Error(`Property lookup failed (${res.status}): ${txt.slice(0, 200)}`);
    e.status = res.status === 404 ? 404 : 502;
    throw e;
  }
  const data = await res.json();
  const record = Array.isArray(data) ? data[0] : (data?.properties?.[0] || data);
  if (!record) {
    const e = new Error('No property record found for that address.');
    e.status = 404;
    throw e;
  }
  return normalize(query, record);
}

// Map RentCast's record (tolerant of field aliases) to our normalized shape.
function normalize(fallbackAddress, r) {
  const num = (v) => (v == null || v === '' ? null : Number(v));
  return {
    address: r.formattedAddress || r.addressLine1 || fallbackAddress,
    beds: num(r.bedrooms ?? r.beds) ?? 0,
    baths: num(r.bathrooms ?? r.baths) ?? 0,
    sqft: num(r.squareFootage ?? r.squareFeet ?? r.sqft) ?? 0,
    yearBuilt: num(r.yearBuilt),
    propertyType: r.propertyType || r.propertyUse || null,
  };
}
