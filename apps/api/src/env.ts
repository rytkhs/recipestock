/// <reference types="@cloudflare/workers-types" />

export type Bindings = {
  AI: Ai;
  APP_ENV: "development" | "staging" | "production";
  ASSETS: Fetcher;
  DATABASE_URL: string;
  BETTER_AUTH_URL: string;
  RECIPE_IMAGES: R2Bucket;
  BETTER_AUTH_SECRET: string;
  AUTH_EMAIL_FROM: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRO_PRICE_ID: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  AI_GATEWAY_NAME: string;
  AI_TEXT_MODEL: string;
  AI_VISION_MODEL: string;
  FREE_AI_MONTHLY_LIMIT?: string;
  PRO_AI_MONTHLY_LIMIT?: string;
  IMPORT_TIMEOUT_MS: string;
};
