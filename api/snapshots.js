// Weekly snapshots of the chart, kept in a "Snapshots" database next to the task database.
//
//   GET  /api/snapshots            → list of snapshots with their spreads (newest first)
//   GET  /api/snapshots?id=…       → one snapshot's full task list, to draw under today's chart
//   POST /api/snapshots            → save a snapshot now (replaces this week's, if there is one)
//   GET  /api/snapshots?cron=1     → called by Vercel every Monday (see vercel.json)

import { settings, sameSecret, loadProject, findSnapshots, resolveDataSource, notion } from "../lib/notion.js";
import { spreads } from "../lib/spread.js";

const DAY = 86400000;
const chunks = (s, n = 2000) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, "g")) || [""];
const rich = s => chunks(s).slice(0, 100).map(c => ({ type: "text", text: { content: c } }));
const plain = rt => (rt || []).map(t => t.plain_text).join("");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const cfg = settings();
  if (cfg.error) return res.status(500).json({ error: cfg.error });

  const isCron = req.query.cron !== undefined;
  if (isCron) {
    // Vercel signs its scheduled calls with CRON_SECRET when that variable is set.
    const secret = process.env.CRON_SECRET;
    const ok = secret ? sameSecret(req.headers.authorization || "", `Bearer ${secret}`)
                      : /vercel-cron/i.test(req.headers["user-agent"] || "");
    if (!ok) return res.status(401).json({ error: "Not authorised." });
  } else if (!sameSecret(req.headers["x-chart-key"] || "", cfg.chartKey)) {
    return res.status(401).json({ error: "Not authorised. Open the chart using its full link, including the ?key=… part.", code: "bad_key" });
  }

  try {
    const project = await resolveDataSource(cfg.database, cfg.headers);
    const source = await findSnapshots(cfg, project);
    if (!source) {
      return res.status(200).json({
        available: false, snapshots: [],
        message: "No Snapshots database found. Add a database called \"Snapshots\" on the same Notion page as your tasks (see the setup guide).",
      });
    }

    if (isCron || req.method === "POST") return res.status(200).json({ available: true, saved: await save(cfg, source) });
    if (req.query.id) return res.status(200).json(await getOne(cfg, source, String(req.query.id)));
    return res.status(200).json({ available: true, snapshots: await list(cfg, source) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || String(err), code: err.code });
  }
}

async function list(cfg, source) {
  const out = [];
  let cursor;
  do {
    const data = await notion(`/data_sources/${source}/query`, cfg.headers, {
      method: "POST",
      body: { page_size: 100, sorts: [{ property: "Week", direction: "descending" }], ...(cursor ? { start_cursor: cursor } : {}) },
    });
    for (const pg of data.results) {
      const p = pg.properties, d = k => p[k]?.date?.start?.slice(0, 10) || null;
      let phases = [];
      try { phases = JSON.parse(plain(p["Phase Spreads"]?.rich_text) || "[]").map(([name, spread, b, ce, done, total]) => ({ name, spread, b, ce, done, total })); } catch {}
      if (!d("Week")) continue;
      out.push({
        id: pg.id, week: d("Week"), taken: p["Taken"]?.date?.start || null,
        overall: { spread: p["Spread"]?.number ?? null, b: d("Optimistic Finish"), ce: d("Conservative Finish"),
                   done: p["Done"]?.number ?? null, total: p["Tasks"]?.number ?? null },
        phases,
      });
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function getOne(cfg, source, id) {
  const page = await notion(`/pages/${id}`, cfg.headers);
  if ((page.parent?.data_source_id || "").replace(/-/g, "") !== source.replace(/-/g, "")) {
    const e = new Error("That isn't one of this chart's snapshots."); e.status = 404; throw e;
  }
  let json = "", cursor;
  do {
    const data = await notion(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`, cfg.headers);
    for (const b of data.results) if (b.type === "code") json += plain(b.code.rich_text);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  const snap = JSON.parse(json || "{}");
  return { id, week: page.properties?.["Week"]?.date?.start?.slice(0, 10), ...snap };
}

async function save(cfg, source) {
  const p = await loadProject(cfg, { write: false });
  const sp = spreads(p.tasks, p.phaseOrder);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const week = new Date(today - ((new Date(today).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
  const label = new Date(week + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  // One snapshot per week: move this week's earlier snapshot (if any) to Notion's trash.
  const existing = await notion(`/data_sources/${source}/query`, cfg.headers, {
    method: "POST", body: { filter: { property: "Week", date: { equals: week } }, page_size: 10 },
  });
  for (const old of existing.results) await notion(`/pages/${old.id}`, cfg.headers, { method: "PATCH", body: { in_trash: true } });

  const body = JSON.stringify({
    takenAt: now.toISOString(), phaseOrder: p.phaseOrder,
    tasks: p.tasks.filter(t => t.bestStart).map(t => ({
      id: t.id, name: t.name, phase: t.phase, status: t.status,
      bestStart: t.bestStart, bestEnd: t.bestEnd, consStart: t.consStart, consEnd: t.consEnd,
    })),
  });
  const o = sp.overall || {};
  const dateProp = v => ({ date: v ? { start: v } : null });
  const page = await notion("/pages", cfg.headers, {
    method: "POST",
    body: {
      parent: { type: "data_source_id", data_source_id: source },
      properties: {
        "Snapshot": { title: [{ type: "text", text: { content: `Week of ${label}` } }] },
        "Week": dateProp(week),
        "Taken": { date: { start: now.toISOString() } },
        "Optimistic Finish": dateProp(o.b),
        "Conservative Finish": dateProp(o.ce),
        "Spread": { number: o.spread ?? null },
        "Done": { number: o.done ?? null },
        "Tasks": { number: o.total ?? null },
        "Phase Spreads": { rich_text: rich(JSON.stringify(sp.phases.map(x => [x.name, x.spread, x.b, x.ce, x.done, x.total]))) },
      },
      children: [
        { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "Saved by the Gantt chart app. The block below is the chart's data for this week — please don't edit it." } }] } },
        { type: "code", code: { language: "json", rich_text: rich(body) } },
      ],
    },
  });
  return { id: page.id, week };
}
