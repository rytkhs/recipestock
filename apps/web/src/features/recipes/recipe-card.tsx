import { DotsThreeVertical, LockSimple, PencilSimple, Trash } from "@phosphor-icons/react";
import { type RecipeListItem } from "@recipestock/schemas";
import { FREE_RECIPE_LIMIT } from "@recipestock/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { RecipeCover } from "./recipe-cover";
import { formatRecipeUpdatedAt } from "./recipe-shelf";
import { type RecipeViewMode } from "./view-mode";

const coverClass = "@container relative aspect-[4/3] w-full overflow-hidden bg-brand-paper-muted";
const titleClass = "line-clamp-2 font-semibold text-[15px] leading-[1.45] sm:text-base";
const metaClass = "truncate text-[11px] text-brand-muted sm:text-xs";
// タッチではhoverがないので常時出す。ポインタのある画面だけ、写真の上から消しておく。
const actionMenuClass =
  "opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 sm:data-popup-open:opacity-100";

const RecipeCardActionMenu = ({
  className,
  onDelete,
  recipeId,
  title,
  triggerClassName,
}: {
  className: string;
  onDelete: () => void;
  recipeId: string;
  title: string;
  triggerClassName: string;
}) => {
  const navigate = useNavigate();

  return (
    <div className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${title}の操作メニュー`}
          className={cn(actionMenuClass, triggerClassName)}
          render={<Button size="icon-sm" variant="ghost" />}
        >
          <DotsThreeVertical weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-36">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                void navigate({ to: "/recipes/$recipeId/edit", params: { recipeId } });
              }}
            >
              <PencilSimple weight="bold" />
              <span>編集</span>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash weight="bold" />
              <span>削除</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const LockedBadge = () => (
  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-brand-paper/85 py-1 font-medium text-[10px] text-brand-muted backdrop-blur-[2px] sm:text-xs">
    <LockSimple size={11} weight="bold" />
    ロック中
  </span>
);

export const LockedShelfNotice = () => (
  <div className="col-span-full flex flex-col items-start gap-3 rounded-[14px] border border-brand-line border-dashed bg-brand-paper-muted/60 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
    <div className="min-w-0 flex-1">
      <p className="font-semibold text-brand-walnut text-sm">ここから先はロック中</p>
      <p className="mt-0.5 text-brand-muted text-xs">
        フリープランで開けるのは、最近使った{FREE_RECIPE_LIMIT}件までです。
      </p>
    </div>
    <Link
      className={cn(buttonVariants({ size: "sm", variant: "outline" }), "no-underline")}
      to="/settings/billing"
    >
      プランを見る
    </Link>
  </div>
);

export const RecipeCard = ({
  index,
  onDelete,
  recipe,
  viewMode,
}: {
  index: number;
  onDelete: (recipeId: string) => void;
  recipe: RecipeListItem;
  viewMode: RecipeViewMode;
}) => {
  const isList = viewMode === "list";
  const updatedAtLabel = formatRecipeUpdatedAt(recipe.updatedAt);
  const meta = isList
    ? [recipe.sourceName, updatedAtLabel].filter(Boolean).join(" · ")
    : recipe.sourceName;
  const cover = (
    <div
      className={cn(coverClass, isList ? "w-20 shrink-0 rounded-[10px] sm:w-24" : "rounded-[14px]")}
    >
      <div className={cn("size-full", recipe.locked && "opacity-60 grayscale-[0.45]")}>
        <RecipeCover index={index} recipe={recipe} />
      </div>
      {recipe.locked ? <LockedBadge /> : null}
    </div>
  );
  const body = (
    <div className="min-w-0 flex-1">
      <h3
        className={cn(
          titleClass,
          !isList && "mt-2.5",
          recipe.locked ? "text-brand-muted" : "text-brand-ink",
        )}
      >
        {recipe.title}
      </h3>
      {meta ? <p className={cn(metaClass, "mt-1")}>{meta}</p> : null}
    </div>
  );

  if (recipe.locked) {
    return (
      <article
        className={cn("relative flex min-w-0", isList ? "items-center gap-3 py-3" : "flex-col")}
      >
        {cover}
        {body}
      </article>
    );
  }

  return (
    <article
      className={cn("group relative flex min-w-0", isList ? "items-center gap-3 py-3" : "flex-col")}
    >
      <Link
        className={cn(
          "min-w-0 rounded-[16px] no-underline outline-none focus-visible:outline-2 focus-visible:outline-brand-orange focus-visible:outline-offset-2",
          isList ? "flex flex-1 items-center gap-3" : "block",
        )}
        params={{ recipeId: recipe.id }}
        to="/recipes/$recipeId"
      >
        {cover}
        {body}
      </Link>
      <RecipeCardActionMenu
        className={cn(isList ? "shrink-0" : "absolute top-1.5 right-1.5")}
        onDelete={() => onDelete(recipe.id)}
        recipeId={recipe.id}
        title={recipe.title}
        triggerClassName={
          isList
            ? "text-brand-muted"
            : "bg-brand-ink/30 text-white backdrop-blur-[2px] hover:bg-brand-ink/50 hover:text-white"
        }
      />
    </article>
  );
};
