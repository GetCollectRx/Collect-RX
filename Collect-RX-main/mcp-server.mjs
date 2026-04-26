/**
 * CollectRx MCP Server
 * Connects Claude to the CollectRx backend as the control plane.
 *
 * Architecture:
 *   Claude (control plane) → MCP Server → CollectRx API (localhost:3000) → Vapi (execution)
 *
 * Start: node mcp-server.mjs
 * Claude Desktop config: see README or docs/mcp-setup.md
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = process.env.COLLECTRX_API_URL || "http://localhost:3000";

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

async function api(method, path, body = null) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, options);
  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.error || `API error ${res.status}`);
  }
  return json;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  // ── Queue ──────────────────────────────────────────────────────────────────
  {
    name: "get_queue_stats",
    description:
      "Get current queue statistics — how many claims are queued, in progress, resolved, escalated, or paused. Use this to understand the current state of collections before taking action.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "build_queue",
    description:
      "Preview which claims would be called in the next run — a dry run that does NOT make any calls. Returns the prioritized list of claims with their scores.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "run_queue",
    description:
      "DISPATCH calls to Vapi for all eligible claims. This triggers real phone calls to insurance carriers. Only use this when Khalid confirms he wants to run the queue.",
    inputSchema: {
      type: "object",
      properties: {
        practice_id: {
          type: "number",
          description: "Practice ID to run calls for. Omit to use default practice.",
        },
      },
    },
  },

  // ── Claims ─────────────────────────────────────────────────────────────────
  {
    name: "list_claims",
    description:
      "List claims with optional filters. Use to review outstanding claims, check specific carriers, or see claims in a particular aging bucket.",
    inputSchema: {
      type: "object",
      properties: {
        queue_status: {
          type: "string",
          enum: ["queued", "in_progress", "resolved", "escalated", "paused", "excluded"],
          description: "Filter by queue status",
        },
        carrier: {
          type: "string",
          description: "Filter by carrier code (e.g. sunlife_private, manulife, great_west)",
        },
        bucket: {
          type: "string",
          enum: ["0-29", "30-59", "60-89", "90-119", "120+"],
          description: "Filter by aging bucket",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 100)",
        },
      },
    },
  },
  {
    name: "get_claim",
    description:
      "Get full details of a single claim including its complete call history and all previous attempt outcomes.",
    inputSchema: {
      type: "object",
      required: ["claim_id"],
      properties: {
        claim_id: {
          type: "number",
          description: "The claim ID",
        },
      },
    },
  },
  {
    name: "pause_claim",
    description:
      "Pause a claim so it won't be called in future queue runs. Use when a claim needs human review or has special circumstances.",
    inputSchema: {
      type: "object",
      required: ["claim_id"],
      properties: {
        claim_id: {
          type: "number",
          description: "The claim ID to pause",
        },
        reason: {
          type: "string",
          description: "Why the claim is being paused",
        },
      },
    },
  },
  {
    name: "unpause_claim",
    description: "Return a paused claim back to the active queue.",
    inputSchema: {
      type: "object",
      required: ["claim_id"],
      properties: {
        claim_id: {
          type: "number",
          description: "The claim ID to unpause",
        },
      },
    },
  },

  // ── Escalations ────────────────────────────────────────────────────────────
  {
    name: "list_escalations",
    description:
      "Get all open escalations that need human attention — claims where the AI couldn't resolve the issue and a staff member needs to follow up.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "resolve_escalation",
    description: "Mark an escalation as resolved with notes on how it was handled.",
    inputSchema: {
      type: "object",
      required: ["escalation_id", "resolution_notes"],
      properties: {
        escalation_id: {
          type: "number",
          description: "The escalation ID",
        },
        resolution_notes: {
          type: "string",
          description: "How the escalation was resolved",
        },
      },
    },
  },

  // ── Reports ────────────────────────────────────────────────────────────────
  {
    name: "get_aging_report",
    description:
      "Get an aging summary broken down by insurance carrier — shows total outstanding amounts across 0-29, 30-59, 60-89, 90-119, and 120+ day buckets. Great for understanding where the money is.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_carrier_stats",
    description:
      "Get knowledge base health stats for all carriers — confidence scores, known IVR steps, success rates. Use to see which carriers the AI handles well vs. which need more data.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ── Practices ──────────────────────────────────────────────────────────────
  {
    name: "list_practices",
    description: "List all active dental practices connected to CollectRx.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_practice",
    description: "Get full details and queue stats for a specific practice.",
    inputSchema: {
      type: "object",
      required: ["practice_id"],
      properties: {
        practice_id: {
          type: "number",
          description: "The practice ID",
        },
      },
    },
  },
  {
    name: "update_practice",
    description:
      "Update practice settings such as max_call_attempts, min_claim_value, escalation_email, or any other configuration field.",
    inputSchema: {
      type: "object",
      required: ["practice_id", "updates"],
      properties: {
        practice_id: {
          type: "number",
          description: "The practice ID",
        },
        updates: {
          type: "object",
          description:
            "Fields to update, e.g. { max_call_attempts: 4, min_claim_value: 100 }",
        },
      },
    },
  },
];

// ─── Tool Handlers ────────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    // Queue
    case "get_queue_stats": {
      const data = await api("GET", "/api/queue/stats");
      return JSON.stringify(data.stats, null, 2);
    }
    case "build_queue": {
      const data = await api("GET", "/api/queue/build");
      return `${data.count} claims in next run:\n${JSON.stringify(data.queue, null, 2)}`;
    }
    case "run_queue": {
      const body = args.practice_id ? { practice_id: args.practice_id } : {};
      const data = await api("POST", "/api/queue/run", body);
      return `Dispatched ${data.dispatched} calls, ${data.failed} failed.\n${JSON.stringify(data.results, null, 2)}`;
    }

    // Claims
    case "list_claims": {
      const params = new URLSearchParams();
      if (args.queue_status) params.set("queue_status", args.queue_status);
      if (args.carrier) params.set("carrier", args.carrier);
      if (args.bucket) params.set("bucket", args.bucket);
      if (args.limit) params.set("limit", args.limit);
      const data = await api("GET", `/api/claims?${params}`);
      return `${data.count} claims found:\n${JSON.stringify(data.claims, null, 2)}`;
    }
    case "get_claim": {
      const data = await api("GET", `/api/claims/${args.claim_id}`);
      return JSON.stringify(data, null, 2);
    }
    case "pause_claim": {
      await api("POST", `/api/claims/${args.claim_id}/pause`, { reason: args.reason });
      return `Claim ${args.claim_id} paused. Reason: ${args.reason || "no reason given"}`;
    }
    case "unpause_claim": {
      await api("POST", `/api/claims/${args.claim_id}/unpause`);
      return `Claim ${args.claim_id} returned to queue.`;
    }

    // Escalations
    case "list_escalations": {
      const data = await api("GET", "/api/escalations");
      return `${data.count} open escalations:\n${JSON.stringify(data.escalations, null, 2)}`;
    }
    case "resolve_escalation": {
      await api("POST", `/api/escalations/${args.escalation_id}/resolve`, {
        resolutionNotes: args.resolution_notes,
      });
      return `Escalation ${args.escalation_id} resolved.`;
    }

    // Reports
    case "get_aging_report": {
      const data = await api("GET", "/api/reports/aging");
      return JSON.stringify(data.report, null, 2);
    }
    case "get_carrier_stats": {
      const data = await api("GET", "/api/carriers/stats");
      return JSON.stringify(data.stats, null, 2);
    }

    // Practices
    case "list_practices": {
      const data = await api("GET", "/api/practices");
      return JSON.stringify(data.practices, null, 2);
    }
    case "get_practice": {
      const data = await api("GET", `/api/practices/${args.practice_id}`);
      return JSON.stringify(data, null, 2);
    }
    case "update_practice": {
      const data = await api("PATCH", `/api/practices/${args.practice_id}`, args.updates);
      return `Practice updated:\n${JSON.stringify(data.practice, null, 2)}`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Server Setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "collectrx", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    return { content: [{ type: "text", text: result }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
