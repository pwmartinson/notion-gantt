// Reads the Notion task database and returns a simplified list of tasks.
// Your Notion secret stays here on the server; the browser never sees it.

const NOTION_VERSION = "2026-03-11";

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;
  if (!token || !dataSourceId) {
    return res.status(500).json({ error: "Missing NOTION_TOKEN or NOTION_DATA_SOURCE_ID environment variable in Vercel." });
  }

  try {
    const pages = [];
    let cursor;
    do {
      const r = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      });
      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json({ error: data.message || "Notion API error", code: data.code });
      }
      pages.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const tasks = pages.map(toTask).filter(t => t.start);
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
    return res.status(200).json({ tasks, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}

// ---- helpers: pull plain values out of Notion's property format ----
const text = p => (p?.title || p?.rich_text || []).map(t => t.plain_text).join("");
const date = p => (p?.date?.start ? p.date.start.slice(0, 10) : null);
const sel  = p => p?.select?.name ?? p?.status?.name ?? null;
const num  = p => (typeof p?.number === "number" ? p.number : null);

function toTask(page) {
  const p = page.properties;
  return {
    id: page.id,
    url: page.url,
    name: text(p["Task"]),
    phase: sel(p["Phase"]),
    status: sel(p["Status"]),
    owner: text(p["Owner"]),
    progress: num(p["Progress"]),
    start: date(p["Start"]),
    bestEnd: date(p["Best-case End"]),
    consStart: date(p["Conservative Start Date"]),
    consEnd: date(p["Conservative End"]),
    actualStart: date(p["Actual Start Date"]),
    actualEnd: date(p["Actual End Date"]),
  };
}
