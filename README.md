# Notion Gantt

A live Gantt chart for a Notion task database, with dependency-driven scheduling. Full step-by-step setup is in the **Setup guide** page inside the Notion template.

- `index.html`: the chart page.
- `api/tasks.js`: checks the chart key, reads the Notion database, schedules every task, writes the calculated dates back to Notion, and returns the tasks.
- `api/snapshots.js`: saves and reads weekly snapshots.
- `lib/schedule.js`: the scheduling rules. `lib/spread.js`: the spread calculation. `lib/notion.js`: shared Notion code.
- `vercel.json`: runs the weekly snapshot every Monday at 11:00 UTC (6am Toronto).

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Value |
|---|---|
| `NOTION_TOKEN` | Your Notion connection's API token (starts with `ntn_`) |
| `NOTION_DATABASE` | The link to your task database (a database ID or data source ID also works) |
| `CHART_KEY` | A long random string. Open the chart as `https://<your-app>.vercel.app/?key=<CHART_KEY>` |

The chart refuses to run without all three. After changing any of them, redeploy.

Optional:

| Name | Value |
|---|---|
| `NOTION_SNAPSHOTS` | Link to the Snapshots database, if it isn't found automatically (see below) |
| `CRON_SECRET` | Any random string. Vercel then signs its weekly call with it, so nobody else can trigger a snapshot |

## How dates are worked out

Per task you fill in **Optimistic Days**, **Conservative Days** (working days, Mon–Fri), **Blocked by**, and optionally **Earliest Start**.

- A task starts on the first working day after all its **Blocked by** tasks finish, never before its **Earliest Start**.
- Tasks with no blockers need an **Earliest Start**.
- Optimistic and conservative schedules are worked out separately, so delays carry down the chain.
- **Done** tasks have no remaining risk: their conservative dates equal their optimistic dates.
- **Actual Start Date** / **Actual End Date** replace the planned dates when filled in.
- **Status** follows the actual dates: an Actual End Date sets it to Done, and an Actual Start Date on its own sets it to In progress (At risk is kept). With neither date, Status is left as you set it.

In the chart, green is the optimistic plan and yellow runs on from it to the conservative finish.

The chart writes **Optimistic Start/End** and **Conservative Start/End** back to Notion when it loads (needs **Update content** on the Notion connection).

## Snapshots and spread

**Spread** is the number of working days between the optimistic finish and the conservative finish. The panel above the chart shows it for the whole project and for each phase, with a little history line, so you can see whether uncertainty is shrinking as work gets done.

- Every Monday the app saves a snapshot into a **Snapshots** database. **Save snapshot** saves one now; saving again in the same week replaces that week's snapshot.
- **Compare with…** picks a past week. Each bar then gets a thin line underneath showing that task as it was planned that week.
- The app finds the Snapshots database if it is on the same Notion page as the task database, or if its description contains the task database's ID. Otherwise set `NOTION_SNAPSHOTS`.
- Saving snapshots needs **Insert content** on the Notion connection (as well as Read and Update).
- History starts with the first snapshot; Notion doesn't let apps read older versions.
