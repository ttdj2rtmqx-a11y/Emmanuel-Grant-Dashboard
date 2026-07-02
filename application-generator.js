const TEMPLATE_MATCHERS = [
  {
    pattern: /energy|clean energy|department of energy|doe/i,
    packageName: "DOE community energy application draft",
    projectAction: "build local clean-energy planning capacity, coordinate partners, and prepare implementation-ready community projects",
    outcomes: ["Community energy plan completed", "Partner implementation roles confirmed", "Priority projects moved to funding readiness"],
    attachments: ["SF-424 package", "Budget narrative", "Partner letters", "Energy project readiness notes"]
  },
  {
    pattern: /health|human services|wellness|hhs|youth/i,
    packageName: "HHS youth wellness application draft",
    projectAction: "deliver youth wellness outreach, prevention support, and family-centered community engagement",
    outcomes: ["Youth outreach sessions delivered", "Referral and support pathways documented", "Partner feedback collected"],
    attachments: ["SF-424 package", "Project narrative", "Evaluation plan", "Partner quotes or letters"]
  },
  {
    pattern: /arts|national endowment for the arts|nea/i,
    packageName: "NEA arts access application draft",
    projectAction: "expand accessible neighborhood arts programming and remove participation barriers",
    outcomes: ["Accessible arts events produced", "Audience access supports provided", "Community artist partnerships documented"],
    attachments: ["Project narrative", "Artist or venue letters", "Budget narrative", "Work samples if required"]
  },
  {
    pattern: /education|workforce|career|training/i,
    packageName: "Education workforce pathways application draft",
    projectAction: "plan workforce pathways with employer partners, training supports, and credential-aligned services",
    outcomes: ["Employer partner map completed", "Training pathway model drafted", "Participant support plan documented"],
    attachments: ["Project narrative", "Partner commitment letters", "Work plan", "Budget narrative"]
  },
  {
    pattern: /agriculture|food|usda/i,
    packageName: "USDA food access application draft",
    projectAction: "pilot community-led food access, outreach, and local supply partnerships",
    outcomes: ["Food access pilot launched", "Distribution partners confirmed", "Community feedback loop established"],
    attachments: ["Project narrative", "Budget narrative", "Distribution partner letters", "Match documentation if required"]
  },
  {
    pattern: /environment|resilience|climate|epa/i,
    packageName: "EPA neighborhood resilience application draft",
    projectAction: "increase neighborhood preparedness, climate resilience, and response capacity",
    outcomes: ["Resilience timeline finalized", "Preparedness activities delivered", "Insurance and safety documentation verified"],
    attachments: ["Project narrative", "Timeline", "Insurance documentation", "Partner or site letters"]
  }
];

const DEFAULT_TEMPLATE = {
  packageName: "grant application draft",
  projectAction: "advance the proposed community program and complete the required grant deliverables",
  outcomes: ["Project plan completed", "Partners coordinated", "Grant deliverables prepared"],
  attachments: ["Application form", "Project narrative", "Budget narrative", "Partner documentation"]
};

export function applicationFileName(opportunity = {}) {
  const agency = opportunity.agency || "grant";
  const title = opportunity.title || "application";
  return `${slugify(`${agency}-${title}`)}-application-draft.md`;
}

export function buildApplicationPackage(opportunity = {}, profile = {}) {
  const template = selectTemplate(opportunity);
  const matchedFocusAreas = matchFocusAreas(opportunity, profile);
  const missingFields = missingProfileFields(profile);
  const requestedAmount = opportunity.amount ?? profile.defaultRequestedAmount ?? null;
  const applicantName = firstValue(profile.legalApplicantName, profile.organizationName, profile.displayName, "Emmanuel");
  const publicName = firstValue(profile.organizationName, profile.displayName, applicantName);
  const projectTitle = `${publicName}: ${opportunity.title || "Grant Project"}`;
  const confidence = estimateAutofillConfidence(profile, matchedFocusAreas, missingFields);

  return {
    packageName: template.packageName,
    projectTitle,
    applicantName,
    publicName,
    requestedAmount,
    matchedFocusAreas,
    missingFields,
    confidence,
    outcomes: template.outcomes,
    attachments: mergeUnique([...(profile.standardAttachments ?? []), ...template.attachments]),
    projectAction: template.projectAction
  };
}

export function generateApplicationMarkdown(opportunity = {}, profile = {}, options = {}) {
  const application = buildApplicationPackage(opportunity, profile);
  const generatedAt = options.generatedAt ? new Date(options.generatedAt) : new Date();
  const generatedLabel = generatedAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const amount = formatMoney(application.requestedAmount);
  const deadline = formatDate(opportunity.deadline);
  const sources = profile.publicSources ?? [];
  const focusLine = application.matchedFocusAreas.length
    ? application.matchedFocusAreas.join(", ")
    : valueOrVerify("", "PUBLIC FOCUS AREAS");

  return `# ${application.packageName}

Generated: ${generatedLabel}
Opportunity ID: ${opportunity.id || valueOrVerify("", "OPPORTUNITY ID")}
Official source: ${opportunity.url || valueOrVerify("", "OFFICIAL APPLICATION URL")}

## Cover Sheet

- Applicant legal name: ${valueOrVerify(profile.legalApplicantName, "LEGAL APPLICANT NAME")}
- Public-facing name: ${application.publicName}
- Primary contact: ${valueOrVerify(profile.primaryContact?.name, "PRIMARY CONTACT NAME")}
- Email: ${valueOrVerify(profile.primaryContact?.email, "PRIMARY CONTACT EMAIL")}
- Phone: ${valueOrVerify(profile.primaryContact?.phone, "PRIMARY CONTACT PHONE")}
- Service area: ${valueOrVerify(profile.serviceArea, "SERVICE AREA")}
- UEI/SAM/EIN: ${valueOrVerify(profile.registrationStatus, "UEI, SAM, AND EIN STATUS")}

## Opportunity Snapshot

- Grant title: ${opportunity.title || valueOrVerify("", "GRANT TITLE")}
- Agency: ${opportunity.agency || valueOrVerify("", "AGENCY")}
- Program: ${opportunity.program || valueOrVerify("", "PROGRAM")}
- Deadline: ${deadline}
- Requested amount: ${amount}
- Dashboard fit score: ${opportunity.fitScore ?? valueOrVerify("", "FIT SCORE")}
- Current stage: ${opportunity.stage || valueOrVerify("", "PIPELINE STAGE")}
- Next action: ${opportunity.nextAction || valueOrVerify("", "NEXT ACTION")}

## AI Autocomplete Draft

### Project Title

${application.projectTitle}

### Project Summary

${application.publicName} is preparing a ${amount} request to ${application.projectAction}. The proposed work aligns with ${focusLine} and responds to the ${opportunity.program || opportunity.agency || "target program"} opportunity. This draft was autocompleted from the dashboard opportunity record and the public Emmanuel profile; items that could not be verified are marked for review.

### Applicant Background

${profile.publicSummary || `${application.publicName} maintains a grant pipeline focused on community-centered funding opportunities.`}

Mission: ${profile.mission || valueOrVerify("", "PUBLIC MISSION")}

Known public strengths:
${bulletList(profile.strengths ?? ["Daily grant monitoring", "Application pipeline management", "Deadline tracking"])}

### Need Statement

The public dashboard identifies this opportunity as a ${opportunity.priority || "priority"} fit with a score of ${opportunity.fitScore ?? valueOrVerify("", "FIT SCORE")}. The program area connects to ${focusLine}. A final application should add local data, community evidence, partner quotes, and any funder-required problem statement language.

### Goals And Outcomes

${bulletList(application.outcomes)}

### Work Plan

1. Confirm eligibility, applicant registrations, and required official forms.
2. Validate public facts about Emmanuel and replace every verification marker.
3. Collect partner commitments, quotes, and local evidence for the need statement.
4. Build a line-item budget and budget narrative for ${amount}.
5. Complete final review against the funder checklist before submission.

### Budget Draft

- Requested amount: ${amount}
- Match requirement: ${valueOrVerify(opportunity.matchRequirement, "MATCH REQUIREMENT")}
- Personnel: ${valueOrVerify("", "PERSONNEL COSTS")}
- Contractors/partners: ${valueOrVerify("", "CONTRACTOR OR PARTNER COSTS")}
- Supplies/equipment: ${valueOrVerify("", "SUPPLIES OR EQUIPMENT")}
- Travel/events/outreach: ${valueOrVerify("", "TRAVEL, EVENTS, OR OUTREACH")}
- Indirect/admin: ${valueOrVerify("", "INDIRECT OR ADMIN RATE")}

## Attachment Checklist

${bulletList(application.attachments)}

## Public Sources Used

${sources.length ? sources.map((source) => `- ${source.label}: ${source.url}`).join("\n") : "- [VERIFY PUBLIC SOURCES]"}

## Fields Still Needed

${bulletList(application.missingFields)}

## Submission Reminder

This is a draft package, not a certified submission. Review the official funder instructions, remove unverified markers, confirm eligibility, and submit through the required portal.
`;
}

function selectTemplate(opportunity) {
  const haystack = [opportunity.agency, opportunity.program, opportunity.title, opportunity.summary, ...(opportunity.tags ?? [])].join(" ");
  return TEMPLATE_MATCHERS.find((template) => template.pattern.test(haystack)) ?? DEFAULT_TEMPLATE;
}

function matchFocusAreas(opportunity, profile) {
  const haystack = [opportunity.title, opportunity.summary, opportunity.program, ...(opportunity.tags ?? [])].join(" ").toLowerCase();
  const genericWords = new Set(["community", "neighborhood", "local"]);
  return (profile.focusAreas ?? [])
    .filter((area) => {
      const words = String(area)
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const signalWords = words.filter((word) => !genericWords.has(word));
      return (signalWords.length ? signalWords : words).every((word) => haystack.includes(word));
    })
    .slice(0, 4);
}

function missingProfileFields(profile) {
  const required = [
    ["Legal applicant name", profile.legalApplicantName],
    ["Primary contact email", profile.primaryContact?.email],
    ["Primary contact phone", profile.primaryContact?.phone],
    ["Service area", profile.serviceArea],
    ["UEI/SAM/EIN registration status", profile.registrationStatus],
    ["Fiscal sponsor or authorized representative", profile.authorizedRepresentative],
    ["Current operating budget", profile.operatingBudget],
    ["Local need data and citations", profile.localNeedData]
  ];

  return required.filter(([, value]) => !hasValue(value)).map(([label]) => label);
}

function estimateAutofillConfidence(profile, matchedFocusAreas, missingFields) {
  let score = 46;
  if (hasValue(profile.publicSummary)) score += 12;
  if (hasValue(profile.mission)) score += 10;
  if ((profile.strengths ?? []).length >= 3) score += 8;
  if (matchedFocusAreas.length) score += 10;
  score -= Math.min(24, missingFields.length * 3);
  return Math.max(20, Math.min(92, score));
}

function valueOrVerify(value, label) {
  return hasValue(value) ? String(value) : `[VERIFY ${label}]`;
}

function firstValue(...values) {
  return values.find((value) => hasValue(value)) ?? "";
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function mergeUnique(values) {
  return [...new Set(values.filter(hasValue))];
}

function bulletList(values) {
  const list = values.filter(hasValue);
  return list.length ? list.map((value) => `- ${value}`).join("\n") : "- [VERIFY]";
}

function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return valueOrVerify("", "REQUESTED AMOUNT");
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value));
}

function formatDate(dateKey) {
  if (!dateKey) return valueOrVerify("", "DEADLINE");
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
}

function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "grant-application";
}
