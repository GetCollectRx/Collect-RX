import 'dotenv/config';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}

const devFallbackJwt = 'collectrx-dev-insecure-jwt-replace-locally';

export const config = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  get jwtSecret(): string {
    return process.env.JWT_SECRET || devFallbackJwt;
  },
  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY,
    fromEmail: 'noreply@collectrx.com',
    webhookVerificationKey: process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY,
    mockMode: !process.env.SENDGRID_API_KEY,
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    mockMode: !process.env.STRIPE_SECRET_KEY,
  },
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:3001'],
};
