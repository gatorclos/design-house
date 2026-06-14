// Pixa image-generation adapter (real only — no mock).
//
// Generation runs server-side so the API key stays secret. To stay within
// serverless function time limits we split it: startGeneration() kicks off the
// job and returns immediately (either the finished image, or an asset id); the
// client then polls getAsset() until it's ready. Finished images are returned as
// data URLs so the browser can display and download them within the session
// without depending on Pixa's temporary URLs.
//
// The request/response mapping is centralized and env-driven so it can be tuned
// to your Pixa account's API without touching routes or the client.

const KEY = process.env.PIXA_API_KEY || '';
const BASE = (process.env.PIXA_API_BASE || 'https://api.pixa.com').replace(/\/$/, '');
const MODEL = process.env.PIXA_MODEL || 'nano-banana';
const RESOLUTION = process.env.PIXA_RESOLUTION || '2K';
const ASPECT = process.env.PIXA_ASPECT_RATIO || '4:3';

export function providerInfo() {
  return { provider: KEY ? 'pixa' : 'none', model: MODEL, base: BASE, hasKey: Boolean(KEY) };
}

function requireKey() {
  if (!KEY) {
    const e = new Error('Image generation is not configured. Set PIXA_API_KEY in the environment.');
    e.status = 503;
    throw e;
  }
}

/**
 * Kick off a generation.
 * @param {{prompt: string, image?: string}} opts  image is a data URL (the local source photo)
 * @returns {Promise<{status:'ready', dataUrl:string} | {status:'pending', assetId:string}>}
 */
export async function startGeneration({ prompt, image }) {
  requireKey();
  const body = {
    model: MODEL,
    prompt,
    resolution: RESOLUTION,
    aspect_ratio: ASPECT,
    image_count: 1,
  };
  if (image) body.images = [image]; // image-to-image reference (transient; never stored)

  const res = await fetch(`${BASE}/v1/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const e = new Error(`Pixa generate failed (${res.status}): ${txt.slice(0, 300)}`);
    e.status = 502;
    throw e;
  }
  const data = await res.json();

  // 1) Immediate inline image.
  const inline = data?.data?.[0]?.b64_json || data?.images?.[0]?.b64_json;
  if (inline) return { status: 'ready', dataUrl: `data:image/png;base64,${inline}` };

  // 2) Immediate URL.
  const directUrl = data?.data?.[0]?.url || data?.images?.[0]?.url || data?.url;
  if (directUrl) return { status: 'ready', dataUrl: await toDataUrl(directUrl) };

  // 3) Async job -> client will poll getAsset().
  const assetId = data?.asset_ids?.[0] || data?.assets?.[0]?.id || data?.id || data?.job_id;
  if (!assetId) {
    const e = new Error('Pixa: could not locate an image or asset id in the response');
    e.status = 502;
    throw e;
  }
  return { status: 'pending', assetId: String(assetId) };
}

/**
 * Poll a single asset once.
 * @returns {Promise<{status:'ready', dataUrl:string} | {status:'pending'} | {status:'failed', error:string}>}
 */
export async function getAsset(assetId) {
  requireKey();
  const res = await fetch(`${BASE}/v1/assets/${encodeURIComponent(assetId)}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) return { status: 'pending' }; // transient; let the client keep polling
  const a = await res.json();
  const state = (a.status || a.state || '').toLowerCase();
  const url = a.url || a.download_url || a.output?.url || a.data?.[0]?.url;
  if ((state === 'ready' || state === 'succeeded' || state === 'completed') && url) {
    return { status: 'ready', dataUrl: await toDataUrl(url) };
  }
  if (state === 'failed' || state === 'error') {
    return { status: 'failed', error: a.error || 'generation failed' };
  }
  return { status: 'pending' };
}

async function toDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixa download failed (${res.status})`);
  const contentType = res.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}
