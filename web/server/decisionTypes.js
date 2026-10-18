// Fixed list of decision types (ported from the Been There reference repo, plus a freelance type).
// label: shown to user | about: used in extraction prompt | description: embedded for classification
// keywords: regex fast-path for classification | sites/search: Stack Exchange fetch config
export const DECISION_TYPES = {
  go_freelance: {
    label: 'Going freelance / self-employed',
    about: 'going freelance, becoming self-employed or starting their own small business',
    description: 'Leaving a salaried job to freelance, consult, work as an independent contractor, or become self-employed.',
    keywords: [/\bfreelanc\w*/i, /\bself[- ]employ\w*/i, /\bindependent contractor\b/i, /\b(go|going|went) (solo|independent)\b/i, /\bconsult(ing|ant)\b/i, /\bown business\b/i],
    sites: ['workplace'],
    search: ['freelance', 'self-employed', 'independent contractor', 'start own business'],
  },
  quit_job: {
    label: 'Quitting a job',
    about: 'quitting a job',
    description: 'Quitting or resigning from my current job, or staying in a job I am unhappy in.',
    keywords: [/\bquit(ting)?\b/i, /\bresign(ing|ation)?\b/i, /\b(leave|leaving) my job\b/i],
    sites: ['workplace'],
    search: ['quit job', 'resign'],
  },
  career_change: {
    label: 'Changing careers',
    about: 'changing careers',
    description: 'Changing careers into a completely different field, for example through a bootcamp, retraining, or a pay cut to do different work.',
    keywords: [/\bcareers?\s+change\b/i, /\b(change|switch|changing|switching) careers?\b/i, /\bnew career\b/i, /\bbootcamp\b/i],
    sites: ['workplace'],
    search: ['career change', 'switch careers'],
  },
  switch_major: {
    label: 'Choosing or switching your program/major',
    about: 'choosing or switching their program or major',
    description: 'Switching my university major or program, changing what I study, for example from biology to computer science.',
    keywords: [/\b(my|college|university|undergrad|double) majors?\b/i, /\bmajor(ing|ed)? in\b/i,/\b(switch|change|changing|switching) (my )?(program|major|field of study)\b/i],
    sites: ['academia'],
    search: ['change major', 'switch major', 'change field', 'switch program'],
  },
  grad_vs_work: {
    label: 'Grad school vs starting work',
    about: 'going to grad school vs starting work (including leaving a PhD)',
    description: 'Deciding between grad school (a master\'s or PhD) and starting a job, or leaving a PhD program for an industry job.',
    keywords: [/\bph\.?d\b/i, /\bgrad(uate)? school\b/i, /\bmaster'?s( degree| program| in)\b/i],
    sites: ['academia'],
    search: ['PhD industry', 'leave PhD', "master's job"],
  },
};

export const LABELS = Object.fromEntries(Object.entries(DECISION_TYPES).map(([k, v]) => [k, v.label]));
