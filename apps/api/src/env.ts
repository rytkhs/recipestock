/// <reference types="@cloudflare/workers-types" />

export type BrowserRunBinding = {
  quickAction(
    action: "content",
    options: {
      url: string;
      gotoOptions: {
        timeout: number;
        waitUntil: "networkidle2";
      };
      userAgent: string;
    },
  ): Promise<Response>;
};

export type Bindings = {
  AI: Ai;
  APP_ENV: "development" | "staging" | "production";
  ASSETS: Fetcher;
  BROWSER: BrowserRunBinding;
  IMPORT_QUEUE: Queue<{ jobId: string }>;
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
  CF_AIG_TOKEN?: string;
  AI_TEXT_MODEL: string;
  AI_VISION_MODEL: string;
  IMPORT_FETCH_MODE?: string;
  IMPORT_AI_PROVIDER?: string;
  GROQ_API_KEY?: string;
  GROQ_TEXT_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_TEXT_MODEL?: string;
  FREE_AI_MONTHLY_LIMIT?: string;
  PRO_AI_MONTHLY_LIMIT?: string;
  IMPORT_TIMEOUT_MS: string;
  IMPORT_JOB_TIMEOUT_MS?: string;
  IMPORT_MAX_HTML_BYTES: string;
  IMPORT_AI_TIMEOUT_MS: string;
  IMPORT_RECIPE_SYSTEM_PROMPT: string;
};
