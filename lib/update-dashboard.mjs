import { readFile, writeFile } from "node:fs/promises";

export const dataFileUrl = new URL("../data/grants.json", import.meta.url);

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = "America/Vancouver";
const STAGES = ["Discover", "Research", "Draft", "Review", "Submitted", "Awarded", "Declined"];
const OPEN_STAGES = new Set(["Discover", "Research", "Draft", "Review"]);
const CLOSED_STAGES = new Set(["Submitted", "Awarded", "Declined"]);

export async function readDashboardData(fileUrl = dataFileUrl) {
  const raw = await readFile(fileUrl, "utf8");
  return JSON.parse(raw);
}

export async function writeDashboardData(data, fileUrl = dataFileUrl) {
  await writeFile(fileUrl, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function getLocalDateKey(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

export function addDays(dateKey, days) {
  const date = dateKeyToUtc(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromDateKey, toDateKey) {
  if (!fromDateKey || !toDateKey) return null;
  return Math.round((dateKeyToUtc(toDateKey) - dateKeyToUtc(fromDateKey)) / DAY_MS);
}

export function buildDashboardSnapshot(data, options = {}) {
  const now = options.now ?? new Date();
  const settings = {
    timezone: DEFAULT_TIMEZONE,
    dailyRunHour: 6,
    fitThreshold: 82,
    touchCadenceDays: 7,
    dueSoonDays: 14,
    ...(data.settings ?? {})
  };
  const today = getLocalDateKey(now, settings.timezone);
  const nextUpdate = addDays(today, 1);
  const opportunities = (data.opportunities ?? []).map((opportunity) =>
    normalizeOpportunity(opportunity, today, settings)
  );
  const tasks = (data.tasks ?? []).map((task) => normalizeTask(task, today));
  const applications = data.applications ?? [];
  const pipeline = buildPipeline(opportunities);
  const metrics = buildMetrics(opportunities, applications, tasks, settings);
  const dailyDigest = buildDailyDigest(opportunities, tasks, metrics, settings);
  const deadlineRadar = buildDeadlineRadar(opportunities, today);

  return {
    ...data,
    metadata: {
      ...(data.metadata ?? {}),
      lastUpdated: today,
      lastRunAt: now.toISOString(),
      nextUpdate,
      sourceStatus: data.metadata?.sourceStatus ?? "ready"
    },
    settings,
    opportunities,
    tasks,
    applications,
    metrics,
    pipeline,
    deadlineRadar,
    dailyDigest
  };
}

export async function refreshDashboardData(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const sourceUrl = options.sourceUrl ?? process.env.GRANT_FEED_URL;
  const data = await readDashboardData(options.fileUrl ?? dataFileUrl);
  const settings = {
    timezone: DEFAULT_TIMEZONE,
    ...(data.settings ?? {})
  };
  const today = getLocalDateKey(options.now ?? new Date(), settings.timezone);

  let workingData = data;
  let sourceResult = null;

  if (sourceUrl) {
    sourceResult = await tryLoadExternalOpportunities(sourceUrl);
    workingData = {
      ...workingData,
      metadata: {
        ...(workingData.metadata ?? {}),
        sourceMode: "external",
        sourceName: sourceUrl,
        sourceStatus: sourceResult.ok
          ? `Imported ${sourceResult.opportunities.length} opportunities`
          : `External source failed: ${sourceResult.error}`
      },
      opportunities: sourceResult.ok
        ? mergeOpportunities(workingData.opportunities ?? [], sourceResult.opportunities)
        : workingData.opportunities
    };
  }

  const alreadyUpdated = workingData.metadata?.lastUpdated === today;
  const snapshot = buildDashboardSnapshot(workingData, options);
  const shouldWrite = !dryRun && (force || !alreadyUpdated || sourceUrl || options.writeEvenIfCurrent);

  if (shouldWrite) {
    await writeDashboardData(snapshot, options.fileUrl ?? dataFileUrl);
  }

  return {
    data: snapshot,
    wrote: shouldWrite,
    alreadyUpdated,
    sourceResult
  };
}

function normalizeOpportunity(opportunity, today, settings) {
  const stage = normalizeStage(opportunity.stage);
  const daysUntilDeadline = daysBetween(today, opportunity.deadline);
  const daysSinceTouch = daysBetween(opportunity.lastTouched, today);
  const computedStatus = getOpportunityStatus(stage, daysUntilDeadline, settings);
  const priority = normalizePriority(opportunity.priority, opportunity.fitScore, daysUntilDeadline);

  return {
    ...opportunity,
    stage,
    priority,
    status: computedStatus,
    amount: Number(opportunity.amount ?? 0),
    fitScore: clamp(Number(opportunity.fitScore ?? 0), 0, 100),
    daysUntilDeadline,
    daysSinceTouch,
    touchStatus:
      daysSinceTouch === null
        ? "unknown"
        : daysSinceTouch > settings.touchCadenceDays
          ? "needs-touch"
          : "current",
    nextAction: opportunity.nextAction || suggestNextAction(stage, daysUntilDeadline)
  };
}

function normalizeTask(task, today) {
  const status = String(task.status ?? "Open");
  const done = status.toLowerCase() === "done" || status.toLowerCase() === "complete";
  const daysUntilDue = daysBetween(today, task.dueDate);
  let computedStatus = status;

  if (!done && daysUntilDue !== null) {
    if (daysUntilDue < 0) computedStatus = "Overdue";
    else if (daysUntilDue === 0) computedStatus = "Due today";
    else if (daysUntilDue <= 3) computedStatus = "Due soon";
    else computedStatus = "Open";
  }

  return {
    ...task,
    status: computedStatus,
    daysUntilDue
  };
}

function buildPipeline(opportunities) {
  return STAGES.map((stage) => ({
    stage,
    count: opportunities.filter((opportunity) => opportunity.stage === stage).length,
    amount: opportunities
      .filter((opportunity) => opportunity.stage === stage)
      .reduce((sum, opportunity) => sum + Number(opportunity.amount ?? 0), 0)
  }));
}

function buildMetrics(opportunities, applications, tasks, settings) {
  const activeOpportunities = opportunities.filter((opportunity) => OPEN_STAGES.has(opportunity.stage));
  const openOpportunities = activeOpportunities.filter((opportunity) => opportunity.status !== "closed");
  const dueSoon = openOpportunities.filter(
    (opportunity) =>
      opportunity.daysUntilDeadline !== null &&
      opportunity.daysUntilDeadline >= 0 &&
      opportunity.daysUntilDeadline <= settings.dueSoonDays
  );
  const highFit = openOpportunities.filter((opportunity) => opportunity.fitScore >= settings.fitThreshold);
  const requestedAmount = openOpportunities.reduce(
    (sum, opportunity) => sum + Number(opportunity.amount ?? 0),
    0
  );
  const avgFit =
    openOpportunities.length === 0
      ? 0
      : Math.round(
          openOpportunities.reduce((sum, opportunity) => sum + Number(opportunity.fitScore ?? 0), 0) /
            openOpportunities.length
        );
  const nextDeadline = [...openOpportunities]
    .filter((opportunity) => opportunity.daysUntilDeadline !== null && opportunity.daysUntilDeadline >= 0)
    .sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline)[0];

  return {
    openOpportunities: openOpportunities.length,
    dueSoon: dueSoon.length,
    highFit: highFit.length,
    activeApplications: applications.filter((application) => !application.submittedAt).length,
    requestedAmount,
    averageFitScore: avgFit,
    overdueTasks: tasks.filter((task) => task.status === "Overdue").length,
    dueTodayTasks: tasks.filter((task) => task.status === "Due today").length,
    nextDeadline: nextDeadline
      ? {
          id: nextDeadline.id,
          title: nextDeadline.title,
          date: nextDeadline.deadline,
          daysUntilDeadline: nextDeadline.daysUntilDeadline
        }
      : null
  };
}

function buildDailyDigest(opportunities, tasks, metrics, settings) {
  const items = [];
  const dueSoon = opportunities
    .filter(
      (opportunity) =>
        opportunity.status !== "closed" &&
        opportunity.daysUntilDeadline !== null &&
        opportunity.daysUntilDeadline >= 0 &&
        opportunity.daysUntilDeadline <= settings.dueSoonDays
    )
    .sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline);
  const stale = opportunities
    .filter((opportunity) => opportunity.touchStatus === "needs-touch" && opportunity.status !== "closed")
    .sort((a, b) => b.fitScore - a.fitScore);
  const urgentTask = tasks
    .filter((task) => ["Overdue", "Due today", "Due soon"].includes(task.status))
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue)[0];

  if (dueSoon[0]) {
    items.push({
      type: "deadline",
      severity: dueSoon[0].daysUntilDeadline <= 7 ? "critical" : "warning",
      title: `${dueSoon[0].title} closes in ${dueSoon[0].daysUntilDeadline} days`,
      detail: dueSoon[0].nextAction,
      opportunityId: dueSoon[0].id
    });
  }

  if (urgentTask) {
    items.push({
      type: "task",
      severity: urgentTask.status === "Overdue" ? "critical" : "warning",
      title: urgentTask.title,
      detail:
        urgentTask.daysUntilDue === 0
          ? "Due today"
          : urgentTask.daysUntilDue < 0
            ? `${Math.abs(urgentTask.daysUntilDue)} days overdue`
            : `Due in ${urgentTask.daysUntilDue} days`,
      opportunityId: urgentTask.opportunityId
    });
  }

  if (stale[0]) {
    items.push({
      type: "cadence",
      severity: "attention",
      title: `${stale[0].title} needs a follow-up touch`,
      detail: `Last touched ${stale[0].daysSinceTouch} days ago`,
      opportunityId: stale[0].id
    });
  }

  if (metrics.highFit > 0) {
    items.push({
      type: "fit",
      severity: "positive",
      title: `${metrics.highFit} high-fit opportunities are active`,
      detail: `Average fit score is ${metrics.averageFitScore}`,
      opportunityId: null
    });
  }

  if (items.length === 0) {
    items.push({
      type: "steady",
      severity: "positive",
      title: "Pipeline is current",
      detail: "No urgent deadlines or overdue tasks were detected.",
      opportunityId: null
    });
  }

  return items.slice(0, 4);
}

function buildDeadlineRadar(opportunities, today) {
  return opportunities
    .filter((opportunity) => opportunity.deadline)
    .map((opportunity) => ({
      id: opportunity.id,
      title: opportunity.title,
      deadline: opportunity.deadline,
      daysUntilDeadline: daysBetween(today, opportunity.deadline),
      priority: opportunity.priority,
      fitScore: opportunity.fitScore
    }))
    .sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline)
    .slice(0, 12);
}

async function tryLoadExternalOpportunities(sourceUrl) {
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const rows = extractOpportunityRows(payload);
    const opportunities = rows.map((row, index) => mapExternalOpportunity(row, index)).filter(Boolean);

    return {
      ok: true,
      opportunities
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      opportunities: []
    };
  }
}

function extractOpportunityRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.grants)) return payload.grants;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function mapExternalOpportunity(row, index) {
  const title = firstValue(row, ["title", "opportunityTitle", "opportunity_title", "name"]);
  const agency = firstValue(row, ["agency", "agencyName", "agency_name", "funder"]);
  const deadline = normalizeDate(firstValue(row, ["deadline", "closeDate", "close_date", "dueDate"]));

  if (!title || !agency || !deadline) return null;

  const id =
    firstValue(row, ["id", "opportunityId", "opportunity_id", "number", "opportunityNumber"]) ??
    slugify(`${agency}-${title}-${deadline}-${index}`);

  return {
    id: String(id),
    title: String(title),
    agency: String(agency),
    program: String(firstValue(row, ["program", "programName", "category"]) ?? "Imported"),
    amount: numberFrom(firstValue(row, ["amount", "awardCeiling", "award_floor", "estimatedFunding"])) ?? 0,
    deadline,
    stage: "Discover",
    priority: "Medium",
    fitScore: numberFrom(firstValue(row, ["fitScore", "score"])) ?? 70,
    lastTouched: null,
    nextAction: "Review eligibility and decide whether to pursue.",
    owner: "Emmanuel",
    url: firstValue(row, ["url", "link", "opportunityUrl"]) ?? "",
    tags: normalizeTags(firstValue(row, ["tags", "categories", "category"])),
    summary: String(firstValue(row, ["summary", "description", "synopsis"]) ?? "")
  };
}

function mergeOpportunities(existing, incoming) {
  const byId = new Map(existing.map((opportunity) => [String(opportunity.id), opportunity]));

  for (const imported of incoming) {
    const current = byId.get(String(imported.id));
    byId.set(String(imported.id), {
      ...imported,
      ...(current
        ? {
            stage: current.stage,
            priority: current.priority,
            fitScore: current.fitScore,
            lastTouched: current.lastTouched,
            nextAction: current.nextAction,
            owner: current.owner,
            tags: Array.from(new Set([...(current.tags ?? []), ...(imported.tags ?? [])]))
          }
        : {})
    });
  }

  return [...byId.values()];
}

function getOpportunityStatus(stage, daysUntilDeadline, settings) {
  if (CLOSED_STAGES.has(stage)) return "closed";
  if (daysUntilDeadline !== null && daysUntilDeadline < 0) return "closed";
  if (daysUntilDeadline !== null && daysUntilDeadline <= settings.dueSoonDays) return "due-soon";
  return "open";
}

function normalizeStage(stage) {
  const incoming = String(stage ?? "Discover").trim();
  return STAGES.find((item) => item.toLowerCase() === incoming.toLowerCase()) ?? "Discover";
}

function normalizePriority(priority, fitScore = 0, daysUntilDeadline = null) {
  const incoming = String(priority ?? "").trim().toLowerCase();
  if (incoming === "high" || incoming === "medium" || incoming === "low") {
    return capitalize(incoming);
  }
  if (daysUntilDeadline !== null && daysUntilDeadline <= 10) return "High";
  if (Number(fitScore) >= 85) return "High";
  if (Number(fitScore) >= 70) return "Medium";
  return "Low";
}

function suggestNextAction(stage, daysUntilDeadline) {
  if (daysUntilDeadline !== null && daysUntilDeadline <= 7) return "Clear blockers and prepare final submission.";
  if (stage === "Discover") return "Review eligibility and make a pursue or pass decision.";
  if (stage === "Research") return "Confirm funder fit and required attachments.";
  if (stage === "Draft") return "Complete the narrative and budget drafts.";
  if (stage === "Review") return "Run final compliance review.";
  return "Monitor funder updates.";
}

function firstValue(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null && object?.[key] !== "") {
      return object[key];
    }
  }
  return null;
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    return value
      .split(/[;,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function dateKeyToUtc(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
