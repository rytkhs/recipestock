# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This is a single-context repo for the Recipe Stock MVP.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, if present.
- **`docs/adr/`**, if present. Read ADRs that touch the area you're about to work in.

If `CONTEXT.md` or `docs/adr/` don't exist, proceed silently. Don't flag their absence or suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## Expected structure

```txt
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   └── agents/
└── src/ or apps/ and packages/
```

## Use the glossary's vocabulary

When your output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term as defined in `CONTEXT.md` when it exists. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, either reconsider whether the project actually uses that concept or note the gap for `/grill-with-docs`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding.
