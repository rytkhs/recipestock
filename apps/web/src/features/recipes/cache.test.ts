import { type QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateRecipeLists, removeRecipeDetail } from "./cache";

describe("recipe cache helpers", () => {
  it("Recipe list queryをinvalidateする", async () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as QueryClient;

    await invalidateRecipeLists(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["recipes"] });
  });

  it("Recipe detail queryをremoveする", () => {
    const queryClient = {
      removeQueries: vi.fn(),
    } as unknown as QueryClient;

    removeRecipeDetail(queryClient, "recipe_123");

    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ["recipe", "recipe_123"],
    });
  });
});
