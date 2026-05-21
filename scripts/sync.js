#!/usr/bin/env node
/**
 * Pulls Page Properties status from every OneAccount-* leaf page under the
 * "One Account: Launch Assets" parent and writes status.json at the repo root.
 *
 * Runs in GitHub Actions on a daily cron + on workflow_dispatch.
 *
 * Environment variables required:
 *   ATLASSIAN_EMAIL          — email of the Atlassian account whose API token is used
 *   ATLASSIAN_API_TOKEN      — API token from id.atlassian.com
 *   CONFLUENCE_PARENT_ID     — page ID of "One Account: Launch Assets" (default: 3970269743)
 *   CONFLUENCE_BASE          — Confluence site base URL (default: https://doctolib.atlassian.net)
 */

import { writeFile } from "node:fs/promises";

const EMAIL = required("ATLASSIAN_EMAIL");
const TOKEN = required("ATLASSIAN_API_TOKEN");
const PARENT_ID = process.env.CONFLUENCE_PARENT_ID || "3970269743";
const BASE = process.env.CONFLUENCE_BASE || "https://doctolib.atlassian.net";

const AUTH = "Basic " + Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");

// Status ranking: lower = weaker. Used for weakest-link rollup.
// "Cancelled" short-circuits the rollup (any cancelled language = whole campaign cancelled).
const STATUS_RANK = {
  "Not started": 0,
  "In progress": 1,
  Ready: 2,
  Live: 3,
};

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      Accept: "application/json",
      Authorization: AUTH,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} for ${path}\n${body}`);
  }
  return res.json();
}

/**
 * Returns a flat list of every descendant page under the parent.
 * Uses the v1 REST API because it returns the full tree in one call.
 */
async function fetchAllDescendants() {
  const out = [];
  let start = 0;
  const limit = 100;
  while (true) {
    const data = await api(
      `/wiki/rest/api/content/${PARENT_ID}/descendant/page?limit=${limit}&start=${start}`
    );
    out.push(...data.results);
    if (data.results.length < limit) break;
    start += limit;
  }
  return out;
}

/**
 * Extract status rows from a Page Properties macro.
 * The macro is a bodiedExtension with extensionKey=details. Inside it is a
 * 2-column table where each row is [label, status-lozenge].
 *
 * Returns an array of { label, value } pairs, or [] if no properties found.
 */
function extractStatuses(adfBody) {
  const rows = [];
  const visit = (node) => {
    if (!node) return;
    if (
      node.type === "bodiedExtension" &&
      node.attrs?.extensionKey === "details" &&
      node.attrs?.parameters?.macroParams?.id?.value === "campaign-status"
    ) {
      const table = (node.content || []).find((c) => c.type === "table");
      if (table) {
        for (const row of table.content || []) {
          if (row.type !== "tableRow") continue;
          const cells = (row.content || []).filter(
            (c) => c.type === "tableCell" || c.type === "tableHeader"
          );
          if (cells.length < 2) continue;
          const label = textOf(cells[0]).trim();
          const value = statusOf(cells[1]);
          if (label && value) rows.push({ label, value });
        }
      }
      return; // don't recurse into the macro content further
    }
    if (Array.isArray(node.content)) {
      for (const c of node.content) visit(c);
    }
  };
  visit(adfBody);
  return rows;
}

function textOf(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (Array.isArray(node.content)) return node.content.map(textOf).join("");
  return "";
}

function statusOf(cell) {
  if (!cell || !Array.isArray(cell.content)) return null;
  for (const block of cell.content) {
    if (!Array.isArray(block.content)) continue;
    for (const inline of block.content) {
      if (inline.type === "status") {
        return inline.attrs?.text || null;
      }
    }
  }
  return null;
}

/**
 * Weakest-link rollup across language statuses.
 * - Any "Cancelled" wins (entire campaign reads as cancelled).
 * - Otherwise return the lowest non-cancelled status.
 * - If empty, default to "Not started".
 */
function rollup(statuses) {
  if (!statuses.length) return "Not started";
  if (statuses.some((s) => s.value === "Cancelled")) return "Cancelled";
  let min = null;
  let minRank = Infinity;
  for (const s of statuses) {
    const r = STATUS_RANK[s.value];
    if (r === undefined) continue; // unknown status — skip
    if (r < minRank) {
      minRank = r;
      min = s.value;
    }
  }
  return min ?? "Not started";
}

function keyFromTitle(title) {
  // OneAccount-A-Push-NL          → A-Push-NL
  // OneAccount-B-M1-Push-NL       → B-M1-Push-NL
  // OneAccount-Program-AppStore   → Program-AppStore
  const m = title.match(/^OneAccount-(.+)$/);
  return m ? m[1] : null;
}

async function fetchPageBody(pageId) {
  const data = await api(
    `/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`
  );
  const raw = data.body?.atlas_doc_format?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Fetching descendants of page ${PARENT_ID}…`);
  const all = await fetchAllDescendants();
  const leaves = all.filter((p) => p.title.startsWith("OneAccount-"));
  console.log(`Found ${leaves.length} leaf pages.`);

  const pages = {};
  let done = 0;
  for (const leaf of leaves) {
    const key = keyFromTitle(leaf.title);
    if (!key) continue;
    const body = await fetchPageBody(leaf.id);
    const statuses = body ? extractStatuses(body) : [];
    pages[key] = {
      title: leaf.title,
      pageId: leaf.id,
      url: `${BASE}/wiki/spaces/PTA/pages/${leaf.id}/${encodeURIComponent(
        leaf.title
      )}`,
      statuses,
      rollup: rollup(statuses),
    };
    done++;
    if (done % 10 === 0) console.log(`  …${done}/${leaves.length}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    parentId: PARENT_ID,
    pageCount: Object.keys(pages).length,
    pages,
  };

  await writeFile("status.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote status.json with ${out.pageCount} pages.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
