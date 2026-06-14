import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupAddress, propertyInfo } from './lib/property.js';
import { startGeneration, getAsset, providerInfo } from './lib/pixa.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Generated images travel as data URLs, so allow a generous JSON body. (On
// Vercel the platform still caps request bodies ~4.5MB, so the client downsizes
// the source photo before sending it.)
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});

// What the client needs to know about providers (no secrets).
app.get('/api/config', (req, res) => {
  res.json({ image: providerInfo(), property: propertyInfo() });
});

// Real public-record house facts for an address.
app.post('/api/lookup', wrap(async (req, res) => {
  res.json(await lookupAddress(req.body.address));
}));

// Kick off a redesign. Body: { prompt, image? } where image is the local source
// photo as a (downscaled) data URL — passed transiently to Pixa, never stored.
app.post('/api/generate', wrap(async (req, res) => {
  const prompt = (req.body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  res.json(await startGeneration({ prompt, image: req.body.image }));
}));

// Poll a pending generation.
app.get('/api/asset/:id', wrap(async (req, res) => {
  res.json(await getAsset(req.params.id));
}));

// Export the app for serverless platforms (e.g. Vercel). Only bind a port when
// run directly as a normal Node process.
export default app;

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 4178;
  app.listen(PORT, () => {
    const img = providerInfo();
    const prop = propertyInfo();
    console.log(`\n  Design House running →  http://localhost:${PORT}`);
    console.log(`  Image generation: ${img.provider === 'pixa' ? `pixa (${img.model})` : 'NOT configured — set PIXA_API_KEY'}`);
    console.log(`  House lookup:     ${prop.hasKey ? `${prop.provider} (@ ${prop.host})` : 'NOT configured — set PROPERTY_API_KEY'}\n`);
  });
}
