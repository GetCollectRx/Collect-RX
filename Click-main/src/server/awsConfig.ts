import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'us-east-1' }); // Change region if needed

interface AppSecrets {
  VAPI_API_KEY: string;
  DATABASE_URL: string;
  VAPI_WEBHOOK_SECRET?: string;
  PORT?: string;
}

/**
 * Fetch secrets from AWS Parameter Store
 * Parameters are stored under /collectrx/ prefix and encrypted with SecureString
 */
async function getSecret(parameterName: string): Promise<string> {
  try {
    const command = new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true, // Decrypt SecureString parameters
    });

    const response = await ssmClient.send(command);
    if (!response.Parameter?.Value) {
      throw new Error(`Parameter ${parameterName} not found`);
    }

    console.log(`✅ Loaded secret: ${parameterName}`);
    return response.Parameter.Value;
  } catch (error) {
    console.error(`❌ Failed to load secret ${parameterName}:`, error);
    throw error;
  }
}

/**
 * Load all required secrets from Parameter Store
 * Falls back to environment variables if Parameter Store is unavailable
 */
export async function loadSecretsFromParameterStore(): Promise<AppSecrets> {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;

  // In production (Railway), use Parameter Store
  if (isProduction) {
    console.log('🔐 Loading secrets from AWS Parameter Store (production)...');

    try {
      const [vapiApiKey, databaseUrl, vapiWebhookSecret] = await Promise.all([
        getSecret('/collectrx/vapi/api-key'),
        getSecret('/collectrx/database/url'),
        getSecret('/collectrx/vapi/webhook-secret').catch(() => 'default-webhook-secret'),
      ]);

      return {
        VAPI_API_KEY: vapiApiKey,
        DATABASE_URL: databaseUrl,
        VAPI_WEBHOOK_SECRET: vapiWebhookSecret,
        PORT: process.env.PORT || '3000',
      };
    } catch (error) {
      console.error('⚠️ Failed to load secrets from Parameter Store. Check IAM permissions and parameter names.');
      throw error;
    }
  }

  // In development, use local .env
  console.log('🔐 Loading secrets from .env (development)...');
  return {
    VAPI_API_KEY: process.env.VAPI_API_KEY || 'dev-vapi-key',
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://localhost:5432/collectrx',
    VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET || 'dev-webhook-secret',
    PORT: process.env.PORT || '3000',
  };
}

export default loadSecretsFromParameterStore;
