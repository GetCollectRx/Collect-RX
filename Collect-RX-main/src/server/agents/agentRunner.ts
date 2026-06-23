/**
 * AgentRunner — Core LLM execution layer for CollectRx's 29-agent system.
 *
 * Each agent is defined by a .md file in $AGENTS_DIR (defaults to
 * ./agents relative to process.cwd() — bundled inside Collect-RX-main/agents/).
 * The .md becomes the system
 * prompt. The runner injects context data, calls Gemini, parses structured
 * JSON output, and routes actions to Notion / audit log / incident system.
 *
 * Model: gemini-2.0-flash (same as marketing + learning modules).
 * Key: GEMINI_API_KEY (already required by those modules).
 */

import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { appendAuditLog } from '../audit/auditLog.js';

// ── Path resolution ───────────────────────────────────────────────────────────
// agents/ is bundled inside Collect-RX-main/ (copied at repo level, included in Docker image).
// Railway: AGENTS_DIR=/app/agents (set in env vars).
// Local dev: defaults to ./agents relative to Collect-RX-main cwd.
function getAgentsDir(): string {
  return process.env.AGENTS_DIR ?? path.resolve(process.cwd(), './agents');
}

export function loadAgentPrompt(agentName: string): string {
  const filePath = path.join(getAgentsDir(), `${agentName}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AgentRunner] Prompt not found for agent "${agentName}" at ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentSeverity = 'ok' | 'warning' | 'critical';

export interface AgentAction {
  type: 'notion_story' | 'audit_log' | 'alert' | 'trigger_agent' | 'update_db';
  payload: Record<string, unknown>;
}

export interface AgentResult {
  agentName: string;
  ranAt: Date;
  findings: string;
  severity: AgentSeverity;
  actions: AgentAction[];
  rawOutput: string;
  durationMs: number;
}

// ── Gemini client (re-uses same pattern as geminiClient.ts) ──────────────────

async function callGemini(systemPrompt: string, userMessage: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!key) {
    throw new Error('[AgentRunner] GEMINI_API_KEY is required for autonomous agents');
  }
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';
  const model = new GoogleGenerativeAI(key).getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
  });

  return result.response.text();
}

// ── JSON output parser ────────────────────────────────────────────────────────

function parseAgentOutput(raw: string): {
  findings: string;
  severity: AgentSeverity;
  actions: AgentAction[];
} {
  try {
    const parsed = JSON.parse(raw) as {
      findings?: string;
      severity?: string;
      actions?: AgentAction[];
    };
    return {
      findings: parsed.findings ?? raw,
      severity: (['ok', 'warning', 'critical'].includes(parsed.severity ?? '')
        ? parsed.severity
        : 'ok') as AgentSeverity,
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    };
  } catch {
    return { findings: raw, severity: 'ok', actions: [] };
  }
}

// ── Action router ─────────────────────────────────────────────────────────────

async function routeActions(
  agentName: string,
  actions: AgentAction[],
  prisma: PrismaClient,
): Promise<void> {
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'audit_log':
          await appendAuditLog(prisma, {
            practiceId: String(action.payload.practiceId ?? 'platform'),
            action: String(action.payload.action ?? `agent.${agentName}.finding`),
            details: action.payload,
          });
          break;

        case 'notion_story':
          // Route to existing productImprovementAgent Notion writer if configured
          if (process.env.NOTION_API_KEY && process.env.NOTION_PRODUCT_STORIES_DB_ID) {
            const { Client } = await import('@notionhq/client');
            const notion = new Client({ auth: process.env.NOTION_API_KEY });
            await notion.pages.create({
              parent: { database_id: process.env.NOTION_PRODUCT_STORIES_DB_ID },
              properties: {
                Name: {
                  title: [{ text: { content: String(action.payload.title ?? agentName) } }],
                },
              },
              children: [
                {
                  object: 'block',
                  type: 'paragraph',
                  paragraph: {
                    rich_text: [
                      { type: 'text', text: { content: String(action.payload.summary ?? '') } },
                    ],
                  },
                },
              ],
            });
          }
          break;

        case 'alert': {
          const urgency = String(action.payload.urgency ?? 'next_check');
          const prefix = urgency === 'immediate' ? '[AGENT ALERT][IMMEDIATE]' : '[AGENT ALERT]';
          console.warn(`${prefix} [${agentName}] ${String(action.payload.message ?? '')}`);
          await appendAuditLog(prisma, {
            practiceId: 'platform',
            action: `agent.alert.${urgency}`,
            details: { agentName, ...action.payload },
          });
          break;
        }

        case 'trigger_agent':
          // Log cross-agent triggers; they are picked up by the next cron tick
          // or handled by the event system — not recursively called here to
          // avoid unbounded chains.
          console.log(
            `[AgentRunner] ${agentName} requests trigger of "${action.payload.agentName}": ${action.payload.reason}`,
          );
          await appendAuditLog(prisma, {
            practiceId: 'platform',
            action: 'agent.trigger_requested',
            details: { requestingAgent: agentName, ...action.payload },
          });
          break;

        case 'update_db':
          // Agent-requested DB mutations are logged but NOT auto-executed.
          // A human (Khalid) must approve structural DB changes.
          console.log(
            `[AgentRunner] ${agentName} requested DB update (logged, awaiting human approval):`,
            action.payload,
          );
          await appendAuditLog(prisma, {
            practiceId: 'platform',
            action: 'agent.db_update_requested',
            details: { agentName, ...action.payload },
          });
          break;
      }
    } catch (err) {
      console.error(`[AgentRunner] action routing error (${action.type}) for ${agentName}:`, err);
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run a named agent with the given context data.
 *
 * @param agentName   Matches the filename in agents/ (e.g. "carrier-ivr-health")
 * @param context     Data to inject into the agent's user message
 * @param prisma      Prisma client for context queries and action routing
 */
export async function runAgent(
  agentName: string,
  context: Record<string, unknown>,
  prisma: PrismaClient,
): Promise<AgentResult> {
  const start = Date.now();
  console.log(`[AgentRunner] starting ${agentName}`);

  let systemPrompt: string;
  try {
    systemPrompt = loadAgentPrompt(agentName);
  } catch (err) {
    console.error(`[AgentRunner] failed to load prompt for ${agentName}:`, err);
    throw err;
  }

  // L-3: strip transcript from context before sending to Gemini (Google API).
  // The scrubber in processCallEnded covers 5 PHI patterns but patient names
  // spoken organically mid-utterance may pass through. Any residual PHI must
  // not leave Canadian jurisdiction via a Google API call. Agents needing
  // transcript analysis should receive only scrubbed summary fields, not the
  // raw transcript string.
  const { transcript: _strippedTranscript, ...safeContext } = context;
  void _strippedTranscript; // intentionally excluded from Gemini payload

  const userMessage = `## Context (${new Date().toISOString()})

\`\`\`json
${JSON.stringify(safeContext, null, 2)}
\`\`\`

Analyze the context above per your role. Respond ONLY with a JSON object:
{
  "findings": "<concise summary of what you found>",
  "severity": "ok" | "warning" | "critical",
  "actions": [
    { "type": "notion_story", "payload": { "title": "...", "summary": "...", "priority": "High" | "Medium" } },
    { "type": "audit_log", "payload": { "action": "agent.<name>.finding", "practiceId": "platform", "detail": "..." } },
    { "type": "alert", "payload": { "message": "...", "urgency": "immediate" | "next_check" } },
    { "type": "trigger_agent", "payload": { "agentName": "incident-response", "reason": "..." } }
  ]
}
Only include actions that are warranted. Empty actions array is valid when severity is "ok".`;

  let rawOutput = '';
  try {
    rawOutput = await callGemini(systemPrompt, userMessage);
  } catch (err) {
    console.error(`[AgentRunner] Gemini call failed for ${agentName}:`, err);
    throw err;
  }

  const { findings, severity, actions } = parseAgentOutput(rawOutput);
  const durationMs = Date.now() - start;

  console.log(
    `[AgentRunner] ${agentName} done — severity=${severity} actions=${actions.length} (${durationMs}ms)`,
  );

  // Persist run record to audit log
  try {
    await appendAuditLog(prisma, {
      practiceId: 'platform',
      action: `agent.run.${agentName}`,
      details: { severity, findings: findings.slice(0, 500), actionCount: actions.length, durationMs },
    });
  } catch { /* non-fatal */ }

  // Route actions
  await routeActions(agentName, actions, prisma);

  return { agentName, ranAt: new Date(), findings, severity, actions, rawOutput, durationMs };
}
