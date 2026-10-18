// Absolute paths from the repo root, so the server and scripts work from any working directory.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const fromRoot = (...p) => path.join(ROOT, ...p);
