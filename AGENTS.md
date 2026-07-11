# AGENTS.md

## Repository Context

Recipe Stock is a PWA for converting recipes from websites, YouTube, social posts, books, images, and screenshots into one searchable saved format.

## Communication

- Respond in Japanese by default. Use another language when requested or required by the artifact.
- Use English for code identifiers, file names, types, functions, database columns, API fields, and error codes.
- Treat the user as technically proficient. Lead with the result and omit secondary detail and repetition.
- Do not infer unstated intent, priorities, evaluations, emotions, or background.
- Omit generic introductions, praise, reassurance, obvious context, and evaluative restatements.
- Add code comments only for intent or non-obvious constraints.
- Write commit messages with a short Japanese summary unless requested otherwise.

## Authorization by Request Type

- For explanation, investigation, review, diagnosis, or planning: inspect relevant materials and report the result. Do not modify files or external state. Diagnose the cause before proposing a fix.
- For implementation, changes, builds, or fixes: make the requested in-scope local changes without asking for routine confirmation.

Ask before:

- destructive actions, destructive Git commands, or discarding user work;
- external writes such as pushes, pull requests, deployments, messages, or hosted-service changes;
- purchases, billable operations, credential changes, or production-data changes;
- adding or replacing a major dependency, framework, service, or architectural choice; first explain the reason, affected documentation, migration cost, and implementation impact;
- materially expanding scope.

Sandbox approval required for an already-authorized command is not a reason to stop the task.

Ask a focused question only when the answer cannot be found locally and the choice changes behavior, a contract, a data model, security, cost, or the user-visible result. Otherwise make the smallest reasonable assumption, state it when it affects the result, and continue. Do not guess when required evidence is missing.

## Planning

Before a large or cross-cutting edit, provide a short plan and then proceed unless approval or user input is required. Large changes include new features, database or API contract changes, auth, billing, AI usage limits, production integrations, and cross-package refactors.

Include only relevant items:

- specifications, ADRs, and implementation areas to inspect;
- affected packages, contracts, data flow, or state transitions;
- validation approach;
- failure, security, privacy, migration, and documentation effects;
- open questions that affect implementation.

## Sources of Truth

Read the narrowest relevant sources before changing behavior:

1. `CONTEXT.md` for domain terminology and invariants.
2. `docs/agents/tech-stack.md` for technology and dependency choices.
3. `docs/agents/repo-structure.md` for ownership and file placement.
4. Relevant records under `docs/adr/`.
5. Relevant product and development documents under `docs/dev/`.

Workflow references:

- GitHub Issues are the issue and PRD tracker for `rytkhs/recipestock`; see `docs/agents/issue-tracker.md`.
- Use the labels in `docs/agents/triage-labels.md`.
- Follow `docs/agents/domain.md` for domain documentation.

If code, tests, and documentation disagree and the intended behavior cannot be established from history or adjacent references, ask before changing behavior.

## Implementation Constraints

- Before choosing an implementation, examine the underlying problem, relevant adjacent systems, and plausible alternatives. Prefer a coherent solution that addresses the root cause over the smallest local patch.
- Keep the implementation within the requested scope. Report broader changes separately when they would produce a better result.
- Do not preserve backward compatibility unless requested. Update affected callers and remove superseded code within scope.
- Do not add fallback paths unless a concrete required failure mode justifies them. Fix the primary path instead of masking its failure.
- If a key assumption proves false, the planned approach cannot work, or continuing requires a material design decision, stop before introducing a workaround. Report the evidence, impact, and options, then ask for direction.
- Prefer the existing stack and local patterns. Do not add speculative abstractions, features, or cleanup.
- Keep API schemas, handlers, clients, and tests synchronized.
- Keep database schema, migrations, exported types, and affected queries synchronized.
- Do not hard-code secrets or environment-specific sensitive values.
- Use `rg` or `rg --files` first for repository searches. If a result is empty or suspiciously narrow, try a meaningful alternate query before concluding that nothing exists.

## Verification and Completion

Use the smallest relevant validation first, then expand according to the affected surface:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

- Run tests with escalated permissions because Wrangler or Vitest for Cloudflare Workers may write outside the workspace or bind to localhost.
- Use `pnpm lint:fix` or `pnpm format` only when needed, then inspect the resulting diff.
- After database schema changes, run `pnpm db:generate` and inspect the migration. Run `pnpm db:migrate` only when applying it is part of the request.
- If full validation is too expensive, run targeted tests and relevant package checks. Record why any required validation could not run.
- When changing schemas, URL normalization, search text, content conversion, AI usage counting, Stripe webhook idempotency or plan synchronization, or R2 key or cleanup decisions, add or update focused tests.
- For API changes, test validation, success responses, and relevant errors.
- For frontend changes, preserve existing tokens, components, interaction patterns, responsive behavior, and relevant states. Render and inspect layout, overflow, clipping, spacing, and consistency.

Work is complete when the requested behavior is implemented, affected tests and contracts are updated where needed, relevant checks pass, required documentation or migrations are synchronized, and the final diff contains no unintended changes.

In the final report, state the outcome, validation performed, and any material blockers, assumptions, or unverified items. Do not claim completion while required work remains.
