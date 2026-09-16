import { MAX_RECIPE_NOTE_LENGTH } from "@recipestock/schemas";
import { useId } from "react";
import { useController } from "react-hook-form";
import { cn } from "@/lib/utils";
import { RecipeSectionHeader } from "../recipes/recipe-detail-section";
import { draftInlineFieldClass, type RecipeDraftFormControl } from "./form-internals";

type NoteSectionProps = {
  control: RecipeDraftFormControl;
};

export const NoteSection = ({ control }: NoteSectionProps) => {
  const { field } = useController({ control, name: "note" });
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <RecipeSectionHeader id={headingId} title="メモ" />
      <textarea
        aria-labelledby={headingId}
        className={cn(draftInlineFieldClass, "field-sizing-content mt-2 min-h-24 leading-7")}
        maxLength={MAX_RECIPE_NOTE_LENGTH}
        name={field.name}
        placeholder="コツや、次に作るときに変えたいこと"
        ref={field.ref}
        rows={3}
        value={field.value ?? ""}
        onBlur={field.onBlur}
        onChange={(event) => field.onChange(event.target.value)}
      />
    </section>
  );
};
