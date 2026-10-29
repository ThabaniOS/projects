// Deterministic focus ranking from status.json. No model call, so /focus is instant and free;
// the Claude tool get_focus returns the same list for the model to explain.

const DAY = 86400e3;
const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

export function rankFocus(projects, today, limit = 5) {
  const items = [];
  for (const p of projects) {
    if (!["active", "pipeline"].includes(p.status) || !p.open_tasks?.length) continue;
    const daysLeft = p.deadline ? days(today, p.deadline) : null;
    const stale = p.updated ? days(p.updated, today) : 0;
    let score = p.priority * 10 + (p.status === "pipeline" ? 5 : 0);
    const reasons = [`P${p.priority}`];
    if (daysLeft !== null) {
      if (daysLeft < 0) (score -= 15), reasons.push(`overdue by ${-daysLeft}d`);
      else if (daysLeft <= 7) (score -= 10), reasons.push(`due in ${daysLeft}d`);
      else if (daysLeft <= 21) (score -= 5), reasons.push(`due in ${daysLeft}d`);
    }
    if (stale > 14) (score -= 2), reasons.push(`untouched ${stale}d`);
    items.push({
      ticker: p.ticker,
      name: p.name,
      status: p.status,
      priority: p.priority,
      deadline: p.deadline,
      days_left: daysLeft,
      stale_days: stale,
      finish_line: p.finish_line,
      next: p.open_tasks.slice(0, 2),
      reasons,
      score,
    });
  }
  items.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return items.slice(0, limit);
}
