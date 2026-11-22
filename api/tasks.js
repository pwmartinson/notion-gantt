// Reads the Notion task database, works out the schedule from durations + dependencies,
// writes any changed calculated dates back to Notion, and returns the tasks to the chart.
// Your Notion secret stays here on the server; the browser never sees it.

import { schedule } from "../lib/schedule.js";

const NOTION_VERSION = "2026-03-11";
const API = "https://api.notion.com/v1";

// Calculated date columns in Notion → field names in the schedule result.
const OUTPUTS = {
  "Best-case Start": "bestStart",
  "Best-case End": "bestEnd",
  "Conservative Start": "consStart",
  "Conservative End": "consEnd",
};

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;
  if (!token || !dataSourceId) {
    return res.status(500).json({ error: "Missing NOTION_TOKEN or NOTION_DATA_SOURCE_ID environment variable in Vercel." });
  }
  const headers = { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" };

  try {
    // 1. Read every task
    const pages = [];
    let cursor;
    do {
      const r = await fetch(`${API}/data_sources/${dataSourceId}/query`, {
        method: "POST", headers,
        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || "Notion API error", code: data.code });
      pages.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    // 2. Work out the schedule
    const tasks = pages.map(toTask);
    const plan = schedule(tasks);
    for (const t of tasks) Object.assign(t, plan.get(t.id));

    // 3. Write changed dates back to Notion (needs "Update content" on the connection)
    const sync = await writeBack(tasks, headers);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ tasks, sync, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}

async function writeBack(tasks, headers) {
  const changed = tasks.filter(t => Object.entries(OUTPUTS).some(([, k]) => t.stored[k] !== t[k]));
  let updated = 0;
  for (const t of changed) {
    const properties = {};
    for (const [col, k] of Object.entries(OUTPUTS)) properties[col] = { date: t[k] ? { start: t[k] } : null };
    const r = await fetch(`${API}/pages/${t.id}`, { method: "PATCH", headers, body: JSON.stringify({ properties }) });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      const readOnly = r.status === 403 || e.code === "restricted_resource";
      return {
        ok: false, updated, pending: changed.length - updated,
        message: readOnly
          ? "Notion dates not updated: the Notion connection is read-only. Turn on \"Update content\" for it."
          : `Notion dates not updated: ${e.message || r.statusText}`,
      };
    }
    updated++;
    await new Promise(r => setTimeout(r, 350)); // stay under Notion's ~3 requests/second limit
  }
  return { ok: true, updated, pending: 0 };
}

// ---- helpers: pull plain values out of Notion's property format ----
const text = p => (p?.title || p?.rich_text || []).map(t => t.plain_text).join("");
const date = p => {
  const d = p?.date ?? p?.formula?.date;
  return d?.start ? d.start.slice(0, 10) : null;
};
const sel  = p => p?.select?.name ?? p?.status?.name ?? null;
const num  = p => (typeof p?.number === "number" ? p.number : null);
const rel  = p => (p?.relation || []).map(r => r.id);

function toTask(page) {
  const p = page.properties;
  const status = sel(p["Status"]);
  return {
    id: page.id,
    url: page.url,
    name: text(p["Task"]),
    phase: sel(p["Phase"]),
    status,
    done: status === "Done",
    owner: text(p["Owner"]),
    progress: num(p["Progress"]),
    earliestStart: date(p["Earliest Start"]),
    bestDays: num(p["Best-case Days"]),
    consDays: num(p["Conservative Days"]),
    blockedBy: rel(p["Blocked by"]),
    actualStart: date(p["Actual Start Date"]),
    actualEnd: date(p["Actual End Date"]),
    stored: Object.fromEntries(Object.entries(OUTPUTS).map(([col, k]) => [k, date(p[col])])),
  };
}
