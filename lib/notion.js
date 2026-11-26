// Shared Notion helpers: settings, reading the task database, and writing calculated values back.

import { timingSafeEqual } from "node:crypto";
import { schedule } from "./schedule.js";

export const NOTION_VERSION = "2026-03-11";
export const API = "https://api.notion.com/v1";

// Calculated date columns in Notion → field names in the schedule result.
// Each lists its current name first, then older names still accepted.
const OUTPUTS = {
  bestStart: ["Optimistic Start", "Best-case Start"],
  bestEnd: ["Optimistic End", "Best-case End"],
  consStart: ["Conservative Start"],
  consEnd: ["Conservative End"],
};

// Reads the environment variables. Returns { error } if something is missing.
export function settings() {
  const token = process.env.NOTION_TOKEN;
  const database = process.env.NOTION_DATABASE || process.env.NOTION_DATA_SOURCE_ID;
  const chartKey = process.env.CHART_KEY;
  const missing = [!token && "NOTION_TOKEN", !database && "NOTION_DATABASE", !chartKey && "CHART_KEY"].filter(Boolean);
  if (missing.length) return { error: `Setup incomplete: add ${missing.join(", ")} in Vercel → Settings → Environment Variables, then redeploy.` };
  return {
    database, chartKey,
    snapshots: process.env.NOTION_SNAPSHOTS || "",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
  };
}

// Constant-time comparison, so the key can't be guessed one character at a time.
export function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function friendly(e) {
  if (e.code === "object_not_found")
    return "Notion can't find that database. Check NOTION_DATABASE, and make sure the database is shared with your Notion connection (••• menu → Connections).";
  if (e.code === "unauthorized")
    return "Notion rejected the NOTION_TOKEN. Copy the API token from your Notion connection again and update it in Vercel.";
  if (e.code === "restricted_resource")
    return "The Notion connection doesn't have permission for this. In Notion → Settings → Connections → your connection, turn on Read, Update and Insert content.";
  return e.message || "Notion API error";
}

export class NotionError extends Error {
  constructor(status, body) { super(friendly(body || {})); this.status = status; this.code = body?.code; }
}

export async function notion(path, headers, { method = "GET", body } = {}) {
  const r = await fetch(`${API}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new NotionError(r.status, data);
  return data;
}

const plain = rt => (rt || []).map(t => t.plain_text).join("");
const lastId = value => {
  const ids = String(value).trim().split(/[?#]/)[0].replace(/-/g, "").match(/[0-9a-f]{32}/gi);
  if (!ids) throw new Error("That doesn't look like a Notion database link or ID.");
  return ids[ids.length - 1];
};

// Follows a parent pointer up through blocks (e.g. a database inside a column) to the page it's on.
async function pageOf(parent, headers) {
  for (let i = 0; parent && i < 6; i++) {
    if (parent.type === "page_id") return parent.page_id.replace(/-/g, "");
    if (parent.type !== "block_id") return null;
    const b = await notion(`/blocks/${parent.block_id}`, headers).catch(() => null);
    parent = b?.parent;
  }
  return null;
}

// A database link, database ID or data source ID → { sourceId, parentPageId }.
const resolved = new Map();
export async function resolveDataSource(value, headers) {
  if (resolved.has(value)) return resolved.get(value);
  const id = lastId(value);
  let sourceId = id, db = await notion(`/databases/${id}`, headers).catch(() => null);
  if (db?.data_sources?.length) sourceId = db.data_sources[0].id;
  else {
    const ds = await notion(`/data_sources/${id}`, headers).catch(() => null);
    if (ds?.parent?.database_id) db = await notion(`/databases/${ds.parent.database_id}`, headers).catch(() => null);
  }
  const out = { sourceId, parentPageId: db ? await pageOf(db.parent, headers) : null };
  resolved.set(value, out);
  return out;
}

// Finds the project's Snapshots database: NOTION_SNAPSHOTS if set, otherwise a database
// called "Snapshots" on the same Notion page as the task database.
export async function findSnapshots(cfg, project) {
  if (cfg.snapshots) return (await resolveDataSource(cfg.snapshots, cfg.headers)).sourceId;
  if (!project.parentPageId) return null;
  const found = await notion("/search", cfg.headers, {
    method: "POST", body: { query: "Snapshots", filter: { property: "object", value: "data_source" }, page_size: 50 },
  }).catch(() => ({ results: [] }));
  for (const ds of found.results || []) {
    if (plain(ds.title).trim().toLowerCase() !== "snapshots") continue;
    const dbId = ds.parent?.database_id;
    const db = dbId ? await notion(`/databases/${dbId}`, cfg.headers).catch(() => null) : null;
    if (db && (await pageOf(db.parent, cfg.headers)) === project.parentPageId) return ds.id;
  }
  return null;
}

// Reads every task, works out the schedule, and (optionally) writes changes back to Notion.
export async function loadProject(cfg, { write = true } = {}) {
  const { sourceId, parentPageId } = await resolveDataSource(cfg.database, cfg.headers);

  const pages = [];
  let cursor;
  do {
    const data = await notion(`/data_sources/${sourceId}/query`, cfg.headers, {
      method: "POST", body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
    });
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // Phase order = the order of the Phase options in Notion (drag them in the property settings to reorder).
  let phaseOrder = [], title = "", icon = "";
  const schema = await notion(`/data_sources/${sourceId}`, cfg.headers).catch(() => null);
  if (schema) {
    const ph = schema.properties?.["Phase"];
    phaseOrder = (ph?.select?.options || ph?.status?.options || []).map(o => o.name);
    title = plain(schema.title);
    icon = schema.icon?.type === "emoji" ? schema.icon.emoji : "";
  }

  const tasks = pages.map(toTask);
  const plan = schedule(tasks);
  for (const t of tasks) Object.assign(t, plan.get(t.id));
  const sync = write ? await writeBack(tasks, cfg.headers) : null;
  return { tasks, phaseOrder, title, icon, sync, parentPageId };
}

async function writeBack(tasks, headers) {
  const statusChanged = t => t.statusType && t.status !== t.storedStatus;
  const changed = tasks.filter(t => statusChanged(t) || Object.keys(OUTPUTS).some(k => t.stored[k] !== t[k]));
  let updated = 0;
  for (const t of changed) {
    const properties = {};
    for (const k of Object.keys(OUTPUTS)) properties[t.columns[k]] = { date: t[k] ? { start: t[k] } : null };
    if (statusChanged(t)) properties["Status"] = { [t.statusType]: { name: t.status } };
    const r = await fetch(`${API}/pages/${t.id}`, { method: "PATCH", headers, body: JSON.stringify({ properties }) });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      const readOnly = r.status === 403 || e.code === "restricted_resource";
      return {
        ok: false, updated, pending: changed.length - updated,
        message: readOnly
          ? "Notion not updated: the Notion connection is read-only. Turn on \"Update content\" for it."
          : `Notion not updated: ${e.message || r.statusText}`,
      };
    }
    updated++;
    await new Promise(r => setTimeout(r, 350)); // stay under Notion's ~3 requests/second limit
  }
  return { ok: true, updated, pending: 0 };
}

// ---- helpers: pull plain values out of Notion's property format ----
const text = p => plain(p?.title || p?.rich_text);
const date = p => {
  const d = p?.date ?? p?.formula?.date;
  return d?.start ? d.start.slice(0, 10) : null;
};
const sel  = p => p?.select?.name ?? p?.status?.name ?? null;
const num  = p => (typeof p?.number === "number" ? p.number : null);
const rel  = p => (p?.relation || []).map(r => r.id);
const col  = (p, names) => names.find(n => n in p) || names[0];   // the column name this database uses

// Status follows the actual dates: an Actual End Date means Done; an Actual Start Date
// without an end means In progress ("At risk" is kept). With neither, Status is left as set by hand.
function statusFromActuals(current, actualStart, actualEnd) {
  if (actualEnd) return "Done";
  if (actualStart) return current === "At risk" ? current : "In progress";
  return current;
}

function toTask(page) {
  const p = page.properties;
  const storedStatus = sel(p["Status"]);
  const actualStart = date(p["Actual Start Date"]);
  const actualEnd = date(p["Actual End Date"]);
  const status = statusFromActuals(storedStatus, actualStart, actualEnd);
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
    bestDays: num(p[col(p, ["Optimistic Days", "Best-case Days"])]),
    consDays: num(p["Conservative Days"]),
    blockedBy: rel(p["Blocked by"]),
    actualStart,
    actualEnd,
    statusType: p["Status"]?.type || null,   // "status" or "select"
    storedStatus,
    columns: Object.fromEntries(Object.entries(OUTPUTS).map(([k, names]) => [k, col(p, names)])),
    stored: Object.fromEntries(Object.entries(OUTPUTS).map(([k, names]) => [k, date(p[col(p, names)])])),
  };
}
