// Spread = how many working days separate the optimistic finish from the conservative finish.
// A shrinking spread means uncertainty is coming down; a growing one means it's going up.

const DAY = 86400000;
const toMs = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

export function workdaysBetween(a, b) {          // working days after `a`, up to and including `b`
  let n = 0;
  for (let t = toMs(a) + DAY, end = toMs(b); t <= end; t += DAY) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

function summarise(name, tasks) {
  const ends = tasks.filter(t => t.bestEnd && t.consEnd);
  if (!ends.length) return null;
  const b = ends.map(t => t.bestEnd).sort().at(-1);
  const ce = ends.map(t => t.consEnd).sort().at(-1);
  return { name, b, ce, spread: ce > b ? workdaysBetween(b, ce) : 0,
           done: tasks.filter(t => t.status === "Done").length, total: tasks.length };
}

// { overall: {...}, phases: [{ name, b, ce, spread, done, total }] } in phase order.
export function spreads(tasks, phaseOrder = []) {
  const phaseOf = t => t.phase || "No phase";
  const names = [...new Set(tasks.map(phaseOf))]
    .sort((a, b) => (phaseOrder.indexOf(a) + 1 || 99) - (phaseOrder.indexOf(b) + 1 || 99) || a.localeCompare(b));
  return {
    overall: summarise("Whole project", tasks),
    phases: names.map(n => summarise(n, tasks.filter(t => phaseOf(t) === n))).filter(Boolean),
  };
}
