# AGENTS.md

## Repository Context

Recipe Stock is a PWA for converting recipes from websites, YouTube, social posts, books, images, and screenshots into one searchable saved format.

## Communication

- Respond in Japanese by default. Use another language when requested or required by the artifact.
- Use English for code identifiers, file names, types, functions, database columns, API fields, and error codes.

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

Workflow references:

- GitHub Issues are the issue and PRD tracker for `rytkhs/recipestock`; see `docs/agents/issue-tracker.md`.
- Use the labels in `docs/agents/triage-labels.md`.
- Follow `docs/agents/domain.md` for domain documentation.

If code, tests, and documentation disagree and the intended behavior cannot be established from history or adjacent references, ask before changing behavior.

## Implementation Constraints

- Before choosing an implementation, inspect enough of the underlying problem and adjacent system to avoid a narrowly local fix. Consider plausible alternatives in proportion to the decision's scope and risk, then choose the most coherent solution within the requested scope. Do not narrate routine alternatives unless they materially affect the decision.
- Keep the implementation within the requested scope. Report broader changes separately when they materially affect correctness or the recommended approach.
- Prefer a clean replacement over backward-compatible layering. Do not add deprecated aliases, dual paths, or migration shims without an identified consumer that requires them. Update all controlled callers and remove superseded code within scope. Ask before breaking an external contract or persisted data format.
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
```

- Run test commands with sandbox escalation from the start because most tests require network access, localhost binding, or Cloudflare Workers resources. Type checking, linting, and other commands that do not require these capabilities should use the default sandbox.
- Use `pnpm lint:fix` or `pnpm format` when needed.
- After database schema changes, run `pnpm db:generate` and inspect the migration. Run `pnpm db:migrate` only when applying it is part of the request.
- If full validation is too expensive, run targeted tests and relevant package checks.
- For API changes, test validation, success responses, and relevant errors.

Work is complete when the requested behavior is implemented, affected tests and contracts are updated where needed, relevant checks pass, required documentation or migrations are synchronized, and the final diff contains no unintended changes.

In the final report, state the outcome, validation performed, and any material blockers, assumptions, or unverified items. Do not claim completion while required work remains.
