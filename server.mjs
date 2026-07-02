import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { applicationFileName, generateApplicationMarkdown } from "./application-generator.js";
import { buildDashboardSnapshot, readDashboardData, refreshDashboardData } from "./lib/update-dashboard.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

await refreshDashboardData({ writeEvenIfCurrent: true });

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname === "/api/health") {
      return sendJson(response, { ok: true, service: "emmanuel-grant-dashboard" });
    }

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      const dashboard = await getFreshDashboard();
      return sendJson(response, dashboard);
    }

    const applicationDownloadMatch = url.pathname.match(/^\/api\/applications\/([^/]+)\/download$/);
    if (applicationDownloadMatch && request.method === "GET") {
      const dashboard = await getFreshDashboard();
      const profile = await readProfileData();
      const opportunity = dashboard.opportunities?.find((item) => item.id === applicationDownloadMatch[1]);
      if (!opportunity) {
        return sendJson(response, { ok: false, error: "Opportunity not found" }, 404);
      }

      return sendTextAttachment(
        response,
        generateApplicationMarkdown(opportunity, profile),
        applicationFileName(opportunity)
      );
    }

    if (url.pathname === "/api/refresh" && request.method === "POST") {
      const result = await refreshDashboardData({ force: true, writeEvenIfCurrent: true });
      return sendJson(response, {
        ok: true,
        wrote: result.wrote,
        dashboard: result.data
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return sendJson(response, { ok: false, error: "Not found" }, 404);
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    return sendJson(response, { ok: false, error: error.message }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`Emmanuel Grant Dashboard running at http://${host}:${port}`);
});

setInterval(() => {
  refreshDashboardData({ writeEvenIfCurrent: false }).catch((error) => {
    console.error(`Daily refresh failed: ${error.message}`);
  });
}, 60 * 60 * 1000);

async function getFreshDashboard() {
  const data = await readDashboardData();
  const snapshot = buildDashboardSnapshot(data);

  if (data.metadata?.lastUpdated !== snapshot.metadata.lastUpdated) {
    const result = await refreshDashboardData({ writeEvenIfCurrent: true });
    return result.data;
  }

  return snapshot;
}

async function readProfileData() {
  try {
    const raw = await readFile(join(root, "data", "emmanuel-profile.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function serveStatic(pathname, response) {
  const requestPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendTextAttachment(response, body, filename, status = 200) {
  response.writeHead(status, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store"
  });
  response.end(body);
}
