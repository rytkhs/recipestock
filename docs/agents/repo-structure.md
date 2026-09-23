# Repo Structure

Agent-facing map for where code should live in this repo.

## Current Top-Level Shape

```txt
recipestock/
  apps/
    api/
    web/
  packages/
    config/
    db/
    schemas/
    shared/
  docs/
    adr/
    agents/
    shortcut/
  .github/
    workflows/
  AGENTS.md
  CONTEXT.md
  README.md
  biome.json
  compose.db-test.yml
  tsconfig.base.json
  pnpm-workspace.yaml
  turbo.json
  package.json
```

Generated artifacts, installed dependencies, and ignored local work directories are omitted.

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
- development-only MSW handlers, fixtures, and scenarios

Do not put server-only secrets, database access, Stripe server calls, R2 signing, or AI provider calls in `apps/web`.

Current internal shape:

```txt
apps/web/src/
  components/
    ui/                  vendored shadcn/ui components
  features/              feature-specific UI and client logic
  lib/                   app-wide browser utilities and API clients
  mocks/                 MSW handlers, fixtures, and scenarios
  pwa/                   service worker and PWA browser behavior
  routes/                TanStack Router route components and configuration
  test/                  shared web test setup and helpers
  main.tsx
  styles.css
```

### `apps/api`

Hono API running on Cloudflare Workers.

Put server-side behavior here:

- auth middleware and current-user resolution
- Zod request / response validation
- recipe CRUD route handlers
- URL and text Import Job submission and lifecycle
- Cloudflare Queue consumption and Import Job processing
- image import route handlers
- AI usage-limit checks
- Free / Pro save limits
- recipe lock computation
- authenticated R2 image serving and stable image URL generation
- Push subscription management and Import Job completion notifications
- iOS Shortcut import and credential management
- Stripe Checkout and Customer Portal
- Stripe webhook handling
- Resend integration
- Better Auth integration
- binding validation and structured logging
- error reporting, cron check-ins, and Import Queue health checks for Sentry

Current internal shape:

```txt
apps/api/src/
  index.ts                Hono app composition plus Worker fetch, queue, and scheduled handlers
  api-error.ts            API error response builders
  context.ts              Hono context types
  env.ts                  Cloudflare binding types and validation
  logger.ts               structured logging
  auth.ts                 Better Auth setup and auth service
  billing.ts              billing repository and plan synchronization
  images.ts               R2 image service
  import-jobs.ts          Import Job repository and queue processing
  import-queue-health.ts  Import Queue stall detection for the cron
  import-url.ts           URL import orchestration
  me.ts                   current-user repository and response mapping
  monitoring.ts           Sentry options, error reporter, and cron check-ins
  push-subscriptions.ts   Push subscription repository
  recipes.ts              recipe repository and response mapping
  shortcut-credentials.ts Shortcut credential repository and service
  stripe-billing.ts       Stripe client
  tags.ts                 tag repository and normalization
  usage.ts                AI usage repository and limits
  routes/
    auth.ts
    billing.ts
    images.ts
    import.ts
    ios-share.ts
    me.ts
    push-subscriptions.ts
    recipes.ts
    shortcut-credentials.ts
    stripe.ts
    tags.ts
    usage.ts
  middleware/
    auth.ts
  lib/
    email/
    import/
      deterministic/
      source-extraction/
```

Most repositories, services, and cross-cutting modules currently live directly under `apps/api/src/`. Do not infer unlisted feature directories such as `lib/recipe/` or `lib/billing/`; they do not exist in the current structure.

## Packages

### `packages/db`

Database schema, migrations, and database client.

Put these here:

- Drizzle schema definitions
- migrations
- Neon client setup
- exported database types
- database-specific scripts and development tools

Do not put route handlers or frontend-only code here.

### `packages/schemas`

Zod schemas and API-facing shared types.

Put these here:

- `RecipeContent`
- `RecipeDraftContent`
- import request / response schemas
- recipe request / response schemas
- billing-related schemas
- limits that belong to an API contract, next to the schema they constrain, whether a schema here validates them (`IMPORT_TEXT_MAX_LENGTH`) or the API enforces them itself (`MAX_TAG_NAME_LENGTH`)

Use these schemas at API boundaries and in frontend forms where applicable.

Better Auth owns the auth endpoints, so auth has no request / response schemas here. Its shared constants live in `packages/shared`.

This package depends on Zod. A module here that needs no Zod is worth a second look: unless it describes the API contract, it belongs in `packages/shared`.

### `packages/shared`

Deterministic logic and constants shared across packages, with no Zod dependency.

Put these here:

- URL normalization
- `searchText` generation
- constants
- plan names, plan limit types, and values
- constants that an API configuration and the UI must agree on, such as password length, OTP length, and email-link expiry
- source platform detection

`packages/schemas` may import from here; this package must not import from `packages/schemas`.

Do not put code that requires server-only secrets or Cloudflare bindings here unless it is explicitly isolated from frontend bundles.

### `packages/config`

Shared project configuration.

Put these here:

- tsconfig presets
- Biome config guidance
- any supplemental lint config if Biome is not enough for a specific rule family

## Worker Routing

The Cloudflare Worker serves the API and static assets from one deployment. `apps/api/src/index.ts` mounts these route groups under the `/api` base path:

```txt
Cloudflare Worker
  ├─ /api/health                  uptime monitoring target (no dependencies)
  ├─ /api/auth/*                  Better Auth
  ├─ /api/images/*                image upload, serving, and thumbnails
  ├─ /api/import/*                Import Job submission and status
  ├─ /api/shortcut/import-jobs    iOS Shortcut import
  ├─ /api/shortcut-credentials/*  iOS Shortcut credentials
  ├─ /api/push-subscriptions      Push subscription management
  ├─ /api/me                      current-user state
  ├─ /api/usage/ai                AI usage
  ├─ /api/billing/*               billing and customer portal
  ├─ /api/stripe/webhook          Stripe webhook
  ├─ /api/recipes/*               recipe CRUD and recipe tags
  ├─ /api/tags/*                  tag management
  └─ *                            static SPA fallback
```

The same Worker also consumes the Import Job queue:

```txt
Import Job request
  -> IMPORT_QUEUE
       -> Worker queue handler
            -> import conversion
            -> Recipe persistence and image finalization
            -> best-effort Push notification
  -> IMPORT_QUEUE dead letter queue
       -> Worker queue handler
            -> mark the Import Job failed and notify

Cron (every 5 minutes)
  -> Worker scheduled handler
       -> IMPORT_QUEUE metrics
       -> Sentry Crons check-in
```

## Placement Rules

- API request / response contracts belong in `packages/schemas`.
- Database schema and migrations belong in `packages/db`.
- Business logic and constants shared across packages belong in `packages/shared`.
- Cloudflare binding code, Stripe server code, R2 signing, Resend calls, and AI calls belong in `apps/api`.
- Worker queue handlers and server-only notification delivery belong in `apps/api`.
- UI state, route loaders, forms, and visual components belong in `apps/web`.
- Repo-wide lint, format, and TypeScript config guidance belongs in `packages/config`.
- The default lint / format tool is Biome. Keep root-level tool config such as `biome.json` thin and aligned with shared guidance in `packages/config`.

If a file seems to fit in multiple places, choose the narrowest package that can own it without importing from a higher-level app.

## Test Placement

- Colocate unit, component, and request tests with the code they cover as `<name>.test.ts` or `<name>.test.tsx`.
- When one module's tests grow large, split them by behavior as `<name>-<aspect>.test.ts` in the same directory, as with `apps/api/src/routes/recipes-create.test.ts` and `recipes-list.test.ts`.
- Request tests for API routes live in `apps/api/src/routes/` and are named by endpoint or behavior, not necessarily by source file.
- Tests that need a real database live in `apps/api/test/db/` as `*.repository.test.ts`. They run with `pnpm test:db` through `vitest.db.config.ts` and are excluded from `pnpm test`.
- Shared test helpers live in `apps/api/src/test-helpers.ts`, `apps/api/src/routes/test-helpers.ts`, and `apps/web/src/test/`. Typed web fixtures live in `apps/web/src/mocks/fixtures.ts`. Reuse them before adding new helpers.
