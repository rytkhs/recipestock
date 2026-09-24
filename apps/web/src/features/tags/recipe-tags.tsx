import { Plus } from "@phosphor-icons/react";
import { type RecipeTag } from "@recipestock/schemas";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { isPendingTagId, RecipeTagSheet, useDisplayedRecipeTags } from "./recipe-tag-sheet";
import { tagChipClass } from "./tag-chip";

// 詳細のタイトルの下に置くタグの行。タグを押すとそのタグで絞った一覧を開く。
export const RecipeTags = ({
  recipeId,
  recipeTitle,
  tags: savedTags,
}: {
  recipeId: string;
  recipeTitle: string;
  tags: readonly RecipeTag[];
}) => {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const tags = useDisplayedRecipeTags(recipeId, savedTags);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {tags.map((tag) =>
          isPendingTagId(tag.id) ? (
            <span className={tagChipClass()} key={tag.id}>
              {tag.name}
            </span>
          ) : (
            <Link className={tagChipClass()} key={tag.id} search={{ tags: [tag.id] }} to="/recipes">
              {tag.name}
            </Link>
          ),
        )}
        <button
          aria-label={tags.length > 0 ? "タグを編集" : "タグを付ける"}
          className={cn(tagChipClass(), "border-dashed text-brand-muted")}
          type="button"
          onClick={() => setIsSheetOpen(true)}
        >
          <Plus weight="bold" />
          タグ
        </button>
      </div>
      <RecipeTagSheet
        onOpenChange={setIsSheetOpen}
        open={isSheetOpen}
        recipeId={recipeId}
        recipeTitle={recipeTitle}
        tags={tags}
      />
    </>
  );
};
