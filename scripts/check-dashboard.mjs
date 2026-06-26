#!/usr/bin/env node

import { buildDashboardSnapshot, readDashboardData } from "../lib/update-dashboard.mjs";

const data = await readDashboardData();
const snapshot = buildDashboardSnapshot(data);
const failures = [];

if (!snapshot.metadata?.dashboardName) failures.push("Missing dashboard name");
if (!Array.isArray(snapshot.opportunities) || snapshot.opportunities.length === 0) {
  failures.push("No grant opportunities found");
}
if (!Array.isArray(snapshot.dailyDigest) || snapshot.dailyDigest.length === 0) {
  failures.push("Daily digest did not generate");
}
if (!snapshot.metrics || typeof snapshot.metrics.openOpportunities !== "number") {
  failures.push("Metrics did not generate");
}
if (!Array.isArray(snapshot.pipeline) || snapshot.pipeline.length === 0) {
  failures.push("Pipeline did not generate");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Dashboard check passed: ${snapshot.metrics.openOpportunities} open opportunities, ${snapshot.metrics.dueSoon} due soon.`
);
