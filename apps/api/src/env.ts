/// <reference types="@cloudflare/workers-types" />

export type Bindings = {
  APP_ENV: "development" | "staging" | "production";
  ASSETS: Fetcher;
  DATABASE_URL: string;
  RECIPE_IMAGES: R2Bucket;
  BETTER_AUTH_SECRET: string;
  RESEND_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRO_PRICE_ID: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CF_AIG_TOKEN: string;
  AI_GATEWAY_NAME: string;
  AI_TEXT_MODEL: string;
  AI_VISION_MODEL: string;
  IMPORT_TIMEOUT_MS: string;
};
