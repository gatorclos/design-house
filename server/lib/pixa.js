// Image provider adapter.
//
// Two providers:
//   • "pixa" — calls the Pixa REST API with your key (generate -> poll -> fetch).
//   • "mock" — no key needed; returns a labeled placeholder so every button in
//     the UI is fully clickable while you wire up real credentials.
//
// The Pixa request/response mapping is centralized below and driven by .env so
// you can match it to exactly what your Pixa dashboard's API tab shows without
// touching the rest of the app.

const KEY = process.env.PIXA_API_KEY || '';
const BASE = (process.env.PIXA_API_BASE || 'https://api.pixa.com').replace(/\/$/, '');
const MODEL = process.env.PIXA_MODEL || 'seedream-v5-lite';
const RESOLUTION = process.env.PIXA_RESOLUTION || '2K';
const ASPECT = process.env.PIXA_ASPECT_RATIO || '4:3';

export const PROVIDER = (process.env.PROVIDER || (KEY ? 'pixa' : 'mock')).toLowerCase();

export function providerInfo() {
  return {
    provider: PROVIDER,
    model: PROVIDER === 'pixa' ? MODEL : 'mock',
    base: PROVIDER === 'pixa' ? BASE : null,
    hasKey: Boolean(KEY),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate or edit an image.
 * @param {{prompt: string, baseImage?: {buffer: Buffer, contentType: string}}} opts
 * @returns {Promise<{buffer: Buffer, ext: string, contentType: string}>}
 */
export async function generateImage(opts) {
  if (PROVIDER === 'pixa') return pixaGenerate(opts);
  return mockGenerate(opts);
}

// ── Pixa ─────────────────────────────────────────────────────────────────────
async function pixaGenerate({ prompt, baseImage }) {
  const body = {
    model: MODEL,
    prompt,
    resolution: RESOLUTION,
    aspect_ratio: ASPECT,
    image_count: 1,
  };
  if (baseImage) {
    // Send the source/edit image inline as a data URL. Pixa editing models
    // accept one or more reference images.
    const dataUrl = `data:${baseImage.contentType};base64,${baseImage.buffer.toString('base64')}`;
    body.images = [dataUrl];
  }

  const res = await fetch(`${BASE}/v1/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Pixa generate failed (${res.status}): ${txt.slice(0, 300)}`);
  }
  const data = await res.json();

  // Accept several common response shapes.
  // 1) Immediate inline image.
  const inline = data?.data?.[0]?.b64_json || data?.images?.[0]?.b64_json;
  if (inline) return fromBase64(inline);

  // 2) Immediate URL.
  const directUrl = data?.data?.[0]?.url || data?.images?.[0]?.url || data?.url;
  if (directUrl) return fromUrl(directUrl);

  // 3) Async job -> poll asset until ready, then download.
  const assetId =
    data?.asset_ids?.[0] || data?.assets?.[0]?.id || data?.id || data?.job_id;
  if (!assetId) throw new Error('Pixa: could not locate asset id in response');
  return pollAsset(assetId);
}

async function pollAsset(assetId, { tries = 60, intervalMs = 2000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${BASE}/v1/assets/${assetId}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    if (res.ok) {
      const a = await res.json();
      const status = (a.status || a.state || '').toLowerCase();
      const url = a.url || a.download_url || a.output?.url;
      if ((status === 'ready' || status === 'succeeded' || status === 'completed') && url) {
        return fromUrl(url);
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(`Pixa asset ${assetId} failed: ${a.error || 'unknown error'}`);
      }
    }
    await sleep(intervalMs);
  }
  throw new Error(`Pixa asset ${assetId} timed out`);
}

async function fromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixa download failed (${res.status})`);
  const contentType = res.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType, ext: extFor(contentType) };
}

function fromBase64(b64) {
  const buffer = Buffer.from(b64, 'base64');
  return { buffer, contentType: 'image/png', ext: 'png' };
}

function extFor(contentType) {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('svg')) return 'svg';
  return 'png';
}

// ── Mock ─────────────────────────────────────────────────────────────────────
// Builds a labeled SVG "redesign" so the flow is testable with zero credentials.
function mockGenerate({ prompt, baseImage }) {
  let h = 0;
  for (const c of prompt || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const c1 = `hsl(${hue} 45% 88%)`;
  const c2 = `hsl(${(hue + 40) % 360} 40% 72%)`;
  const wrapped = String(prompt || 'redesign')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .slice(0, 220);

  const bg = baseImage
    ? `<image href="data:${baseImage.contentType};base64,${baseImage.buffer.toString(
        'base64'
      )}" x="0" y="0" width="1024" height="768" preserveAspectRatio="xMidYMid slice" opacity="0.30"/>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="1024" height="768" fill="url(#g)"/>
  ${bg}
  <rect x="40" y="40" width="944" height="688" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2" rx="14"/>
  <text x="72" y="120" font-family="Georgia, serif" font-size="42" fill="#1b1b1b">Mock Redesign</text>
  <text x="72" y="160" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#333">No Pixa key set — placeholder preview</text>
  <foreignObject x="72" y="200" width="880" height="460">
    <body xmlns="http://www.w3.org/1999/xhtml" style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:22px;color:#222;line-height:1.45">
      ${wrapped}
    </body>
  </foreignObject>
</svg>`;
  return { buffer: Buffer.from(svg), contentType: 'image/svg+xml', ext: 'svg' };
}
