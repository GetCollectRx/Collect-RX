/**
 * CollectRx Backend — Entry Point
 *
 * Security controls applied here (in order):
 *   1. helmet        — sets secure HTTP response headers (XSS, MIME, HSTS, etc.)
 *   2. CORS          — restricts cross-origin access to allowed origins only
 *   3. HTTPS redirect — forces TLS in production (respects Railway proxy headers)
 *   4. Body parsing  — 1 MB JSON cap to limit oversized payload attacks
 *   5. Request log   — logs method + path for audit trail (no body/secret logging)
 *   6. Routes        — all business logic; per-endpoint rate limiting applied there
 *
 * SECRETS: No API keys or secrets live in this file.
 * All config is loaded exclusively from process.env (Railway vars / .env).
 */

require("dotenv").config();
const express = require("express");
const helmet  = require("helmet");
const cors    = require("cors");
const logger  = require("./logger");
const routes  = require("./routes");
const { loadSecrets, validateCredentials } = require("./config/secrets");

// ─── Boot sequence ────────────────────────────────────────────────────────────
// Secrets must be loaded before any module reads process.env credentials.
// In staging/production with AWS_REGION + SSM_PARAMETER_PATH set, this fetches
// from Parameter Store.  In development it is a no-op (uses .env values).
async function boot() {
  await loadSecrets();
  validateCredentials();
  startServer();
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── 1. SECURITY HEADERS (helmet) ────────────────────────────────────────────
// Sets: X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security,
// X-XSS-Protection, Referrer-Policy, Content-Security-Policy, and more.
// See: https://helmetjs.github.io
app.use(helmet());

// ─── 2. CORS ─────────────────────────────────────────────────────────────────
// Allowlist: only the Railway backend and the Lovable frontend may call this API.
// Add additional origins to the ALLOWED_ORIGINS env var as a comma-separated list.
// Example: ALLOWED_ORIGINS=https://myapp.lovable.app,https://my-custom-domain.com
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Always allow localhost in development
if (process.env.NODE_ENV !== "production") {
  ALLOWED_ORIGINS.push("http://localhost:3000", "http://localhost:5173");
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (MCP server, curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    logger.warn(`CORS blocked request from origin: ${origin}`);
    callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-vapi-secret"],
  credentials: true,
  maxAge: 3600, // Cache preflight for 1 hour
}));

// ─── 3. HTTPS REDIRECT (production only) ────────────────────────────────────
// Railway terminates TLS at the edge and forwards requests via HTTP internally.
// The x-forwarded-proto header tells us the original protocol.
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.headers["x-forwarded-proto"] && req.headers["x-forwarded-proto"] !== "https") {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ─── 4. BODY PARSING ─────────────────────────────────────────────────────────
// Cap JSON body at 1 MB to prevent oversized payload attacks.
// The /api/claims/import endpoint overrides this with its own 10 MB text/csv parser.
app.use(express.json({ limit: "1mb" }));

// ─── 5. REQUEST LOGGING ───────────────────────────────────────────────────────
// Log method + path only — never log headers or body (avoids leaking secrets/PII).
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// ─── 6. ROUTES ───────────────────────────────────────────────────────────────
app.use("/api", routes);

// Health check — no auth required, no sensitive data returned
app.get("/health", (req, res) =>
  res.json({ status: "ok", service: "collectrx-backend" })
);

// 404
app.use((req, res) =>
  res.status(404).json({ error: "Not found" })
);

// Global error handler — return generic message to client, log detail server-side
// OWASP: never expose stack traces or internal error messages to the client
app.use((err, req, res, next) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

function startServer() {
  app.listen(PORT, () => {
    logger.info(`CollectRx backend running on port ${PORT}`, {
      event: "SERVER_STARTED",
      port:  PORT,
      env:   process.env.NODE_ENV || "development",
    });

    // Warn loudly if webhook secret is not configured
    if (!process.env.VAPI_WEBHOOK_SECRET) {
      logger.warn("SECURITY WARNING: VAPI_WEBHOOK_SECRET is not set. Webhook signature verification is disabled.", {
        event: "CREDENTIAL_MISSING",
        key:   "VAPI_WEBHOOK_SECRET",
      });
    }

    // Warn if API key is missing
    if (!process.env.VAPI_API_KEY) {
      logger.warn("SECURITY WARNING: VAPI_API_KEY is not set. Vapi calls will fail.", {
        event: "CREDENTIAL_MISSING",
        key:   "VAPI_API_KEY",
      });
    }
  });
}

// Start the server (boot loads secrets first, then calls startServer)
boot().catch((err) => {
  // If secrets loading fails in staging/production, exit immediately
  logger.error("FATAL: Boot sequence failed", { error: err.message });
  process.exit(1);
});

module.exports = app;
