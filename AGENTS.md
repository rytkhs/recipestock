# AGENTS.md

## Project Role

This file defines how AI agents should work in this repository.

Recipe Stock is a PWA for saving recipes from recipe websites, YouTube, social posts, books, images, and screenshots into a unified format that can be searched and viewed later.

## Communication

- Respond to the user in Japanese by default.
- Use English for code identifiers, file names, type names, function names, database columns, API fields, and error codes.
- Add comments only when they explain intent or a non-obvious constraint.
- When asked to write commit messages, use a short Japanese summary unless the user requests another style.

## Response and Explanation Policy

Treat the user as technically proficient.

### 1. Do not add obvious context

Do not state cautions, general principles, or introductory explanations that can reasonably be assumed from the user’s message.

#### Prohibited

* Explaining constraints that follow directly from the user’s design as “important,” “key,” or “something to note.”
* Adding implementation considerations that a competent engineer would normally account for when the user did not ask about them.

#### When constraints may be stated

State a constraint only when all of the following apply:

* The user’s proposal clearly breaks or cannot work as described.
* There is a non-obvious constraint involving an external API, legal requirements, billing, or security.
* The constraint changes the next design decision.
* Explaining the constraint directly affects a concrete implementation step.

### 2. Do not append evaluative reinforcement after a decision

After stating a design decision, do not add a sentence that evaluates, emphasizes, or generally justifies that decision.

#### Prohibited

When a policy is complete as “Do A,” do not follow it with statements such as:

* 「〜しないことが重要です」
* 「〜を避けるべきです」
* 「重要なのは〜」

State reasons or trade-offs only when they are necessary for comparing options, explaining constraints, or resolving an implementation branch. Otherwise, end with the decision.

### 3. Do not infer unstated intent

Do not infer or state any of the following unless the user explicitly provides them:

* Business intent
* Revenue intent
* Priorities
* Evaluations
* Emotions
* Background circumstances

## Work Planning

For larger changes, present a short implementation plan before editing. Include:

- which docs you read or will read
- which files or packages you expect to touch
- the test and verification approach
- whether any specification or ADR update may be needed

Large changes include new features, database changes, API contract changes, billing changes, auth changes, AI usage-limit changes, and cross-package refactors.

Small changes may be implemented directly. Examples include typo fixes, narrow documentation edits, focused tests, and obvious local bug fixes.

## Basic Policy

* Prioritize clean implementation.
* When editing, do not preserve backward compatibility; assume breaking changes.
* Process only within the instructed scope.
* Do not add unnecessary implementations.
* Ask for confirmation when there are unclear points or important decisions to make.

## Fallbacks

* Do not implement redundant fallbacks.
* If implementing a fallback, clearly state the reason for doing so.

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

After making changes, run the relevant package checks and verification scripts:

### Key Commands

- Typecheck:
  ```bash
  pnpm typecheck
  ```
- Lint & Formatting:
  ```bash
  pnpm lint
  ```
  ```bash
  pnpm lint:fix
  ```
- Tests:
  ```bash
  pnpm test
  ```
  Run all test commands with escalated permissions. Some test runners, such as Wrangler/Vitest for Cloudflare Workers, need to write logs outside the workspace and listen on localhost.
- Build Validation:
  ```bash
  pnpm build
  ```
- Development Server:
  ```bash
  pnpm dev
  ```

If the commands are not set up yet or cannot be run, say that explicitly in the final report.

### Database Commands (Drizzle ORM)

If you modify the database schema or need to run migrations:

- Generate migrations:
  ```bash
  pnpm db:generate
  ```
- Apply migrations:
  ```bash
  pnpm db:migrate
  ```

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
