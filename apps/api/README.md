# API

Hono API running on Cloudflare Workers.

This Worker serves `/api/*` routes and, in production, also serves the built web app from `apps/web/dist` through the `ASSETS` binding.

## Local environment variables

Copy the local Worker environment template:

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Set real values in `apps/api/.dev.vars`.

Required local secrets:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `RESEND_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

URL import AI provider selection is controlled by `IMPORT_AI_PROVIDER`. Set it to `workers-ai`,
`openrouter`, or `groq`. OpenRouter requires `OPENROUTER_API_KEY` and `OPENROUTER_TEXT_MODEL`.
Groq requires `GROQ_API_KEY` and `GROQ_TEXT_MODEL`.

## R2 setup

Create the development R2 bucket after Cloudflare login:

```bash
pnpm --filter @recipestock/api exec wrangler r2 bucket create recipestock-images-dev
pnpm --filter @recipestock/api exec wrangler r2 bucket cors set recipestock-images-dev --file apps/api/r2-cors.dev.json
```

The Worker binding name is `RECIPE_IMAGES`. Direct browser uploads also require R2 S3 API credentials in `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.

`wrangler.jsonc` sets the `RECIPE_IMAGES` binding to `remote: true` in development. This keeps direct browser PUT uploads and Worker-side copy/delete/list operations pointed at the same R2 bucket.

Do not start the API with `wrangler dev --local` when testing image uploads. The `--local` flag disables remote bindings, which makes Worker-side R2 operations read from local storage while browser PUT uploads write to the remote bucket.

## Development

Start the API Worker locally:

```bash
pnpm --filter @recipestock/api dev
```

Default local URL:

- API: http://localhost:8787/

## Verification

Run API-only checks:

```bash
pnpm --filter @recipestock/api typecheck
pnpm --filter @recipestock/api test
```

Validate the Worker bundle and bindings before deploy. Build the web app first because `wrangler.jsonc` points `ASSETS` at `../web/dist`.

```bash
pnpm --filter @recipestock/web build
pnpm --filter @recipestock/api exec wrangler deploy --dry-run
```

## Production secrets

Set production secrets with `wrangler secret put`:

```bash
pnpm --filter @recipestock/api exec wrangler secret put DATABASE_URL
pnpm --filter @recipestock/api exec wrangler secret put BETTER_AUTH_SECRET
pnpm --filter @recipestock/api exec wrangler secret put RESEND_API_KEY
pnpm --filter @recipestock/api exec wrangler secret put STRIPE_SECRET_KEY
pnpm --filter @recipestock/api exec wrangler secret put STRIPE_WEBHOOK_SECRET
pnpm --filter @recipestock/api exec wrangler secret put STRIPE_PRO_PRICE_ID
pnpm --filter @recipestock/api exec wrangler secret put CLOUDFLARE_ACCOUNT_ID
pnpm --filter @recipestock/api exec wrangler secret put R2_ACCESS_KEY_ID
pnpm --filter @recipestock/api exec wrangler secret put R2_SECRET_ACCESS_KEY
pnpm --filter @recipestock/api exec wrangler secret put GROQ_API_KEY
pnpm --filter @recipestock/api exec wrangler secret put OPENROUTER_API_KEY
```

Do not commit `.dev.vars` or other secret files.
