# Tech Stack

Agent-facing summary of the technology choices for this repo.

## Runtime Shape

The frontend static assets and API are served by the same Cloudflare Worker.

```txt
Browser / PWA
  -> Cloudflare Worker
       -> static Vite React SPA
       -> /api/* Hono API
            -> Neon PostgreSQL
            -> Cloudflare R2
            -> Better Auth
            -> Resend
            -> Stripe
            -> Vercel AI SDK + Workers AI + Cloudflare AI Gateway
```

## Chosen Technologies

| Area | Choice |
| --- | --- |
| Frontend | Vite + React + TypeScript |
| Routing | TanStack Router |
| Server state | TanStack Query |
| Forms | React Hook Form + Zod |
| API | Hono |
| API type sharing | Hono RPC client |
| Deploy target | Cloudflare Workers |
| Database | Neon PostgreSQL |
| ORM | Drizzle ORM |
| Database connection | `@neondatabase/serverless` |
| Image storage | Cloudflare R2 |
| Auth | Better Auth |
| Email | Resend |
| Billing | Stripe |
| AI | Vercel AI SDK + workers-ai-provider + Cloudflare Workers AI + Cloudflare AI Gateway |
| PWA | Web App Manifest + Workbox via `vite-plugin-pwa` `injectManifest` |
| Monorepo | pnpm workspace + Turborepo |
| Lint / Format | Biome |
| Unit / Component / Request tests | Vitest + Testing Library |
| E2E tests | Deferred for the initial setup |

## Dependency Guidance

- Prefer the chosen stack before adding a new library.
- Put shared validation and API types in `packages/schemas`.
- Put shared deterministic business logic in `packages/shared`.
- Use Zod for request and response validation at API boundaries.
- Use Drizzle for database schema and migrations.
- Use TanStack Query for server state in the frontend.
- Use React Hook Form + Zod for forms.
- Use Biome for repository-wide formatting and baseline linting.
- Use Vitest for unit tests, component tests, and request-level API tests.
- Use Testing Library with Vitest for React component behavior tests.
- Do not set up E2E testing in the initial project setup. Add Playwright later only when end-to-end coverage becomes necessary.
- Add ESLint only if a concrete rule need appears that Biome does not cover, such as advanced React Hooks or type-aware linting.

Before adding, replacing, or bypassing a major stack choice, explain the reason, affected docs, migration cost, and implementation impact.

## Environment And Secrets

Do not hard-code secrets or environment-specific values.

Expected sensitive values include:

- `DATABASE_URL`
- Resend API key
- Stripe secret key
- Stripe webhook secret
- Stripe Price ID
- AI model names
- Cloudflare bindings and secrets

Store secrets in the platform or local environment configuration, not in source files or documentation.
