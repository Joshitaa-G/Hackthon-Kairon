// Local embeddings (no API calls): all-MiniLM-L6-v2 via transformers.js, 384-dim, L2-normalised.
// The model is fetched into node_modules by `npm install` (see scripts/postinstall.js).
import { pipeline } from '@huggingface/transformers';

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
let extractor;

async function getExtractor() {
  extractor ??= await pipeline('feature-extraction', EMBED_MODEL);
  return extractor;
}

const round = (v) => Math.round(v * 1e5) / 1e5;

/** Embed an array of strings -> array of number[] (unit vectors). */
export async function embed(texts) {
  const ex = await getExtractor();
  const out = await ex(texts, { pooling: 'mean', normalize: true });
  const [n, dim] = out.dims;
  const flat = out.data;
  return Array.from({ length: n }, (_, i) =>
    Array.from(flat.subarray(i * dim, (i + 1) * dim), round)
  );
}
