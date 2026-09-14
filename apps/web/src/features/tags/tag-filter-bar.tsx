import { PencilSimple } from "@phosphor-icons/react";
import { type TagWithCount } from "@recipestock/schemas";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { tagChipClass } from "./tag-chip";

// 一覧のツールバーの2行目。チップを押すたびに条件を切り替え、並びは押しても動かさない。
// fieldsetは既定で中身の幅より縮まないので、min-w-0で横スクロールできるようにする。
// fieldsetの既定のmarginはpreflightが消す。m-0を足すとcnが-mx-4を落とし、モバイルでチップ列がずれる。
export const TagFilterBar = ({
  className,
  onToggleTag,
  onToggleUntagged,
  selectedTagIds,
  tags,
  untagged,
}: {
  className?: string;
  onToggleTag: (tagId: string) => void;
  onToggleUntagged: () => void;
  selectedTagIds: readonly string[];
  tags: readonly TagWithCount[];
  untagged: boolean;
}) => (
  <fieldset
    aria-label="タグで絞り込む"
    className={cn(
      "-mx-4 flex min-w-0 gap-2 overflow-x-auto border-0 px-4 py-0 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 [&::-webkit-scrollbar]:hidden",
      className,
    )}
  >
    {tags.map((tag) => {
      const isSelected = selectedTagIds.includes(tag.id);

      return (
        <button
          aria-pressed={isSelected}
          className={tagChipClass(isSelected)}
          key={tag.id}
          type="button"
          onClick={() => onToggleTag(tag.id)}
        >
          {tag.name}
        </button>
      );
    })}
    <button
      aria-pressed={untagged}
      className={tagChipClass(untagged)}
      type="button"
      onClick={onToggleUntagged}
    >
      タグなし
    </button>
    <Link aria-label="タグを管理" className={cn(tagChipClass(), "text-brand-muted")} to="/tags">
      <PencilSimple weight="bold" />
      編集
    </Link>
  </fieldset>
);
