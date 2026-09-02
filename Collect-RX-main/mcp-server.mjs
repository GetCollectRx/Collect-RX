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

let sessionCookie = null;

async function login() {
  const password = process.env.COLLECTRX_PLATFORM_DEV_PASSWORD;
  if (!password) {
    throw new Error(
      "Set COLLECTRX_PLATFORM_DEV_PASSWORD to authenticate the MCP server (matches the backend's PLATFORM_DEV_PASSWORD)."
    );
  }
  const res = await fetch(`${BASE_URL}/api/auth/login/platform-dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || `Platform-dev login failed (${res.status})`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Login succeeded but no session cookie was returned.");
  }
  sessionCookie = setCookie.split(";")[0];
}

async function api(method, path, body = null) {
  if (!sessionCookie) await login();

  const request = async () => {
    const options = {
      method,
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    };
    if (body) options.body = JSON.stringify(body);
    return fetch(`${BASE_URL}${path}`, options);
  };

  let res = await request();
  if (res.status === 401) {
    await login();
    res = await request();
  }
  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.error || json.message || `API error ${res.status}`);
  }
  return json;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────
//
// Every path below was checked directly against the mounted routes in
// src/server/index.ts, not inferred from naming conventions. The MCP server
// always authenticates as platform_dev (see login() above), so every tool
// here is scoped to what a platform_dev session can actually reach —
// platform_dev is explicitly barred from a few practice-staff-only actions,
// noted per tool below.

const TOOLS = [
  // ── Queue ──────────────────────────────────────────────────────────────────
  {
    name: "get_queue_stats",
    description:
      "Get queue statistics for every practice (queued/in-progress/resolved/blocked counts, plus platform-wide recovery metrics). This is always a platform-wide snapshot — pass practice_id to filter the response down to one practice's row.",
    inputSchema: {
      type: "object",
      properties: {
        practice_id: {
          type: "string",
          description: "Practice UUID. Optional — omit to see every practice.",
        },
      },
    },
  },
  {
    name: "build_queue",
    description:
      "IMPORTANT — despite the name, this does NOT preview or build a call queue. It only records a break-glass request in the platform audit log (POST /api/admin/queue/build). The actual AR call queue is built and dispatched automatically on its own schedule by the server (runDeskQueueTick) and is not directly triggerable through this API. Use this only to leave an auditable note that a break-glass build was requested and why.",
    inputSchema: {
      type: "object",
      required: ["reason"],
      properties: {
        reason: {
          type: "string",
          description: "Why a break-glass queue build is being requested. Required by the API.",
        },
      },
    },
  },
  {
    name: "run_queue",
    description:
      "IMPORTANT — despite the name, this does NOT dispatch any calls. It only records a break-glass request in the platform audit log (POST /api/admin/queue/run). No calls to Vapi or carriers happen as a result of calling this tool. Real dispatch runs automatically on its own schedule, gated by CARRIER_BLOCK and plan limits. Use this only to leave an auditable note that a break-glass run was requested and why — never tell Khalid calls were placed because this tool returned success.",
    inputSchema: {
      type: "object",
      required: ["reason"],
      properties: {
        reason: {
          type: "string",
          description: "Why a break-glass queue run is being requested. Required by the API.",
        },
      },
    },
  },

  // ── Claims ─────────────────────────────────────────────────────────────────
  {
    name: "list_claims",
    description:
      "List claims for a practice with optional filters. Use to review outstanding claims, check specific carriers, or see claims in a particular aging bucket.",
    inputSchema: {
      type: "object",
      required: ["practice_id"],
      properties: {
        practice_id: {
          type: "string",
          description: "Practice UUID (required — claims are always practice-scoped)",
        },
        status: {
          type: "string",
          enum: [
            "PENDING",
            "IN_QUEUE",
            "CALLING",
            "APPROVED_PENDING_PAYMENT",
            "RESOLVED",
            "DENIED",
            "ESCALATED",
            "ON_HOLD",
            "BLOCKED",
          ],
          description: "Filter by claim status",
        },
        carrier: {
          type: "string",
          description: "Filter by carrier code (e.g. sunlife_private, manulife, great_west)",
        },
        aging: {
          type: "string",
          enum: ["30-60", "60-90", "90+"],
          description: "Filter by days-outstanding bucket",
        },
        limit: {
          type: "number",
          description: "Max results per page (default 25, max 100)",
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
          type: "string",
          description: "The claim UUID",
        },
      },
    },
  },
  {
    name: "pause_claim",
    description:
      "NOT IMPLEMENTED. There is no per-claim pause in the API today — ClaimStatus has no PAUSED/EXCLUDED value and the only claim PATCH endpoint updates servicedAt. Calling this tool always returns a not_implemented error. The nearest existing capability is pausing the entire practice queue (POST /api/desk/:practiceId/queue/pause), which is a different, coarser action.",
    inputSchema: {
      type: "object",
      required: ["claim_id"],
      properties: {
        claim_id: { type: "string", description: "The claim UUID (unused — feature not built)" },
        reason: { type: "string", description: "Why the claim would be paused (unused — feature not built)" },
      },
    },
  },
  {
    name: "unpause_claim",
    description:
      "NOT IMPLEMENTED — see pause_claim. Calling this tool always returns a not_implemented error.",
    inputSchema: {
      type: "object",
      required: ["claim_id"],
      properties: {
        claim_id: { type: "string", description: "The claim UUID (unused — feature not built)" },
      },
    },
  },

  // ── Escalations ────────────────────────────────────────────────────────────
  {
    name: "list_escalations",
    description:
      "Get open CallEscalation records for a practice — claims where the AI couldn't resolve the issue and a staff member needs to follow up. Note: this is a separate system from a claim's own ESCALATED status (see list_claims status filter) — escalation_id here is not a claim_id.",
    inputSchema: {
      type: "object",
      required: ["practice_id"],
      properties: {
        practice_id: { type: "string", description: "Practice UUID (required)" },
        status: {
          type: "string",
          enum: ["open", "resolved"],
          description: "Filter by escalation status (default: all)",
        },
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
  },
  {
    name: "resolve_escalation",
    description:
      "Mark a CallEscalation as resolved. IMPORTANT: the backend explicitly blocks platform_dev sessions from this action by design (PUT /api/desk/:practiceId/escalations/:id returns 403 for platform_dev) — this is a deliberate safety rail restricting who can resolve escalations (front_desk, practice_owner, office_manager, billing_coordinator, group_admin only). Since this MCP server always authenticates as platform_dev, calling this tool will always fail with a 403. It is wired to the real endpoint so it starts working automatically if the platform_dev restriction is ever intentionally relaxed, but do not expect it to succeed today.",
    inputSchema: {
      type: "object",
      required: ["practice_id", "escalation_id", "resolution"],
      properties: {
        practice_id: { type: "string", description: "Practice UUID" },
        escalation_id: {
          type: "string",
          description: "The CallEscalation UUID from list_escalations (not a claim_id)",
        },
        resolution: {
          type: "string",
          enum: ["resolved", "appealing", "written_off", "paused_for_review"],
          description: "How the escalation was resolved",
        },
        notes: { type: "string", description: "Optional resolution notes" },
      },
    },
  },

  // ── Reports ────────────────────────────────────────────────────────────────
  {
    name: "get_aging_report",
    description:
      "Get an aging summary for a practice — total outstanding amounts across aging buckets. There is no date-range parameter on this endpoint; it always reflects current outstanding balances.",
    inputSchema: {
      type: "object",
      required: ["practice_id"],
      properties: {
        practice_id: { type: "string", description: "Practice UUID (required)" },
      },
    },
  },
  {
    name: "get_carrier_stats",
    description:
      "Get per-carrier call health for the last 30 days — total calls, resolution rate, avg hold time, block status.",
    inputSchema: {
      type: "object",
      required: ["practice_id"],
      properties: {
        practice_id: { type: "string", description: "Practice UUID (required)" },
      },
    },
  },

  // ── Practices ──────────────────────────────────────────────────────────────
  {
    name: "list_practices",
    description: "List all dental practices connected to CollectRx.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_practice",
    description: "Get full details for a specific practice.",
    inputSchema: {
      type: "object",
      required: ["practice_id"],
      properties: {
        practice_id: { type: "string", description: "Practice UUID (from list_practices)" },
      },
    },
  },
  {
    name: "update_practice",
    description:
      "Update a practice's settings (e.g. max call attempts, min claim value, escalation email).",
    inputSchema: {
      type: "object",
      required: ["practice_id", "updates"],
      properties: {
        practice_id: { type: "string", description: "Practice UUID (from list_practices)" },
        updates: {
          type: "object",
          description: "Settings fields to update, e.g. { max_call_attempts: 4, min_claim_value: 100 }",
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
      const data = await api("GET", "/api/admin/queue/stats");
      const rows = data.data || [];
      const filtered = args.practice_id
        ? rows.filter((r) => r.practice?.id === args.practice_id)
        : rows;
      return JSON.stringify({ practices: filtered, platformRecovery: data.platformRecovery }, null, 2);
    }
    case "build_queue": {
      const data = await api("POST", "/api/admin/queue/build", { reason: args.reason });
      return data.message;
    }
    case "run_queue": {
      const data = await api("POST", "/api/admin/queue/run", { reason: args.reason });
      return data.message;
    }

    // Claims
    case "list_claims": {
      const params = new URLSearchParams();
      params.set("practiceId", args.practice_id);
      if (args.status) params.set("status", args.status);
      if (args.carrier) params.set("carrier", args.carrier);
      if (args.aging) params.set("aging", args.aging);
      if (args.limit) params.set("limit", args.limit);
      const data = await api("GET", `/api/insurance/claims?${params}`);
      return `${data.total ?? data.claims?.length ?? 0} claims found:\n${JSON.stringify(data.claims ?? data, null, 2)}`;
    }
    case "get_claim": {
      const data = await api("GET", `/api/insurance/claims/${args.claim_id}`);
      return JSON.stringify(data, null, 2);
    }
    case "pause_claim":
    case "unpause_claim": {
      return JSON.stringify(
        {
          error: "not_implemented",
          message:
            "Per-claim pause/unpause does not exist in the API. Nearest capability: POST /api/desk/:practiceId/queue/pause (or /resume) pauses the entire practice queue, not a single claim.",
        },
        null,
        2,
      );
    }

    // Escalations
    case "list_escalations": {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.limit) params.set("limit", args.limit);
      const data = await api("GET", `/api/desk/${args.practice_id}/escalations?${params}`);
      const rows = data.data || [];
      return `${rows.length} escalations:\n${JSON.stringify(rows, null, 2)}`;
    }
    case "resolve_escalation": {
      const data = await api("PUT", `/api/desk/${args.practice_id}/escalations/${args.escalation_id}`, {
        resolution: args.resolution,
        notes: args.notes,
      });
      return JSON.stringify(data.data, null, 2);
    }

    // Reports
    case "get_aging_report": {
      const data = await api("GET", `/api/practices/${args.practice_id}/reports/aging`);
      return JSON.stringify(data.data, null, 2);
    }
    case "get_carrier_stats": {
      const data = await api("GET", `/api/carriers/health?practiceId=${args.practice_id}`);
      return JSON.stringify(data.data, null, 2);
    }

    // Practices (platform_dev uses /api/admin/* — /api/practices requires practice context)
    case "list_practices": {
      const data = await api("GET", "/api/admin/practices");
      return JSON.stringify(data.data, null, 2);
    }
    case "get_practice": {
      const data = await api("GET", `/api/admin/practices/${args.practice_id}`);
      return JSON.stringify(data.data, null, 2);
    }
    case "update_practice": {
      const data = await api(
        "PUT",
        `/api/admin/practices/${args.practice_id}/settings`,
        args.updates
      );
      return `Practice updated:\n${JSON.stringify(data.data, null, 2)}`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Server Setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "collectrx", version: "1.1.0" },
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
