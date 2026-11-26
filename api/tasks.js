// Reads the Notion task database, works out the schedule from durations + dependencies,
// writes any changed calculated values back to Notion, and returns the tasks to the chart.
// Your Notion secret stays here on the server; the browser never sees it.

import { settings, sameSecret, loadProject } from "../lib/notion.js";
import { spreads } from "../lib/spread.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const cfg = settings();
  if (cfg.error) return res.status(500).json({ error: cfg.error });

  // Only answer requests that carry the right chart key (sent by the page from the ?key=… part of its link).
  if (!sameSecret(req.headers["x-chart-key"] || "", cfg.chartKey)) {
    return res.status(401).json({ error: "Not authorised. Open the chart using its full link, including the ?key=… part.", code: "bad_key" });
  }

  try {
    const p = await loadProject(cfg);
    return res.status(200).json({
      tasks: p.tasks, phaseOrder: p.phaseOrder, title: p.title, icon: p.icon, sync: p.sync,
      spreads: spreads(p.tasks, p.phaseOrder), fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || String(err), code: err.code });
  }
}
