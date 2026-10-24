import type { Finding, IdentifierType, RedactionResult } from "./types.js";
import type { Span } from "./internal.js";
import { TYPE_RANK } from "./internal.js";

interface Component {
  start: number;
  end: number;
  winner: Span;
}

function better(candidate: Span, current: Span): boolean {
  const rankDelta = TYPE_RANK[candidate.type] - TYPE_RANK[current.type];
  if (rankDelta !== 0) {
    return rankDelta < 0;
  }
  return candidate.end - candidate.start > current.end - current.start;
}

/**
 * Overlapping matches are unioned into one region so that no fragment of an
 * identifier is left behind. The region takes the type of its highest-priority
 * member, with layer 1 types ranking above layer 2 types.
 */
function union(spans: readonly Span[]): Component[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const components: Component[] = [];
  for (const span of sorted) {
    const last = components[components.length - 1];
    if (last !== undefined && span.start < last.end) {
      last.end = Math.max(last.end, span.end);
      if (better(span, last.winner)) {
        last.winner = span;
      }
    } else {
      components.push({ start: span.start, end: span.end, winner: span });
    }
  }
  return components;
}

export function apply(text: string, spans: readonly Span[]): RedactionResult {
  const counters = new Map<IdentifierType, number>();
  const tokens = new Map<string, string>();
  const findings: Finding[] = [];
  let redacted = "";
  let cursor = 0;
  for (const component of union(spans)) {
    const { type, key } = component.winner;
    const identity = `${type}\u0000${key}`;
    let token = tokens.get(identity);
    if (token === undefined) {
      const next = (counters.get(type) ?? 0) + 1;
      counters.set(type, next);
      token = `[[${type}_${String(next)}]]`;
      tokens.set(identity, token);
      findings.push({ token, type });
    }
    redacted += text.slice(cursor, component.start) + token;
    cursor = component.end;
  }
  return { redacted: redacted + text.slice(cursor), findings };
}
