# Recipe Stock

Recipe Stock is a PWA for turning recipes from websites, videos, social posts, books, images, and screenshots into one searchable saved format.

## Language

**Recipe**:
A user-owned saved recipe record in the database. A **Recipe** has one **RecipeContent**, source metadata, search text, timestamps, and optional image object keys.
_Avoid_: Recipe draft, recipe JSON, recipe body

**RecipeContent**:
The saved body of a **Recipe**. It contains the title, yield text, reference images, ingredient groups, steps, and optional note.
**referenceImages** are recipe-level images that are not a cover image and are not tied to a specific step. They may be user-added or extracted from the original page or post. They belong to **RecipeContent**, not **Source** metadata.
_Avoid_: content blob, recipe record, draft

**RecipeDraftContent**:
Pre-save recipe content used as the request body for creating or updating a **Recipe** and as the intermediate output of import conversion before image finalization. It is not persisted as a database draft.
_Avoid_: Draft, saved draft, temporary recipe

**Source**:
Metadata describing where a **Recipe** came from, such as the source URL, normalized source URL, and source name. **Source** is stored outside **RecipeContent**.
_Avoid_: Origin, reference, citation

**Import Job**:
A user-requested attempt to create one **Recipe** from an external source. An **Import Job** may finish successfully, fail, or be canceled before producing a **Recipe**.
_Avoid_: Import task, background import

**Import Cancellation**:
A user's request that an active **Import Job** must not produce a **Recipe**. Cancellation does not imply that already-started external processing stops immediately.
_Avoid_: Dismiss, close, force stop

## Example Dialogue

Developer: "Should `sourceName` be part of `RecipeContent`?"

Domain expert: "No. `sourceName` is part of the Source metadata on the Recipe record. RecipeContent only contains the saved recipe body."

Developer: "Can we save a RecipeDraftContent so users can come back later?"

Domain expert: "No. A RecipeDraftContent is pre-save content, not a saved draft."

Developer: "The AI request may still be running. Is the Import Job really canceled?"

Domain expert: "Yes. Import Cancellation guarantees that the Import Job will not produce a Recipe, not that external processing stops immediately."
