# Recipe Stock

Recipe Stock is a PWA for turning recipes from websites, videos, social posts, books, images, and screenshots into one searchable saved format.

## Language

**Recipe**:
A user-owned saved recipe record in the database. A **Recipe** has one **RecipeContent**, source metadata, search text, timestamps, and optional image object keys.
_Avoid_: Recipe draft, recipe JSON, recipe body

**RecipeContent**:
The saved body of a **Recipe**. It contains the title, servings text, ingredient groups, steps, and optional note.
_Avoid_: content blob, recipe record, draft

**RecipeDraftContent**:
Temporary pre-save recipe content shown in the confirmation and edit flow after import or manual creation. It is held in frontend state and is not persisted as a database draft.
_Avoid_: Draft, saved draft, temporary recipe

**Source**:
Metadata describing where a **Recipe** came from, such as the source URL, normalized source URL, and source name. **Source** is stored outside **RecipeContent**.
_Avoid_: Origin, reference, citation

## Example Dialogue

Developer: "Should `sourceName` be part of `RecipeContent`?"

Domain expert: "No. `sourceName` is part of the Source metadata on the Recipe record. RecipeContent only contains the saved recipe body."

Developer: "Can we save a RecipeDraftContent so users can come back later?"

Domain expert: "No. A RecipeDraftContent is temporary pre-save content. The MVP only saves a Recipe after the user confirms."
