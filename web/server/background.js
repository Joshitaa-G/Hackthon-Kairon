// Background quiz (CLAUDE.md §2): fixed answer lists, shown before the first search. Every question is optional
// and has "Prefer not to say". Answers stay in the browser; a shared story carries only these coarse, fixed values
// (generation, never exact age; region, never city; self-described text never leaves the browser).
import { PROVINCES } from './store.js';

export const GENERATIONS = ['Gen Alpha', 'Gen Z', 'Millennial', 'Gen X', 'Boomer', 'Silent Generation'];

export const GENDERS = { woman: 'Woman or girl', man: 'Man or boy', 'non-binary': 'Non-binary', 'self-describe': 'Self-describe' };

// Statistics Canada population groups, plus Indigenous identities listed separately.
export const ETHNICITIES = {
  white: 'White', south_asian: 'South Asian', chinese: 'Chinese', black: 'Black', filipino: 'Filipino', arab: 'Arab',
  latin_american: 'Latin American', southeast_asian: 'Southeast Asian', west_asian: 'West Asian', korean: 'Korean', japanese: 'Japanese',
  first_nations: 'First Nations', metis: 'Métis', inuit: 'Inuit', self_describe: 'Self-describe',
};

export const US_STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];

const CA_REGIONS = [...PROVINCES, 'Yukon', 'Northwest Territories', 'Nunavut'];
export const REGIONS = { Canada: CA_REGIONS, 'United States': US_STATES, Other: [] };

export const QUIZ_OPTIONS = { generations: GENERATIONS, genders: GENDERS, ethnicities: ETHNICITIES, regions: REGIONS };

/** Keep only known values; anything else (free text, exact age, city) is dropped. Returns null when nothing is left. */
export function cleanBackground(bg) {
  if (!bg || typeof bg !== 'object' || Array.isArray(bg)) return null;
  const out = {};
  if (GENERATIONS.includes(bg.generation)) out.generation = bg.generation;
  if (typeof bg.gender === 'string' && Object.hasOwn(GENDERS, bg.gender)) out.gender = bg.gender;
  if (typeof bg.country === 'string' && Object.hasOwn(REGIONS, bg.country)) {
    out.country = bg.country;
    if (REGIONS[bg.country].includes(bg.region)) out.region = bg.region;
  }
  if (Array.isArray(bg.ethnicity)) {
    const eth = [...new Set(bg.ethnicity.filter((e) => typeof e === 'string' && Object.hasOwn(ETHNICITIES, e)))];
    if (eth.length) out.ethnicity = eth;
  }
  return Object.keys(out).length ? out : null;
}
