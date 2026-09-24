import { PencilSimple, Plus } from "@phosphor-icons/react";
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
        {/* 付いていないうちは付けるきっかけとして名前を出し、付いた後は外すのもここだと分かる「編集」にする。
            タグのチップは絞った一覧へのリンクなので、押して外すことはできない。 */}
        {tags.length > 0 ? (
          <button
            aria-label="タグを編集"
            className={cn(tagChipClass(), "text-brand-muted")}
            type="button"
            onClick={() => setIsSheetOpen(true)}
          >
            <PencilSimple weight="bold" />
            編集
          </button>
        ) : (
          <button
            className={cn(tagChipClass(), "border-dashed text-brand-muted")}
            type="button"
            onClick={() => setIsSheetOpen(true)}
          >
            <Plus weight="bold" />
            タグを付ける
          </button>
        )}
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
