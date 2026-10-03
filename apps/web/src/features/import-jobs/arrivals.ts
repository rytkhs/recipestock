import { useSyncExternalStore } from "react";

/**
 * このセッションで取り込みから届いたRecipe。一覧に入るときの動きは一度だけにし、
 * 「新着」の印は開くまで残す。覚えておくのは開いている間だけで、読み込み直すと消える。
 */
export type RecipeArrival = "entering" | "arrived";

let arrivals = new Map<string, RecipeArrival>();
const listeners = new Set<() => void>();

const updateArrivals = (update: (next: Map<string, RecipeArrival>) => void) => {
  const next = new Map(arrivals);
  update(next);
  arrivals = next;

  for (const listener of listeners) {
    listener();
  }
};

export const markRecipeArrived = (recipeId: string) => {
  if (arrivals.has(recipeId)) {
    return;
  }

  updateArrivals((next) => next.set(recipeId, "entering"));
};

export const finishRecipeArrival = (recipeId: string) => {
  if (arrivals.get(recipeId) !== "entering") {
    return;
  }

  updateArrivals((next) => next.set(recipeId, "arrived"));
};

export const clearRecipeArrival = (recipeId: string) => {
  if (!arrivals.has(recipeId)) {
    return;
  }

  updateArrivals((next) => next.delete(recipeId));
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useRecipeArrival = (recipeId: string): RecipeArrival | null =>
  useSyncExternalStore(subscribe, () => arrivals.get(recipeId) ?? null);
