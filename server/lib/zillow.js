// Zillow listing-lookup adapter.
//
// Zillow has no public API and actively blocks scraping (PerimeterX/CAPTCHA),
// so this adapter is written against a clean provider boundary with two modes:
//   • "rapidapi" — calls a third-party Zillow API (e.g. the `zillow-com1`
//     listing on RapidAPI) with your key, and maps the response to our shape.
//   • "mock" — no key needed; returns deterministic placeholder house info and
//     labeled placeholder photos so the whole flow is clickable while you wire
//     up real credentials.
//
// Drop in real data later by setting ZILLOW_RAPIDAPI_KEY in .env — no other
// part of the app changes. The request/response mapping is centralized here so
// it can be tuned to whatever the API returns without touching routes or UI.

const KEY = process.env.ZILLOW_RAPIDAPI_KEY || '';
const HOST = (process.env.ZILLOW_RAPIDAPI_HOST || 'zillow-com1.p.rapidapi.com').replace(/^https?:\/\//, '');

export const PROVIDER = (process.env.ZILLOW_PROVIDER || (KEY ? 'rapidapi' : 'mock')).toLowerCase();

export function zillowInfo() {
  return {
    provider: PROVIDER,
    host: PROVIDER === 'rapidapi' ? HOST : null,
    hasKey: Boolean(KEY),
  };
}

/**
 * Look up a property by free-form address.
 * @param {string} address
 * @returns {Promise<{address: string, beds: number, baths: number, sqft: number,
 *   yearBuilt: number|null, price: number|null, photos: {url: string, caption: string}[]}>}
 */
export async function lookupAddress(address) {
  const query = (address || '').trim();
  if (!query) throw new Error('address required');
  if (PROVIDER === 'rapidapi') return rapidApiLookup(query);
  return mockLookup(query);
}

/**
 * Materialize a photo URL into a buffer for local storage. Handles `data:`
 * URLs (Node's fetch rejects the data: scheme) and http(s) URLs alike.
 * @param {string} url
 * @returns {Promise<{buffer: Buffer, contentType: string, ext: string}>}
 */
export async function fetchPhotoBuffer(url) {
  if (typeof url === 'string' && url.startsWith('data:')) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new Error('malformed data URL');
    const contentType = m[1] || 'application/octet-stream';
    const buffer = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    return { buffer, contentType, ext: extFor(contentType) };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo download failed (${res.status})`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType, ext: extFor(contentType) };
}

function extFor(contentType) {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('svg')) return 'svg';
  return 'jpg';
}

// ── RapidAPI (zillow-com1 shaped) ─────────────────────────────────────────────
async function rapidApiLookup(address) {
  const res = await fetch(`https://${HOST}/property?address=${encodeURIComponent(address)}`, {
    headers: {
      'X-RapidAPI-Key': KEY,
      'X-RapidAPI-Host': HOST,
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Zillow lookup failed (${res.status}): ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return normalize(address, data);
}

// Map the raw provider payload to our normalized shape. Kept tolerant of the
// common field aliases so it survives minor API differences.
function normalize(address, data) {
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const photos = collectPhotos(data);
  return {
    address: data.address?.streetAddress
      ? [data.address.streetAddress, data.address.city, data.address.state, data.address.zipcode]
          .filter(Boolean).join(', ')
      : address,
    beds: num(data.bedrooms ?? data.beds) ?? 0,
    baths: num(data.bathrooms ?? data.baths) ?? 0,
    sqft: num(data.livingArea ?? data.livingAreaValue ?? data.sqft) ?? 0,
    yearBuilt: num(data.yearBuilt),
    price: num(data.price ?? data.zestimate),
    photos: photos.map((url, i) => ({ url, caption: `Listing photo ${i + 1}` })),
  };
}

function collectPhotos(data) {
  // zillow-com1 commonly returns `images` (array of URLs) or a structured
  // `responsivePhotos`/`photos` array. Accept whichever is present.
  if (Array.isArray(data.images) && data.images.length) return data.images.filter(Boolean);
  const fromResponsive = (data.responsivePhotos || data.photos || [])
    .map((p) => p?.mixedSources?.jpeg?.slice(-1)?.[0]?.url || p?.url || p)
    .filter((u) => typeof u === 'string');
  if (fromResponsive.length) return fromResponsive;
  if (data.hiResImageLink) return [data.hiResImageLink];
  return [];
}

// ── Mock ──────────────────────────────────────────────────────────────────────
// Deterministic house info + labeled placeholder photos derived from the
// address, so the flow is testable with zero credentials.
function mockLookup(address) {
  const seed = hash(address);
  const rand = mulberry32(seed);
  const beds = 3 + (seed % 3); // 3–5
  const baths = 2 + (seed % 2) + (seed % 2 === 0 ? 0.5 : 0); // 2, 2.5, or 3
  const sqft = 1600 + (seed % 2200);
  const yearBuilt = 1975 + (seed % 48);
  const price = 350000 + (seed % 650) * 1000;

  const rooms = ['Front Exterior', 'Kitchen', 'Living Room', 'Primary Bedroom', 'Primary Bath', 'Backyard'];
  const photos = rooms.map((label, i) => ({
    url: placeholderPhoto(label, address, Math.floor(rand() * 360)),
    caption: `Listing photo ${i + 1} — ${label}`,
  }));

  return { address, beds, baths, sqft, yearBuilt, price, photos };
}

function placeholderPhoto(label, address, hue) {
  const c1 = `hsl(${hue} 40% 82%)`;
  const c2 = `hsl(${(hue + 50) % 360} 38% 64%)`;
  const safe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="1024" height="768" fill="url(#g)"/>
  <rect x="40" y="40" width="944" height="688" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="2" rx="14"/>
  <text x="72" y="130" font-family="Georgia, serif" font-size="48" fill="#1b1b1b">${safe(label)}</text>
  <text x="72" y="176" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#333">Mock listing photo — set ZILLOW_RAPIDAPI_KEY for real photos</text>
  <text x="72" y="214" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#444">${safe(address)}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function hash(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
