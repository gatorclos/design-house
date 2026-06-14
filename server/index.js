import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupAddress, propertyInfo } from './lib/property.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});

// What the client needs to know about providers (no secrets). Image generation
// is keyless (Pollinations, called from the browser); only house lookup is keyed.
app.get('/api/config', (req, res) => {
  res.json({ image: { provider: 'pollinations' }, property: propertyInfo() });
});

// Real public-record house facts for an address.
app.post('/api/lookup', wrap(async (req, res) => {
  res.json(await lookupAddress(req.body.address));
}));

// Export the app for serverless platforms (e.g. Vercel). Only bind a port when
// run directly as a normal Node process.
export default app;

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 4178;
  app.listen(PORT, () => {
    const prop = propertyInfo();
    console.log(`\n  Design House running →  http://localhost:${PORT}`);
    console.log(`  Image generation: Pollinations (keyless, browser-side)`);
    console.log(`  House lookup:     ${prop.hasKey ? `${prop.provider} (@ ${prop.host})` : 'NOT configured — set RENTCAST_API_KEY'}\n`);
  });
}
