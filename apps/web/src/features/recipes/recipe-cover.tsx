import { type RecipeListItem } from "@recipestock/schemas";
import { cn } from "@/lib/utils";
import { RecipeThumbnail } from "./recipe-thumbnail";

// 本・手入力・テキストだけの取り込みでは表紙画像がないほうが普通なので、
// 空きコマではなく「題簽」として並ぶようにする。題名の一文字を明朝で大きく組み、
// 地の色はidから決めるので、写真がないRecipeも見分けがつく。
const plateTints = ["bg-plate-1", "bg-plate-2", "bg-plate-3", "bg-plate-4", "bg-plate-5"] as const;

const pickPlateTint = (seed: string) => {
  let hash = 5381;

  for (let position = 0; position < seed.length; position += 1) {
    hash = (hash * 33 + seed.charCodeAt(position)) % 2_147_483_647;
  }

  return plateTints[hash % plateTints.length];
};

const readTitleInitial = (title: string) => Array.from(title.trim()).at(0) ?? "無";

export const RecipeTitlePlate = ({ recipeId, title }: { recipeId: string; title: string }) => (
  <span
    aria-hidden="true"
    className={cn("flex size-full items-end justify-start p-[8cqw]", pickPlateTint(recipeId))}
    data-testid="recipe-title-plate"
  >
    <span className="font-semibold text-[30cqw] text-brand-walnut/80 leading-none">
      {readTitleInitial(title)}
    </span>
  </span>
);

export const RecipeCover = ({
  index,
  recipe,
}: {
  index: number;
  recipe: Pick<RecipeListItem, "id" | "title" | "coverImageUrl">;
}) => {
  const plate = <RecipeTitlePlate recipeId={recipe.id} title={recipe.title} />;

  if (!recipe.coverImageUrl) {
    return plate;
  }

  return (
    <RecipeThumbnail alt={recipe.title} fallback={plate} index={index} src={recipe.coverImageUrl} />
  );
};
