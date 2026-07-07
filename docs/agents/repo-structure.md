# Repo Structure

Agent-facing map for where code should live in this repo.

## Planned Top-Level Shape

```txt
recipestock/
  apps/
    web/
    api/
  packages/
    db/
    schemas/
    shared/
    config/
  docs/
  pnpm-workspace.yaml
  turbo.json
  package.json
```

## Apps

### `apps/web`

React SPA.

Put browser-facing UI and client behavior here:

- routes
- components
- feature UI
- hooks
- TanStack Router configuration
- TanStack Query usage
- React Hook Form forms
- client-side image resize / compression
- PWA manifest and service worker
- URL share-target handling

Do not put server-only secrets, database access, Stripe server calls, R2 signing, or AI provider calls in `apps/web`.

### `apps/api`

Hono API running on Cloudflare Workers.

Put server-side behavior here:

- auth middleware and current-user resolution
- Zod request / response validation
- recipe CRUD route handlers
- URL import route handlers
- image import route handlers
- AI usage-limit checks
- Free / Pro save limits
- recipe lock computation
- authenticated R2 image serving and stable image URL generation
- Stripe Checkout and Customer Portal
- Stripe webhook handling
- Resend integration
- Better Auth integration

Expected internal shape:

```txt
apps/api/src/
  index.ts
  routes/
    auth.ts
    import.ts
    recipes.ts
    images.ts
    billing.ts
    stripe.ts
    me.ts
    usage.ts
  middleware/
    auth.ts
    error.ts
    rate-limit.ts
  lib/
    ai/
    billing/
    image/
    import/
    recipe/
    env.ts
```

## Packages

### `packages/db`

Database schema, migrations, and database client.

Put these here:

- Drizzle schema definitions
- migrations
- Neon client setup
- exported database types

Do not put route handlers or frontend-only code here.

### `packages/schemas`

Zod schemas and API-facing shared types.

Put these here:

- `RecipeContent`
- `RecipeDraftContent`
- import request / response schemas
- recipe request / response schemas
- auth-related schemas
- billing-related schemas

Use these schemas at API boundaries and in frontend forms where applicable.

### `packages/shared`

Shared deterministic logic used by both API and frontend.

Put these here:

- URL normalization
- `searchText` generation
- constants
- plan limit types and values
- source platform detection

Do not put code that requires server-only secrets or Cloudflare bindings here unless it is explicitly isolated from frontend bundles.

### `packages/config`

Shared project configuration.

Put these here:

- tsconfig presets
- Biome config guidance
- any supplemental lint config if Biome is not enough for a specific rule family

## Worker Routing

The Cloudflare Worker serves both API and static assets.

```txt
Cloudflare Worker
  ├─ /api/auth/*          Better Auth
  ├─ /api/import/*        import routes
  ├─ /api/recipes/*       recipe routes
  ├─ /api/images/*        image routes
  ├─ /api/billing/*       billing routes
  ├─ /api/stripe/webhook  Stripe webhook
  └─ *                    static SPA fallback
```

## Placement Rules

- API request / response contracts belong in `packages/schemas`.
- Database schema and migrations belong in `packages/db`.
- Business logic shared by API and web belongs in `packages/shared`.
- Cloudflare binding code, Stripe server code, R2 signing, Resend calls, and AI calls belong in `apps/api`.
- UI state, route loaders, forms, and visual components belong in `apps/web`.
- Repo-wide lint, format, and TypeScript config guidance belongs in `packages/config`.
- The default lint / format tool is Biome. Keep root-level tool config such as `biome.json` thin and aligned with shared guidance in `packages/config`.

If a file seems to fit in multiple places, choose the narrowest package that can own it without importing from a higher-level app.
