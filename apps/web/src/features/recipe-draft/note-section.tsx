import { useId } from "react";
import { useController } from "react-hook-form";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { type RecipeDraftFormControl } from "./form-internals";

type NoteSectionProps = {
  control: RecipeDraftFormControl;
};

export const NoteSection = ({ control }: NoteSectionProps) => {
  const { field } = useController({ control, name: "note" });
  const noteId = useId();

  return (
    <FieldGroup>
      <Field className="gap-0 overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm sm:rounded-[18px]">
        <div className="border-brand-line-soft border-b bg-brand-paper-muted/70 px-3.5 py-3 sm:px-5">
          <FieldLabel htmlFor={noteId}>メモ</FieldLabel>
        </div>
        <div className="px-3.5 py-3 sm:px-5">
          <Textarea
            id={noteId}
            name={field.name}
            placeholder="メモを入力"
            ref={field.ref}
            rows={4}
            value={field.value ?? ""}
            onBlur={field.onBlur}
            onChange={(event) => field.onChange(event.target.value)}
          />
        </div>
      </Field>
    </FieldGroup>
  );
};
