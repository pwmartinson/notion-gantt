// Works out every task's optimistic and conservative dates from its durations and dependencies.
//
// Inputs per task:
//   id, earliestStart (YYYY-MM-DD or null), bestDays, consDays (working days),
//   blockedBy (array of task ids), actualStart, actualEnd (YYYY-MM-DD or null)
//
// Rules:
//   - A task starts on the first working day after ALL of its blockers have finished,
//     but never before its Earliest Start (if one is set).
//   - A task with no blockers and no Earliest Start falls back to the project's first date, and is flagged.
//   - It then runs for its duration in working days (Mon–Fri). The optimistic and conservative
//     schedules are worked out separately, so delays carry down the whole chain.
//   - Actual Start / Actual End, when filled in, replace the planned dates in both schedules.
//   - A task marked done (t.done) has no remaining risk, so its conservative dates equal its optimistic dates.

const DAY = 86400000;
const toMs = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const toStr = ms => new Date(ms).toISOString().slice(0, 10);
const isWeekend = ms => { const w = new Date(ms).getUTCDay(); return w === 0 || w === 6; };
const onOrAfterWorkday = ms => { while (isWeekend(ms)) ms += DAY; return ms; };
const addWorkdays = (start, n) => {          // end date of an n-working-day task starting on `start`
  let ms = onOrAfterWorkday(start), left = Math.max(1, Math.round(n || 1)) - 1;
  while (left > 0) { ms += DAY; if (!isWeekend(ms)) left--; }
  return ms;
};

export function schedule(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const starts = tasks.map(t => t.earliestStart || t.actualStart).filter(Boolean).map(toMs);
  const anchor = onOrAfterWorkday(starts.length ? Math.min(...starts) : Date.now() - (Date.now() % DAY));
  const out = new Map();
  const visiting = new Set();

  function solve(id) {
    if (out.has(id)) return out.get(id);
    const t = byId.get(id);
    if (visiting.has(id)) return null;                 // dependency loop: break it here
    visiting.add(id);
    const issues = [];
    const blockers = (t.blockedBy || []).filter(b => byId.has(b)).map(b => {
      const r = solve(b);
      if (!r) issues.push("Dependency loop");
      return r;
    }).filter(Boolean);

    const bestDays = t.bestDays > 0 ? t.bestDays : 1;
    let consDays = t.consDays > 0 ? t.consDays : bestDays;
    if (!(t.bestDays > 0)) issues.push("No Optimistic Days (assumed 1)");
    if (consDays < bestDays) { issues.push("Conservative Days is less than Optimistic Days"); consDays = bestDays; }

    const plan = (endKey, days) => {
      const depEnd = blockers.length ? Math.max(...blockers.map(r => toMs(r[endKey]))) : null;
      let start = depEnd != null ? onOrAfterWorkday(depEnd + DAY) : null;
      if (t.earliestStart) start = Math.max(start ?? 0, onOrAfterWorkday(toMs(t.earliestStart)));
      if (start == null) { start = anchor; if (endKey === "bestEnd") issues.push("No Earliest Start or dependencies"); }
      if (t.actualStart) start = toMs(t.actualStart);
      const end = t.actualEnd ? toMs(t.actualEnd) : addWorkdays(start, days);
      return [toStr(start), toStr(Math.max(end, start))];
    };
    const [bestStart, bestEnd] = plan("bestEnd", bestDays);
    const [consStart, consEnd] = t.done ? [bestStart, bestEnd] : plan("consEnd", consDays);
    const r = { bestStart, bestEnd, consStart, consEnd, issues: [...new Set(issues)] };
    visiting.delete(id);
    out.set(id, r);
    return r;
  }

  tasks.forEach(t => solve(t.id));
  return out;
}
