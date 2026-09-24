import { PencilSimple } from "@phosphor-icons/react";
import { type TagWithCount } from "@recipestock/schemas";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { tagChipClass } from "./tag-chip";

// 最初に選んでいるチップが画面の外にあれば、チップ列の先頭に来るまで送る。見えていれば動かさない。
const revealFirstSelectedChip = (bar: HTMLElement) => {
  const chip = bar.querySelector<HTMLElement>('[aria-pressed="true"]');

  if (!chip) {
    return;
  }

  const barRect = bar.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();

  if (chipRect.left >= barRect.left && chipRect.right <= barRect.right) {
    return;
  }

  const paddingLeft = Number.parseFloat(getComputedStyle(bar).paddingLeft) || 0;
  bar.scrollLeft += chipRect.left - barRect.left - paddingLeft;
};

// 一覧のツールバーの2行目。チップを押すたびに条件を切り替え、並びは押しても動かさない。
// fieldsetは既定で中身の幅より縮まないので、min-w-0で横スクロールできるようにする。
// fieldsetの既定のmarginはpreflightが消す。m-0を足すとcnが-mx-4を落とし、モバイルでチップ列がずれる。
export const TagFilterBar = ({
  className,
  isTagsLoaded,
  onToggleTag,
  onToggleUntagged,
  selectedTagIds,
  tags,
  untagged,
}: {
  className?: string;
  // この画面を開いてから読んだタグ一覧が届いたか。読み直している間はキャッシュの古い一覧が並ぶ。
  isTagsLoaded: boolean;
  onToggleTag: (tagId: string) => void;
  onToggleUntagged: () => void;
  selectedTagIds: readonly string[];
  tags: readonly TagWithCount[];
  untagged: boolean;
}) => {
  const barRef = useRef<HTMLFieldSetElement>(null);

  // 一覧を開き直すとチップ列は先頭に戻り、選んでいるチップが画面の外に隠れて、絞り込み中だと分からなくなる。
  // タグ一覧を読み直したときに一度だけ、最初に選んでいるチップを見える位置へ送る。押したチップはもう見えているので、選び直しでは動かさない。
  // ページの縦の位置は戻る操作で復元するので、scrollIntoViewは使わずチップ列の横スクロールだけを動かす。
  // キャッシュの一覧で送ると、読み直して前に増えたチップ（詳細で付けたばかりのタグなど）に選んでいるチップが押し出される。
  // チップの幅はWebフォントに差し替わると広がり、見えていたチップが外に押し出されるので、読み込み後にもう一度見る。
  useLayoutEffect(() => {
    const bar = barRef.current;

    if (!isTagsLoaded || !bar) {
      return;
    }

    revealFirstSelectedChip(bar);

    let isCurrent = true;
    void document.fonts.ready.then(() => {
      if (isCurrent) {
        revealFirstSelectedChip(bar);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [isTagsLoaded]);

  return (
    <fieldset
      aria-label="タグで絞り込む"
      className={cn(
        "-mx-4 flex min-w-0 gap-2 overflow-x-auto border-0 px-4 py-0 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 [&::-webkit-scrollbar]:hidden",
        className,
      )}
      ref={barRef}
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
};
