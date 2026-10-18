// User settings (Gemini key + model), edited from the UI and kept in data/settings.json (gitignored).
// On a server, set GEMINI_API_KEY (and optionally GEMINI_MODEL) as environment variables instead: they win over the
// file, the key is never sent to the browser, and the Settings dialog becomes read-only.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fromRoot } from './paths.js';

const FILE = fromRoot('data/settings.json');
const DEFAULTS = { geminiApiKey: '', geminiModel: 'gemini-3.8-flash' };

export const keyFromEnv = () => !!process.env.GEMINI_API_KEY;

export function getSettings() {
  let saved = {};
  try {
    saved = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  } catch { /* unreadable file: fall back to defaults */ }
  const env = {
    ...(process.env.GEMINI_API_KEY && { geminiApiKey: process.env.GEMINI_API_KEY }),
    ...(process.env.GEMINI_MODEL && { geminiModel: process.env.GEMINI_MODEL }),
  };
  return { ...DEFAULTS, ...saved, ...env };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export const maskKey = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');
