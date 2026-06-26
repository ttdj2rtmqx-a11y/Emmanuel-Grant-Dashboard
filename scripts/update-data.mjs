#!/usr/bin/env node

import { refreshDashboardData } from "../lib/update-dashboard.mjs";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force") || dryRun;

const result = await refreshDashboardData({
  dryRun,
  force,
  writeEvenIfCurrent: args.has("--write-current")
});

const { metadata, metrics } = result.data;

console.log(
  JSON.stringify(
    {
      dashboard: metadata.dashboardName,
      date: metadata.lastUpdated,
      dryRun,
      wrote: result.wrote,
      sourceStatus: metadata.sourceStatus,
      openOpportunities: metrics.openOpportunities,
      dueSoon: metrics.dueSoon,
      activeApplications: metrics.activeApplications,
      requestedAmount: metrics.requestedAmount,
      nextUpdate: metadata.nextUpdate
    },
    null,
    2
  )
);
