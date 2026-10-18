// Runs after `npm install`: downloads the local embedding model into node_modules so first start is instant/offline.
import { embed } from '../server/embed.js';

try {
  await embed(['warm up']);
  console.log('Embedding model ready.');
} catch (e) {
  console.warn(`Could not pre-download the embedding model (${e.message}). It will download on first start instead.`);
}
