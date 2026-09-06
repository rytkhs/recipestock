export const parseRecipeImageKey = (objectKey: string) => {
  const parts = objectKey.split("/");
  if (
    parts.length !== 4 ||
    parts[0] !== "recipes" ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes("\\") ||
        Array.from(part).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
    ) ||
    !/\.(jpg|jpeg|png|webp)$/i.test(parts[3] ?? "")
  )
    return null;
  return { userId: parts[1], recipeId: parts[2], fileName: parts[3] };
};

export const recipeThumbnailPrefix = (objectKey: string) => {
  const parsed = parseRecipeImageKey(objectKey);
  return parsed
    ? `recipes/${parsed.userId}/${parsed.recipeId}/_thumbnails/${parsed.fileName}/`
    : null;
};
