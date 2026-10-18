// Reset the app to a clean demo state: removes stories shared through the app (data/stories/user_stories.jsonl).
// Keeps the curated stories and your saved AI key (data/settings.json). Restart the server afterwards.
// Browser-side data (quiz answers, saved collections) is cleared by opening http://localhost:3000/?reset
// Usage: npm run reset-demo
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fromRoot } from '../server/paths.js';

const shared = fromRoot('data/stories/user_stories.jsonl');
if (existsSync(shared)) {
  const n = readFileSync(shared, 'utf8').split('\n').filter(Boolean).length;
  rmSync(shared);
  console.log(`Removed ${n} shared stor${n === 1 ? 'y' : 'ies'}.`);
} else {
  console.log('No shared stories to remove.');
}
console.log(existsSync(fromRoot('data/settings.json')) ? 'Kept your AI key and model settings.' : 'No saved AI key found (that is fine if you use GEMINI_API_KEY).');
console.log('Next: restart the server (npm start), then open http://localhost:3000/?reset to clear the browser side.');
