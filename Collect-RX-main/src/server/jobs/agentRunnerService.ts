import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { logger } from '../observability/logger.js';
import type { Job } from 'bullmq';

interface AgentRunJob {
  agentName: string;
  cron: string;
  upstreamAgents: string[];
  timeWindow: string;
}

interface AgentRunResult {
  agentName: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK';
  score: number | null;
  summary: string;
  findings: Array<{
    id: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    domain: string;
    description: string;
    action: string;
    evidence?: string | null;
  }>;
  downstream: string[];
  raw: Record<string, unknown> | null;
}

async function readAgentDefinition(agentName: string): Promise<string> {
  try {
    const response = await axios.get(
      `https://raw.githubusercontent.com/GetCollectRx/Collect-RX/main/agents/${agentName}.md`,
      { timeout: 10000 },
    );
    return response.data;
  } catch (err) {
    logger.warn('[agentRunner] Failed to read agent definition from GitHub', {
      agentName,
      error: String(err),
    });
    return '';
  }
}

async function readAgentRunnerTemplate(): Promise<string> {
  try {
    const response = await axios.get(
      'https://raw.githubusercontent.com/GetCollectRx/Collect-RX/main/agents/runtime/agent-runner-template.md',
      { timeout: 10000 },
    );
    return response.data;
  } catch (err) {
    logger.warn('[agentRunner] Failed to read agent runner template from GitHub', {
      error: String(err),
    });
    return '';
  }
}

function buildAgentPrompt(
  agentName: string,
  agentDef: string,
  template: string,
  upstreamAgents: string[],
): string {
  const apiBase = process.env.API_BASE || 'https://collect-rx.fly.dev';
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/Toronto' });

  return `You are running the CollectRx ${agentName} agent.

Today's date: ${dateStr}
Current time (ET): ${timeStr}
API_BASE: ${apiBase}
AGENT_RUNTIME_SECRET: Bearer [set in Fly secrets]

## Agent Definition

\`\`\`
${agentDef}
\`\`\`

## Agent Runner Template

\`\`\`
${template}
\`\`\`

## Your Task

Execute the agent definition above following the runner template. When complete, POST your output to ${apiBase}/api/agent-runs with these parameters:
- agentName: "${agentName}"
- upstream agents: ${upstreamAgents.join(', ') || 'none'}

Fetch upstream context first via GET ${apiBase}/api/agent-runs/context?agents=${upstreamAgents.join(',')}&hours=168

Use Authorization: Bearer [AGENT_RUNTIME_SECRET] for all API calls.`;
}

export async function runAgent(job: Job<AgentRunJob>): Promise<AgentRunResult | null> {
  const { agentName, upstreamAgents } = job.data;

  logger.info('[agentRunner] Starting agent run', {
    agentName,
    upstreamAgents,
    jobId: job.id,
  });

  try {
    // Read agent definition and template
    const [agentDef, template] = await Promise.all([
      readAgentDefinition(agentName),
      readAgentRunnerTemplate(),
    ]);

    if (!agentDef) {
      throw new Error(`Failed to read agent definition for ${agentName}`);
    }

    // Build the prompt
    const prompt = buildAgentPrompt(agentName, agentDef, template, upstreamAgents);

    // Initialize Anthropic client
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Call Claude API with the agent prompt
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract the response text
    const responseText =
      response.content[0].type === 'text' ? response.content[0].text : '';

    logger.info('[agentRunner] Agent completed execution', {
      agentName,
      tokensUsed: response.usage?.output_tokens ?? 0,
      jobId: job.id,
    });

    // Parse the response to extract structured output
    // The agent should POST the result, but we also parse it for local processing
    const resultJson = parseAgentResponse(responseText);

    if (resultJson) {
      // Post to the API
      await postAgentResult(resultJson, agentName);
      return resultJson;
    }

    return null;
  } catch (err) {
    logger.error('[agentRunner] Agent run failed', {
      agentName,
      error: String(err),
      jobId: job.id,
    });
    throw err;
  }
}

function parseAgentResponse(responseText: string): AgentRunResult | null {
  try {
    // Look for JSON in the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const result = JSON.parse(jsonMatch[0]) as AgentRunResult;

    // Validate the result structure
    if (!result.agentName || !result.severity || !result.summary) {
      return null;
    }

    return result;
  } catch (err) {
    logger.debug('[agentRunner] Failed to parse agent response JSON', {
      error: String(err),
    });
    return null;
  }
}

async function postAgentResult(result: AgentRunResult, agentName: string): Promise<void> {
  const apiBase = process.env.API_BASE || 'https://collect-rx.fly.dev';
  const secret = process.env.AGENT_RUNTIME_SECRET;

  if (!secret) {
    logger.warn('[agentRunner] AGENT_RUNTIME_SECRET not set, skipping API post', {
      agentName,
    });
    return;
  }

  try {
    await axios.post(`${apiBase}/api/agent-runs`, result, {
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    logger.info('[agentRunner] Posted agent result to API', {
      agentName,
      severity: result.severity,
    });
  } catch (err) {
    logger.error('[agentRunner] Failed to post agent result', {
      agentName,
      error: String(err),
    });
  }
}
