# Recipe Stock

Recipe Stock is a PWA for turning recipes from websites, videos, social posts, and books into one searchable saved format. Image and screenshot imports are out of scope for now.

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

**Tag**:
A user-owned label attached to **Recipes** to narrow the recipe list. Tags form the user's vocabulary: a **Tag** exists independently of any **Recipe** and is renamed, merged, or deleted as a whole. The vocabulary is kept in an order the user decides; it does not change with how many **Recipes** carry a **Tag**. A **Tag** is not part of **RecipeContent** or **Source**.
_Avoid_: Category, Folder, Label

**Locked Recipe**:
A **Recipe** whose content a Free user cannot read or edit because they hold more **Recipes** than the Free plan allows, which happens only after returning from Pro. The newest saved **Recipes** up to the Free limit stay open and the rest are locked. A **Locked Recipe** is not deleted, lock state is not stored, and editing a **Recipe** does not change which **Recipes** are locked.
_Avoid_: Hidden recipe, disabled recipe

**Import Job**:
A user-requested attempt to create one **Recipe** from an external source, such as a URL or pasted text. An **Import Job** may finish successfully, fail, or be canceled before producing a **Recipe**.
_Avoid_: Import task, background import

**Source Text**:
The text a user pastes to create a **Recipe** through an **Import Job**.
_Avoid_: Raw text, original text, text draft

**Import Cancellation**:
A user's request that an active **Import Job** must not produce a **Recipe**. Cancellation does not imply that already-started external processing stops immediately.
_Avoid_: Dismiss, close, force stop

**AI Import Limit**:
The monthly cap on **Import Jobs** read with AI; imports read without AI do not count, but once the cap is reached no **Import Job** is accepted until the month resets. Users see it as the limit on 「AI取り込み」 (the Free cap as a number, the Pro cap only as generous) and never see how many they have used, because uncounted imports would make that number disagree with what they imported.
_Avoid_: Import count, remaining imports, 取り込み回数, AI利用回数

## Example Dialogue

Developer: "Should `sourceName` be part of `RecipeContent`?"

Domain expert: "No. `sourceName` is part of the Source metadata on the Recipe record. RecipeContent only contains the saved recipe body."

Developer: "Can we save a RecipeDraftContent so users can come back later?"

Domain expert: "No. A RecipeDraftContent is pre-save content, not a saved draft."

Developer: "The AI request may still be running. Is the Import Job really canceled?"

Domain expert: "Yes. Import Cancellation guarantees that the Import Job will not produce a Recipe, not that external processing stops immediately."
