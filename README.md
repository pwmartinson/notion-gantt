# Notion Gantt

A live Gantt chart for a Notion task database, with dependency-driven scheduling. Full step-by-step setup is in the **Setup guide** page inside the Notion template.

- `index.html`: the chart page.
- `api/tasks.js`: checks the chart key, reads the Notion database, schedules every task, writes the calculated dates back to Notion, and returns the tasks.
- `lib/schedule.js`: the scheduling rules.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Value |
|---|---|
| `NOTION_TOKEN` | Your Notion connection's API token (starts with `ntn_`) |
| `NOTION_DATABASE` | The link to your task database (a database ID or data source ID also works) |
| `CHART_KEY` | A long random string. Open the chart as `https://<your-app>.vercel.app/?key=<CHART_KEY>` |

The chart refuses to run without all three. After changing any of them, redeploy.

## How dates are worked out

Per task you fill in **Best-case Days**, **Conservative Days** (working days, Mon–Fri), **Blocked by**, and optionally **Earliest Start**.

- A task starts on the first working day after all its **Blocked by** tasks finish, never before its **Earliest Start**.
- Tasks with no blockers need an **Earliest Start**.
- Best-case and conservative schedules are worked out separately, so delays carry down the chain.
- **Done** tasks have no remaining risk: their conservative dates equal their best-case dates.
- **Actual Start Date** / **Actual End Date** replace the planned dates when filled in.

The chart writes **Best-case Start/End** and **Conservative Start/End** back to Notion when it loads (needs **Update content** on the Notion connection).
