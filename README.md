# Notion Gantt

A live Gantt chart for the "Sample Product Launch Gantt" Notion database.

- `index.html`: the chart page. It loads the tasks from `/api/tasks` each time it opens.
- `api/tasks.js`: a Vercel serverless function that reads the Notion database with your secret key and returns the tasks.

## Environment variables (set in Vercel → Project → Settings → Environment Variables)

| Name | Value |
|---|---|
| `NOTION_TOKEN` | Your Notion integration's secret (starts with `ntn_`) |
| `NOTION_DATA_SOURCE_ID` | `653bdf41-3084-468b-aa6a-83ef7ebf319f` |

## Columns the chart reads

Task, Phase, Status, Owner, Progress, Start, Best-case End, Conservative Start Date, Conservative End, Actual Start Date, Actual End Date.
If you rename one in Notion, update the matching name in `toTask()` in `api/tasks.js`.

## Colors

- Green: Start → Best-case End
- Yellow: Best-case End → Conservative End
- Purple: the whole bar, once Status is "Done"
- Diamond: a task that starts and ends on the same day
