"""The fixed list of decision types. Everything else imports from here.

label:       shown to the user
about:       used in the extraction prompt ("a decision they personally made about ...")
description: embedded to find the closest types when /match is unsure
keywords:    regexes for the free /match fast-path (one clear hit = no LLM call)
"""

DECISION_TYPES = {
    "switch_major": {
        "label": "Choosing or switching your program/major",
        "about": "choosing or switching their program or major",
        "description": "Switching my university major or program, changing what I study, "
                       "for example from biology to computer science, or staying in a program I dislike.",
        "keywords": [r"\bmajors?\b", r"\b(switch|change|changing|switching) (my )?(program|major|field of study)\b",
                     r"\bminor in\b"],
    },
    "grad_vs_work": {
        "label": "Grad school vs starting work",
        "about": "going to grad school vs starting work (including leaving a PhD)",
        "description": "Deciding between grad school (a master's or PhD) and starting a job, "
                       "or leaving a PhD program for an industry job.",
        "keywords": [r"\bph\.?d\b", r"\bgrad(uate)? school\b", r"\bmaster'?s\b"],
    },
    "quit_job": {
        "label": "Quitting a job",
        "about": "quitting a job",
        "description": "Quitting or resigning from my current job, or staying in a job I am unhappy in.",
        "keywords": [r"\bquit(ting)?\b", r"\bresign(ing|ation)?\b", r"\b(leave|leaving) my job\b"],
    },
    "career_change": {
        "label": "Changing careers",
        "about": "changing careers",
        "description": "Changing careers into a completely different field, for example through a "
                       "bootcamp, retraining, or a pay cut to do different work.",
        "keywords": [r"\bcareers?\s+change\b", r"\b(change|switch|changing|switching) careers?\b",
                     r"\bnew career\b", r"\bbootcamp\b"],
    },
    "gap_year": {
        "label": "Taking a gap year",
        "about": "taking a gap year",
        "description": "Taking a gap year or a year off before or during school.",
        "keywords": [r"\bgap year\b", r"\byear off\b"],
    },
}

LABELS = {k: v["label"] for k, v in DECISION_TYPES.items()}
