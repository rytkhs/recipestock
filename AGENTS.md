# AGENTS.md

## Repository Context

Recipe Stock is a PWA for converting recipes from websites, YouTube, social posts, books, images, and screenshots into one searchable saved format.

This file contains repository-wide instructions for AI agents. A more specific `AGENTS.md` or `AGENTS.override.md` closer to the working directory takes precedence for that subtree.

## Communication

- Respond to the user in Japanese by default. Use another language when the user requests it or the artifact requires it.
- Use English for code identifiers, file names, type names, function names, database columns, API fields, and error codes.
- Treat the user as technically proficient. Lead with the result and include only the evidence, constraints, trade-offs, and next actions needed to assess it.
- Do not infer unstated business intent, revenue intent, priorities, evaluations, emotions, or background circumstances.
- Omit generic introductions, praise, reassurance, obvious context, and evaluative restatements after a decision.
- Add code comments only when they explain intent or a non-obvious constraint.
- When asked for a commit message, use a short Japanese summary unless the user requests another style.

## Working Agreement

### Read, Review, Diagnose, and Plan

For requests to explain, investigate, review, diagnose, or plan:

- Inspect the relevant code, configuration, documentation, tests, and available evidence.
- Report findings with concrete file or command evidence.
- Do not modify files or external state unless the user also asks for changes.
- For a diagnosis, identify the cause before proposing or implementing a fix.

### Change, Build, and Fix

For requests to implement, change, build, or fix:

- Make the requested in-scope local changes without asking for routine confirmation.
- Inspect existing implementations, nearby tests, and relevant project documentation before editing.
- Update affected callers, contracts, tests, and documentation together. Do not add compatibility shims unless the user requests them.
- Run relevant non-destructive validation and review the final diff before reporting completion.
- Preserve user changes and leave unrelated files untouched.

### Approval Boundaries

Ask for confirmation before:

- destructive actions or discarding user work;
- external writes such as pushes, pull requests, deployments, messages, or changes to hosted services;
- purchases, billable operations, credential changes, or production data changes;
- adding or replacing a major dependency, framework, service, or architectural choice;
- materially expanding the requested scope.

Sandbox permission prompts required to run an already-authorized in-scope command are execution approvals, not a reason to stop the task.

### Ambiguity and Assumptions

- Ask a focused question only when the answer cannot be found locally and different choices would materially change behavior, an API contract, a data model, security, cost, or the user-visible result.
- Otherwise, make the smallest reasonable assumption, state it when it affects the result, and continue.
- Do not guess when required evidence is missing. Narrow the conclusion or report what remains unverified.

## Planning

Before editing for a large or cross-cutting change, provide a short implementation plan. Large changes include new features, database or API contract changes, auth, billing, AI usage limits, production integrations, and cross-package refactors.

Include only what applies:

- specifications, ADRs, and implementation files to inspect;
- packages, contracts, data flow, or state transitions likely to change;
- test and verification approach;
- failure behavior and relevant security or privacy effects;
- specification, migration, or ADR updates;
- open questions that materially affect implementation.

Proceed after the plan unless an approval boundary or material open question requires user input. Small, focused changes may be implemented directly.

## Sources of Truth

Read the narrowest relevant documentation before changing behavior:

1. `CONTEXT.md` for domain terminology and invariants.
2. `docs/agents/tech-stack.md` for approved technologies and dependency guidance.
3. `docs/agents/repo-structure.md` for ownership and file placement.
4. Relevant ADRs under `docs/adr/` for accepted architectural decisions.
5. Relevant product and development documents under `docs/dev/`.

Project workflow references:

- GitHub Issues are the issue and PRD tracker for `rytkhs/recipestock`; see `docs/agents/issue-tracker.md`.
- Use the five-label triage vocabulary in `docs/agents/triage-labels.md`.
- Follow the domain documentation workflow in `docs/agents/domain.md`.

If code and documentation disagree, do not silently choose one. Determine which is authoritative from tests, history, and adjacent references, then report or resolve the discrepancy within scope.

## Architecture Constraints

- Follow `docs/agents/tech-stack.md` and `docs/agents/repo-structure.md` rather than duplicating their rules here.
- Prefer the existing stack and local patterns before introducing a new abstraction or dependency.
- Keep API request and response schemas, handlers, clients, and tests synchronized.
- Keep database schema, generated migrations, exported types, and affected queries synchronized.
- Do not hard-code secrets or environment-specific sensitive values.
- Before changing a major stack choice, explain the reason, affected documentation, migration cost, and implementation impact, and obtain confirmation.

## Editing and Tool Use

- Use `rg` or `rg --files` first for repository search when available.
- Resolve prerequisite discovery and validation before acting; do not skip them because the intended change seems obvious.
- Parallelize independent reads when useful. Keep dependent steps sequential and synthesize findings before editing.
- If a search result is empty or suspiciously narrow, try a meaningful alternate query or location before concluding that nothing exists.
- Keep changes scoped. Do not add speculative features, abstractions, fallbacks, or cleanup.
- If a fallback is required for a concrete failure mode, make the trigger explicit and explain the reason.
- Never discard or overwrite unrelated user changes. Do not use destructive Git commands unless explicitly requested and approved.

## Testing and Verification

Use the smallest relevant validation first, then expand according to the affected surface.

### Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

- Use `pnpm lint:fix` or `pnpm format` only when changes are needed, then inspect the resulting diff.
- Run test commands with escalated permissions because Wrangler or Vitest for Cloudflare Workers may write outside the workspace or bind to localhost.
- Use `pnpm db:generate` after database schema changes and inspect the generated migration.
- Run `pnpm db:migrate` only when applying a migration is part of the user's requested environment change.
- If full validation is too expensive, run targeted tests plus the relevant package checks.
- If a required command is unavailable or cannot run, report the reason and the remaining unverified risk.

### Change-Specific Checks

- Prefer focused tests for schemas, URL normalization, search text generation, `RecipeContent` / `RecipeDraftContent` conversion, AI usage counting, Stripe webhook idempotency and plan synchronization, and R2 object-key conversion or cleanup decisions.
- For API changes, test validation, success responses, and relevant error responses.
- For database changes, verify migration output and affected read/write paths.
- For frontend changes, preserve existing design tokens, components, interaction patterns, responsive behavior, and relevant loading, empty, error, and disabled states.
- Render and inspect visual changes for layout, overflow, clipping, spacing, and consistency before finalizing.

### Definition of Done

A change is complete when:

- the requested behavior is implemented without unrelated scope;
- relevant tests are added or updated and the appropriate checks pass;
- affected contracts, migrations, documentation, and ADRs are synchronized;
- the final diff has been reviewed for regressions and unintended changes;
- any unrun validation, unresolved blocker, or remaining risk is stated explicitly.

## Final Report

Lead with the outcome. Summarize:

- what changed;
- validation performed and its result;
- blockers, assumptions, or unverified items that materially affect the result.

Do not claim completion when required work remains.
