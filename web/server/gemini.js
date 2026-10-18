// Thin Gemini REST client (free tier via Google AI Studio key). JSON mode only; we validate the output ourselves.
import { getSettings } from './settings.js';

export const geminiConfigured = () => !!getSettings().geminiApiKey;

export async function geminiJson({ system, user, model = getSettings().geminiModel, retries = 1 }) {
  for (let attempt = 0, busy = 0; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': getSettings().geminiApiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8000, responseMimeType: 'application/json' },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if ((res.status === 503 || res.status === 500) && busy++ < 4) { // temporary overload: wait and retry
      await new Promise((r) => setTimeout(r, 4000 * busy));
      continue;
    }
    if (!res.ok) {
      const err = new Error(body?.error?.message || `Gemini HTTP ${res.status}`);
      err.status = res.status;
      err.daily = /per day|PerDay/i.test(JSON.stringify(body));
      throw err;
    }
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    try {
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      if (attempt >= retries) throw new Error(`Gemini returned invalid JSON (${body.candidates?.[0]?.finishReason ?? 'unknown'})`);
    }
  }
}
