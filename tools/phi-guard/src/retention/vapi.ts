import { RetentionError } from "./types.js";
import type { FieldStatus, RetentionSource, SourceResult } from "./types.js";

/**
 * Get Call: GET https://api.vapi.ai/call/{id}, bearer token. Every path below is a
 * response field name taken from the official Vapi API reference
 * (docs.vapi.ai/api-reference/calls/get).
 */
export const VAPI_CALL_URL = "https://api.vapi.ai/call/";

export const CONTENT_FIELDS: readonly string[] = [
  // Messages
  "messages",
  "artifact.messages",
  "artifact.messagesOpenAIFormatted",
  // Transcript
  "artifact.transcript",
  // Recording and packet capture locations
  "artifact.recording",
  "artifact.recordingUrl",
  "artifact.stereoRecordingUrl",
  "artifact.videoRecordingUrl",
  "artifact.pcapUrl",
  "artifact.presignedMonoUrl",
  "artifact.presignedStereoUrl",
  "artifact.presignedVideoUrl",
  "artifact.presignedAssistantUrl",
  "artifact.presignedCustomerUrl",
  "artifact.presignedPcapUrl",
  // Logs
  "artifact.logUrl",
  "artifact.presignedLogUrl",
  // Structured outputs and values derived from the conversation
  "artifact.structuredOutputs",
  "artifact.skippedStructuredOutputs",
  "artifact.scorecards",
  "artifact.variableValues",
  "artifact.nodes",
  "artifact.transfers",
  // Post-call analysis
  "analysis.summary",
  "analysis.structuredData",
  "analysis.structuredDataMulti",
  "analysis.successEvaluation",
];

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_BODY_CHARS = 20_000_000;
const STATUS_PATTERN = /^[a-z-]{1,32}$/u;

export interface VapiSourceOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Absent, null, an empty string, or a container whose every member is empty. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  if (Array.isArray(value)) {
    return value.every(isEmptyValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isEmptyValue);
  }
  return false;
}

function lookup(body: Record<string, unknown>, path: string): unknown {
  let current: unknown = body;
  for (const key of path.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_CHARS) {
    throw new RetentionError("size", "Vapi response was too large");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new RetentionError("network", "Vapi response could not be read");
  }
  if (text.length > MAX_BODY_CHARS) {
    throw new RetentionError("size", "Vapi response was too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RetentionError("parse", "Vapi response was not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new RetentionError("parse", "Vapi response was not a JSON object");
  }
  return parsed;
}

export function createVapiSource(options: VapiSourceOptions): RetentionSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    name: "vapi",
    async check(callId: string): Promise<SourceResult> {
      let response: Response;
      try {
        response = await fetchImpl(`${VAPI_CALL_URL}${encodeURIComponent(callId)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${options.apiKey}`, Accept: "application/json" },
          // A redirect would carry the bearer token to another host.
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // The underlying error is dropped: it can name the URL or echo request headers.
        throw new RetentionError("network", "Vapi request failed");
      }
      if (!response.ok) {
        throw new RetentionError("http", `Vapi returned HTTP ${String(response.status)}`);
      }
      const body = await readJson(response);
      const status = body["status"];
      const fields: FieldStatus[] = CONTENT_FIELDS.map((field) => ({
        field,
        present: !isEmptyValue(lookup(body, field)),
      }));
      return {
        // Content is attached after a call ends, so earlier absence proves nothing.
        complete: status === "ended",
        detail: `status=${typeof status === "string" && STATUS_PATTERN.test(status) ? status : "unknown"}`,
        fields,
      };
    },
  };
}
