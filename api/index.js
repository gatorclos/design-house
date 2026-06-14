// Vercel serverless entry — re-exports the Express app as the function handler.
// @vercel/node invokes an exported Express app directly.
import app from '../server/index.js';

export default app;
