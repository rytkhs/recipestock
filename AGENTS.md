# AGENTS.md

## Project Role

This file defines how AI agents should work in this repository.

Recipe Stock is a PWA for saving recipes from recipe websites, YouTube, social posts, books, images, and screenshots into a unified format that can be searched and viewed later. The MVP focuses on the shortest path through import, confirmation/editing, saving, search, and viewing.

It is not the product specification. Product and technical requirements live under `docs/dev/`; keep this file focused on working rules, review expectations, and repository conventions.

## Communication

- Respond to the user in Japanese by default.
- Use English for code identifiers, file names, type names, function names, database columns, API fields, and error codes.
- Add comments only when they explain intent or a non-obvious constraint.
- When asked to write commit messages, use a short Japanese summary unless the user requests another style.
- Write PR descriptions and issue bodies in Japanese, including related docs and verification results.

## Work Planning

For larger changes, present a short implementation plan before editing. Include:

- which docs you read or will read
- which files or packages you expect to touch
- the test and verification approach
- whether any specification or ADR update may be needed

Large changes include new features, database changes, API contract changes, billing changes, auth changes, AI usage-limit changes, and cross-package refactors.

Small changes may be implemented directly. Examples include typo fixes, narrow documentation edits, focused tests, and obvious local bug fixes.

## Architecture Guardrails

Follow the architecture in `/docs/agents/tech-stack.md`.

Follow the repository placement rules in `/docs/agents/repo-structure.md`.

Current stack summary:

- Frontend: Vite + React + TypeScript
- Routing: TanStack Router
- Server state: TanStack Query
- Forms and validation: React Hook Form + Zod
- API: Hono + Hono RPC client
- Database: Neon PostgreSQL + Drizzle ORM
- Storage and deploy target: Cloudflare Workers + Cloudflare R2
- Auth: Better Auth
- Email: Resend
- Billing: Stripe
- AI: Vercel AI SDK + Cloudflare AI Gateway
- Repository shape: pnpm workspace + Turborepo

Repository structure summary:

- `apps/web`: browser-facing React SPA, routes, UI, hooks, forms, PWA behavior, and client-only import helpers
- `apps/api`: Hono API on Cloudflare Workers, auth, validation, recipe/import/image/billing routes, integrations, and server-only logic
- `packages/db`: Drizzle schema, migrations, Neon client setup, and exported database types
- `packages/schemas`: Zod schemas and shared API-facing request/response/content types
- `packages/shared`: deterministic logic shared by API and frontend, such as URL normalization, search text generation, constants, and plan limits
- `packages/config`: shared TypeScript, lint, and formatting configuration

Before adding, replacing, or bypassing these choices, explain the reason, affected docs, migration cost, and implementation impact.

## Testing And Verification

After changes, run the relevant package checks when available:

- typecheck
- lint
- tests
- focused manual or browser verification for UI flows

If the commands are not set up yet or cannot be run, say that explicitly in the final report.

Prefer unit tests around shared logic and boundary-heavy behavior:

- Zod schemas
- URL normalization
- search text generation
- `RecipeContent` / `RecipeDraftContent` conversion
- AI usage counting
- Stripe webhook idempotency and plan synchronization
- R2 object key conversion and cleanup decisions

For API contract changes, keep request/response schemas and handlers in sync and test both validation and error responses.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `rytkhs/recipestock`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repo uses the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo. Read the root `CONTEXT.md` and `docs/adr/` when present; detailed product docs live under `docs/dev/`. See `docs/agents/domain.md`.
