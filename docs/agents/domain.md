# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This is a single-context repo for KitchenCat (project name: `recipestock`).

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`**. Read ADRs that touch the area you're about to work in.

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

An ADR records a past decision and its reasons; it is not a specification that later work must fit into. If an ADR's premise no longer holds or its decision looks wrong for the task at hand, point that out and propose revisiting it instead of working around it.

## Writing ADRs

Write an ADR only when all three are true:

1. **Hard to reverse**: changing the decision later has a meaningful cost.
2. **Surprising without context**: a future reader would wonder why it was done this way.
3. **The result of a real trade-off**: there were genuine alternatives and one was chosen for specific reasons.

Do not write an ADR as a side effect of implementation. Propose it to the user with the reason it meets the three criteria, and write it only after they agree.

These do not belong in an ADR: implementation specifications, field-level API details, measurements, UI behavior, and copy or wording policy. Keep them in code, tests, `docs/`, or the GitHub Issue instead.

Follow `.claude/skills/domain-modeling/ADR-FORMAT.md`: a few sentences, plus rejected alternatives or consequences only when they add real value.
