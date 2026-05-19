export function isLearningLoopEnabled(): boolean {
  const v = (process.env.LEARNING_LOOP_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function learningFeasibilityMin(): number {
  const n = parseInt(process.env.LEARNING_FEASIBILITY_MIN ?? '65', 10);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 65;
}

export function learningMaxImplementPerCycle(): number {
  const n = parseInt(process.env.LEARNING_MAX_IMPLEMENT_PER_CYCLE ?? '3', 10);
  return Number.isFinite(n) ? Math.max(0, n) : 3;
}

export function learningCronExpression(): string {
  return (process.env.LEARNING_CRON || '0 6 * * *').trim();
}

export function notionStatusesToPull(): string[] {
  const raw =
    process.env.LEARNING_NOTION_STATUS_RESEARCH ||
    'Backlog,Ready for research,Not Started';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function learningRepoRoot(): string {
  return process.env.LEARNING_REPO_ROOT || process.cwd();
}
