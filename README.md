# Notion Gantt

A live Gantt chart for the "Sample Product Launch Gantt" Notion database, with dependency-driven scheduling.

- `index.html`: the chart page.
- `api/tasks.js`: reads the Notion database, schedules every task, writes the calculated dates back to Notion, and returns the tasks.
- `lib/schedule.js`: the scheduling rules.

## How dates are worked out

You fill in (per task): **Best-case Days**, **Conservative Days** (working days, Mon–Fri), **Blocked by**, and optionally **Earliest Start**.

- A task starts on the first working day after all its **Blocked by** tasks finish. It never starts before its **Earliest Start**, if one is set.
- Tasks with no blockers need an **Earliest Start**.
- Best-case and conservative schedules are worked out separately, so delays carry down the chain.
- **Done** tasks have no remaining risk: their conservative dates equal their best-case dates.
- **Actual Start Date** / **Actual End Date**, when filled in, replace the planned dates.

The chart writes **Best-case Start/End** and **Conservative Start/End** back to Notion whenever it loads. Don't edit those by hand. This needs the Notion connection to have **Update content** turned on.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Value |
|---|---|
| `NOTION_TOKEN` | Your Notion connection's API token (starts with `ntn_`) |
| `NOTION_DATA_SOURCE_ID` | `653bdf41-3084-468b-aa6a-83ef7ebf319f` |
