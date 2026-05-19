import fs from 'node:fs';
import path from 'node:path';
import type { NotionLearningItem, ResearchResult } from './types.js';
import { learningRepoRoot } from './config.js';

const SRC_SCAN_ROOTS = ['src', 'docs', 'Product Requirement Document'];
const MAX_HITS = 8;
const MAX_FILES_SCANNED = 120;

function tokenize(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s/_-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  )].slice(0, 12);
}

function walkFiles(dir: string, acc: string[], limit: number): void {
  if (acc.length >= limit || !fs.existsSync(dir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (acc.length >= limit) break;
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(full, acc, limit);
    } else if (/\.(ts|tsx|js|md|sql|prisma)$/i.test(ent.name)) {
      acc.push(full);
    }
  }
}

function searchCodebase(keywords: string[], root: string): ResearchResult['codebaseHits'] {
  const hits: ResearchResult['codebaseHits'] = [];
  const files: string[] = [];
  for (const sub of SRC_SCAN_ROOTS) {
    walkFiles(path.join(root, sub), files, MAX_FILES_SCANNED);
  }

  for (const file of files) {
    if (hits.length >= MAX_HITS) break;
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lower = content.toLowerCase();
    const matched = keywords.filter((k) => lower.includes(k));
    if (matched.length === 0) continue;
    const idx = lower.indexOf(matched[0]);
    const line = content.slice(0, idx).split('\n').length;
    const snippet = content
      .split('\n')
      .slice(Math.max(0, line - 2), line + 1)
      .join(' ')
      .slice(0, 160);
    hits.push({
      path: path.relative(root, file),
      line,
      snippet,
    });
  }
  return hits;
}

export function researchItem(item: NotionLearningItem): ResearchResult {
  const keywords = tokenize(`${item.title} ${item.description} ${item.phase}`);
  const root = learningRepoRoot();
  const codebaseHits = searchCodebase(keywords, root);

  const summary =
    `Researched "${item.title}" (${item.priority}, ${item.status}). ` +
    `Keywords: ${keywords.slice(0, 6).join(', ') || 'n/a'}. ` +
    `Codebase hits: ${codebaseHits.length}. ` +
    (item.description
      ? `Context: ${item.description.slice(0, 200)}`
      : 'No extended description in Notion.');

  return { keywords, codebaseHits, summary };
}
