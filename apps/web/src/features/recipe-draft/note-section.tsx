import { Label, TextArea, TextField } from "@heroui/react";
import { useController } from "react-hook-form";
import { type RecipeDraftFormControl } from "./form-internals";

type NoteSectionProps = {
  control: RecipeDraftFormControl;
};

export const NoteSection = ({ control }: NoteSectionProps) => {
  const { field } = useController({ control, name: "note" });

  return (
    <TextField className="overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm sm:rounded-[18px]">
      <div className="border-brand-line-soft border-b bg-brand-paper-muted/70 px-3.5 py-3 sm:px-5">
        <Label className="font-semibold text-brand-walnut text-sm sm:font-bold sm:text-base">
          メモ
        </Label>
      </div>
      <div className="px-3.5 py-3 sm:px-5">
        <TextArea
          className="min-h-24 rounded-[14px] bg-brand-paper-raised text-sm leading-6 sm:min-h-28 sm:text-base"
          name={field.name}
          placeholder="メモを入力"
          ref={field.ref}
          rows={4}
          value={field.value ?? ""}
          onBlur={field.onBlur}
          onChange={(event) => field.onChange(event.target.value)}
        />
      </div>
    </TextField>
  );
};
