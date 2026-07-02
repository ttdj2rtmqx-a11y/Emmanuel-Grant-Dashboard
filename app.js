import {
  applicationFileName,
  buildApplicationPackage,
  generateApplicationMarkdown
} from "./application-generator.js";

const state = {
  dashboard: null,
  profile: null,
  opportunities: [],
  filters: {
    search: "",
    status: "all",
    priority: "all"
  }
};

const elements = {
  kpiGrid: document.querySelector("#kpiGrid"),
  briefList: document.querySelector("#briefList"),
  briefCount: document.querySelector("#briefCount"),
  opportunityTable: document.querySelector("#opportunityTable"),
  taskList: document.querySelector("#taskList"),
  deadlineRadar: document.querySelector("#deadlineRadar"),
  pipelineChart: document.querySelector("#pipelineChart"),
  refreshButton: document.querySelector("#refreshButton"),
  lastUpdated: document.querySelector("#lastUpdated"),
  nextUpdate: document.querySelector("#nextUpdate"),
  sourceStatus: document.querySelector("#sourceStatus"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  priorityFilter: document.querySelector("#priorityFilter"),
  detailDrawer: document.querySelector("#detailDrawer"),
  drawerContent: document.querySelector("#drawerContent"),
  drawerClose: document.querySelector("#drawerClose")
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric"
});

init();

async function init() {
  wireEvents();
  await loadDashboard();
}

function wireEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    renderOpportunities();
  });

  elements.statusFilter.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    renderOpportunities();
  });

  elements.priorityFilter.addEventListener("change", (event) => {
    state.filters.priority = event.target.value;
    renderOpportunities();
  });

  elements.refreshButton.addEventListener("click", async () => {
    elements.refreshButton.disabled = true;
    elements.refreshButton.textContent = "Refreshing";
    try {
      const response = await fetch("/api/refresh", { method: "POST" });
      if (!response.ok) throw new Error("Refresh failed");
      const payload = await response.json();
      state.dashboard = payload.dashboard;
      state.opportunities = payload.dashboard.opportunities ?? [];
      renderDashboard();
    } catch {
      await loadDashboard();
    } finally {
      elements.refreshButton.disabled = false;
      elements.refreshButton.innerHTML = refreshButtonContent();
    }
  });

  elements.drawerClose.addEventListener("click", closeDrawer);
  elements.drawerContent.addEventListener("click", handleDrawerAction);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
}

async function loadDashboard() {
  const [dashboard, profile] = await Promise.all([fetchDashboardData(), fetchProfileData()]);
  if (!dashboard) {
    throw new Error("Dashboard data could not be loaded");
  }
  state.dashboard = dashboard;
  state.profile = profile;
  state.opportunities = state.dashboard.opportunities ?? [];
  renderDashboard();
}

async function fetchDashboardData() {
  let response = await fetch("/api/dashboard").catch(() => null);
  if (!response?.ok) {
    response = await fetch("./data/grants.json").catch(() => null);
  }
  return response?.ok ? response.json() : null;
}

async function fetchProfileData() {
  const response = await fetch("./data/emmanuel-profile.json").catch(() => null);
  return response?.ok ? response.json() : {};
}

function renderDashboard() {
  renderMeta();
  renderKpis();
  renderBrief();
  renderOpportunities();
  renderTasks();
  renderDeadlineRadar();
  renderPipelineChart();
}

function renderMeta() {
  const metadata = state.dashboard.metadata ?? {};
  elements.lastUpdated.textContent = `Updated ${formatDate(metadata.lastUpdated)}`;
  elements.nextUpdate.textContent = formatDate(metadata.nextUpdate);
  elements.sourceStatus.textContent = metadata.sourceStatus ?? "Ready";
}

function renderKpis() {
  const metrics = state.dashboard.metrics ?? {};
  const kpis = [
    {
      label: "Open opportunities",
      value: numberFormatter.format(metrics.openOpportunities ?? 0),
      detail: `${numberFormatter.format(metrics.highFit ?? 0)} high-fit targets`
    },
    {
      label: "Due soon",
      value: numberFormatter.format(metrics.dueSoon ?? 0),
      detail: "Deadlines inside the daily watch window"
    },
    {
      label: "Pipeline value",
      value: moneyFormatter.format(metrics.requestedAmount ?? 0),
      detail: `${numberFormatter.format(metrics.activeApplications ?? 0)} active applications`
    },
    {
      label: "Average fit",
      value: `${metrics.averageFitScore ?? 0}`,
      detail:
        metrics.nextDeadline === null
          ? "No active deadline"
          : `${metrics.nextDeadline.title} closes ${formatRelativeDays(metrics.nextDeadline.daysUntilDeadline)}`
    }
  ];

  elements.kpiGrid.innerHTML = kpis
    .map(
      (kpi) => `
        <article class="kpi-card">
          <span>${escapeHtml(kpi.label)}</span>
          <strong>${escapeHtml(kpi.value)}</strong>
          <p>${escapeHtml(kpi.detail)}</p>
        </article>
      `
    )
    .join("");
}

function renderBrief() {
  const items = state.dashboard.dailyDigest ?? [];
  elements.briefCount.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
  elements.briefList.innerHTML = items
    .map(
      (item) => `
        <article class="brief-item" data-severity="${escapeAttribute(item.severity)}">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.detail)}</span>
        </article>
      `
    )
    .join("");
}

function renderOpportunities() {
  const filtered = state.opportunities.filter((opportunity) => {
    const haystack = [
      opportunity.title,
      opportunity.agency,
      opportunity.program,
      opportunity.summary,
      ...(opportunity.tags ?? [])
    ]
      .join(" ")
      .toLowerCase();
    const matchesSearch = !state.filters.search || haystack.includes(state.filters.search);
    const matchesStatus = state.filters.status === "all" || opportunity.status === state.filters.status;
    const matchesPriority = state.filters.priority === "all" || opportunity.priority === state.filters.priority;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  if (filtered.length === 0) {
    elements.opportunityTable.innerHTML = `<div class="grant-row"><p>No matching opportunities.</p></div>`;
    return;
  }

  elements.opportunityTable.innerHTML = filtered
    .map(
      (opportunity) => `
        <button class="grant-row" type="button" data-grant-id="${escapeAttribute(opportunity.id)}">
          <div>
            <h4>${escapeHtml(opportunity.title)}</h4>
            <p>${escapeHtml(opportunity.agency)} · ${escapeHtml(opportunity.program ?? "Program")}</p>
          </div>
          <div>
            <span class="row-label">Deadline</span>
            <span class="row-value">${escapeHtml(formatDate(opportunity.deadline))}</span>
          </div>
          <div>
            <span class="row-label">Fit</span>
            <span class="row-value">${numberFormatter.format(opportunity.fitScore ?? 0)}</span>
          </div>
          <div>
            <span class="row-label">Stage</span>
            <span class="row-value">${escapeHtml(opportunity.stage)}</span>
          </div>
          <div>
            <span class="status-chip" data-status="${escapeAttribute(opportunity.status)}">
              ${escapeHtml(statusLabel(opportunity.status))}
            </span>
          </div>
        </button>
      `
    )
    .join("");

  elements.opportunityTable.querySelectorAll("[data-grant-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const opportunity = state.opportunities.find((item) => item.id === row.dataset.grantId);
      if (opportunity) openDrawer(opportunity);
    });
  });
}

function renderTasks() {
  const opportunitiesById = new Map(state.opportunities.map((opportunity) => [opportunity.id, opportunity]));
  const tasks = [...(state.dashboard.tasks ?? [])]
    .filter((task) => task.status !== "Done")
    .sort((a, b) => (a.daysUntilDue ?? 999) - (b.daysUntilDue ?? 999))
    .slice(0, 6);

  elements.taskList.innerHTML = tasks
    .map((task) => {
      const opportunity = opportunitiesById.get(task.opportunityId);
      return `
        <article class="task-item">
          <strong>${escapeHtml(task.title)}</strong>
          <div class="task-meta">
            <span class="status-chip" data-status="${escapeAttribute(task.status)}">${escapeHtml(task.status)}</span>
            <span>${escapeHtml(formatDate(task.dueDate))}</span>
            <span>${escapeHtml(opportunity?.title ?? "General")}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDeadlineRadar() {
  const items = state.dashboard.deadlineRadar ?? [];
  elements.deadlineRadar.innerHTML = items
    .map((item) => {
      const pressure = Math.max(6, Math.min(100, 100 - Math.max(item.daysUntilDeadline ?? 0, 0) * 2));
      return `
        <article class="deadline-item">
          <div class="deadline-line">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(formatRelativeDays(item.daysUntilDeadline))}</span>
          </div>
          <div class="pressure-bar" aria-hidden="true"><span style="width: ${pressure}%"></span></div>
        </article>
      `;
    })
    .join("");
}

function renderPipelineChart() {
  const canvas = elements.pipelineChart;
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(280 * ratio));
  context.scale(ratio, ratio);

  const width = rect.width;
  const height = 280;
  const padding = 34;
  const rows = state.dashboard.pipeline ?? [];
  const maxAmount = Math.max(1, ...rows.map((row) => row.amount));
  const barWidth = Math.max(26, (width - padding * 2) / rows.length - 12);

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  rows.forEach((row, index) => {
    const x = padding + index * (barWidth + 12);
    const barHeight = Math.round(((row.amount || 0) / maxAmount) * 146);
    const y = height - padding - barHeight - 34;
    const color = ["#097c71", "#326da8", "#b4791f", "#2f7a3f", "#6a5caa", "#7b6d5d", "#b2434a"][index];

    context.fillStyle = "#e7ece7";
    roundRect(context, x, height - padding - 34 - 146, barWidth, 146, 6);
    context.fill();

    context.fillStyle = color;
    roundRect(context, x, y, barWidth, Math.max(4, barHeight), 6);
    context.fill();

    context.fillStyle = "#1f2528";
    context.font = "700 12px Inter, system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(String(row.count), x + barWidth / 2, y - 8);

    context.fillStyle = "#667076";
    context.font = "700 11px Inter, system-ui, sans-serif";
    context.fillText(shortStageLabel(row.stage), x + barWidth / 2, height - padding);
  });
}

function openDrawer(opportunity) {
  const application = buildApplicationPackage(opportunity, state.profile ?? {});
  elements.drawerContent.className = "drawer-content";
  elements.drawerContent.innerHTML = `
    <h3>${escapeHtml(opportunity.title)}</h3>
    <p>${escapeHtml(opportunity.summary ?? "")}</p>
    <dl class="detail-list">
      <div><dt>Agency</dt><dd>${escapeHtml(opportunity.agency)}</dd></div>
      <div><dt>Deadline</dt><dd>${escapeHtml(formatDate(opportunity.deadline))} (${escapeHtml(formatRelativeDays(opportunity.daysUntilDeadline))})</dd></div>
      <div><dt>Amount</dt><dd>${escapeHtml(moneyFormatter.format(opportunity.amount ?? 0))}</dd></div>
      <div><dt>Stage</dt><dd>${escapeHtml(opportunity.stage)}</dd></div>
      <div><dt>Priority</dt><dd>${escapeHtml(opportunity.priority)}</dd></div>
      <div><dt>Fit score</dt><dd>${escapeHtml(String(opportunity.fitScore ?? 0))}</dd></div>
      <div><dt>Next action</dt><dd>${escapeHtml(opportunity.nextAction ?? "Review opportunity.")}</dd></div>
    </dl>
    <section class="application-panel" aria-label="Application draft">
      <div>
        <span class="row-label">Application package</span>
        <strong>${escapeHtml(application.packageName)}</strong>
        <p>${escapeHtml(application.confidence)}% autofill confidence from public dashboard data</p>
      </div>
      <button class="icon-button application-download" type="button" data-download-application="${escapeAttribute(opportunity.id)}">
        ${downloadIcon()}
        Download AI draft
      </button>
    </section>
    ${
      opportunity.url
        ? `<a class="icon-button source-link" href="${escapeAttribute(opportunity.url)}" target="_blank" rel="noreferrer">Open source</a>`
        : ""
    }
  `;
  elements.detailDrawer.classList.add("open");
}

function handleDrawerAction(event) {
  const button = event.target.closest("[data-download-application]");
  if (!button) return;

  const opportunity = state.opportunities.find((item) => item.id === button.dataset.downloadApplication);
  if (!opportunity) return;

  const markdown = generateApplicationMarkdown(opportunity, state.profile ?? {});
  downloadText(applicationFileName(opportunity), markdown, "text/markdown");
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function closeDrawer() {
  elements.detailDrawer.classList.remove("open");
}

function refreshButtonContent() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 0 0-14.5-4.7L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.5 4.7L20 16" />
      <path d="M20 20v-4h-4" />
    </svg>
    Refresh
  `;
}

function downloadIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  `;
}

function formatDate(dateKey) {
  if (!dateKey) return "Not set";
  const [year, month, day] = dateKey.split("-").map(Number);
  return dateFormatter.format(new Date(year, month - 1, day));
}

function formatRelativeDays(days) {
  if (days === null || days === undefined) return "No date";
  if (days < 0) return `${Math.abs(days)} days late`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function statusLabel(status) {
  const labels = {
    "due-soon": "Due soon",
    open: "Open",
    closed: "Closed"
  };
  return labels[status] ?? status;
}

function shortStageLabel(stage) {
  const labels = {
    Discover: "Dis",
    Research: "Res",
    Draft: "Drf",
    Review: "Rev",
    Submitted: "Sub",
    Awarded: "Awd",
    Declined: "Dec"
  };
  return labels[stage] ?? String(stage).slice(0, 6);
}

function roundRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

window.addEventListener("resize", () => {
  if (state.dashboard) renderPipelineChart();
});
