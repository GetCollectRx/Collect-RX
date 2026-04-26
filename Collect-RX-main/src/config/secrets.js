/**
 * CollectRx Secrets Loader — AWS Parameter Store integration
 *
 * STRATEGY:
 *   In staging and production, credentials are loaded from AWS Systems Manager
 *   Parameter Store (SecureString parameters, encrypted with KMS).  In local
 *   development, the loader falls back to process.env / .env file.
 *
 * ACTIVATION:
 *   Set the following environment variables to enable SSM mode:
 *     AWS_REGION          — e.g. ca-central-1
 *     SSM_PARAMETER_PATH  — e.g. /collectrx/staging  (path prefix)
 *     NODE_ENV=staging OR NODE_ENV=production
 *
 *   Without those, the loader is a no-op and process.env values are used.
 *
 * SSM PARAMETER LAYOUT:
 *   /collectrx/<env>/DATABASE_URL          (SecureString)
 *   /collectrx/<env>/VAPI_API_KEY          (SecureString)
 *   /collectrx/<env>/VAPI_WEBHOOK_SECRET   (SecureString)
 *   /collectrx/<env>/VAPI_PHONE_NUMBER_ID  (String)
 *   /collectrx/<env>/ALLOWED_ORIGINS       (String)
 *
 * PERMISSIONS (Railway IAM role needs):
 *   ssm:GetParametersByPath on /collectrx/<env>/*
 *   kms:Decrypt on the KMS key used for SecureString parameters
 *
 * ACCEPTANCE CRITERION:
 *   "AWS Parameter Store serving credentials in staging"
 *   Satisfied when NODE_ENV=staging and AWS_REGION is set; confirmed by
 *   the SECRETS_LOADED_FROM log entry emitted by this module.
 *
 * PHIPA/PIPEDA NOTE:
 *   Credentials stored in Parameter Store are never written to disk or logged.
 *   They overwrite the corresponding process.env key in memory at startup only.
 */

const logger = require("../logger");

// ─── Credential map ───────────────────────────────────────────────────────────
// Maps SSM parameter names (relative to path prefix) to process.env keys.
const CREDENTIAL_MAP = {
  DATABASE_URL:         "DATABASE_URL",
  VAPI_API_KEY:         "VAPI_API_KEY",
  VAPI_WEBHOOK_SECRET:  "VAPI_WEBHOOK_SECRET",
  VAPI_PHONE_NUMBER_ID: "VAPI_PHONE_NUMBER_ID",
  ALLOWED_ORIGINS:      "ALLOWED_ORIGINS",
};

// ─── Load secrets ─────────────────────────────────────────────────────────────
/**
 * Load credentials from AWS Parameter Store into process.env.
 * Must be called (and awaited) before any other module reads credentials.
 *
 * @returns {Promise<void>}
 */
async function loadSecrets() {
  const region    = process.env.AWS_REGION;
  const paramPath = process.env.SSM_PARAMETER_PATH;
  const env       = process.env.NODE_ENV;

  // Only use SSM in staging/production when properly configured.
  const useSsm = region && paramPath && (env === "staging" || env === "production");

  if (!useSsm) {
    logger.info("Secrets loader: using environment variables (SSM not configured)", {
      event:  "SECRETS_LOADED_FROM",
      source: "env",
      env:    env || "development",
    });
    return; // process.env already has values from .env / Railway config
  }

  logger.info("Secrets loader: fetching credentials from AWS Parameter Store", {
    event:  "SECRETS_LOADING",
    region,
    path:   paramPath,
    env,
  });

  try {
    // Lazy-require so the package is only loaded when SSM is actually needed.
    const { SSMClient, GetParametersByPathCommand } = require("@aws-sdk/client-ssm");

    const client = new SSMClient({ region });

    // GetParametersByPath returns up to 10 results per page; paginate if needed.
    let nextToken;
    let loadedCount = 0;

    do {
      const command = new GetParametersByPathCommand({
        Path:           paramPath.endsWith("/") ? paramPath : paramPath + "/",
        Recursive:      false,
        WithDecryption: true,  // Decrypts SecureString values using KMS
        NextToken:      nextToken,
      });

      const response = await client.send(command);

      for (const param of response.Parameters || []) {
        // Extract the parameter name without the path prefix
        const name = param.Name.split("/").pop();

        if (CREDENTIAL_MAP[name]) {
          process.env[CREDENTIAL_MAP[name]] = param.Value;
          loadedCount++;
          logger.debug("Secrets loader: loaded parameter", {
            event: "SECRETS_PARAM_LOADED",
            name,
            // Value is NEVER logged — only the parameter name
          });
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    logger.info("Secrets loader: credentials loaded from AWS Parameter Store", {
      event:       "SECRETS_LOADED_FROM",
      source:      "aws-ssm",
      region,
      path:        paramPath,
      env,
      loadedCount,
    });

  } catch (err) {
    // Fail fast — running without credentials is worse than not starting.
    logger.error("Secrets loader: FATAL — failed to load credentials from AWS Parameter Store", {
      event:  "SECRETS_LOAD_FAILED",
      region,
      path:   paramPath,
      error:  err.message,
      code:   err.name || err.code,
    });
    throw new Error(
      `Failed to load credentials from AWS SSM (${paramPath}): ${err.message}. ` +
      "Check IAM permissions (ssm:GetParametersByPath, kms:Decrypt) and the SSM_PARAMETER_PATH."
    );
  }
}

// ─── Validate required credentials ────────────────────────────────────────────
/**
 * After loading, verify that the mandatory credentials are present.
 * Logs a warning for each missing value; does NOT throw (allows degraded startup).
 */
function validateCredentials() {
  const required = [
    { key: "DATABASE_URL",         label: "PostgreSQL connection string" },
    { key: "VAPI_API_KEY",         label: "Vapi API key" },
    { key: "VAPI_WEBHOOK_SECRET",  label: "Vapi webhook signing secret" },
    { key: "VAPI_PHONE_NUMBER_ID", label: "Vapi phone number ID" },
  ];

  let valid = true;
  for (const { key, label } of required) {
    const val = process.env[key];
    if (!val || val.startsWith("your_") || val === "changeme") {
      logger.warn(`SECURITY: Required credential missing or placeholder — ${label}`, {
        event: "CREDENTIAL_MISSING",
        key,
      });
      valid = false;
    }
  }

  if (valid) {
    logger.info("Secrets loader: all required credentials present", {
      event: "CREDENTIALS_VALID",
    });
  }

  return valid;
}

module.exports = { loadSecrets, validateCredentials };
