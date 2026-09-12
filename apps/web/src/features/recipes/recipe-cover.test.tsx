import { render, screen } from "@testing-library/react";
import { RecipeCover } from "./recipe-cover";

const recipe = (coverImageUrl: string | null) => ({
  id: "recipe_123",
  title: "鶏むね肉のやわらか照り焼き",
  coverImageUrl,
});

describe("RecipeCover", () => {
  it("表紙画像がないRecipeには題名の一文字を組んだ題簽を出す", () => {
    render(<RecipeCover index={0} recipe={recipe(null)} />);

    const plate = screen.getByTestId("recipe-title-plate");

    expect(plate).toHaveTextContent("鶏");
    expect(plate).not.toHaveTextContent("照り焼き");
  });

  it("同じRecipeには同じ地色を配る", () => {
    const { unmount } = render(<RecipeCover index={0} recipe={recipe(null)} />);
    const firstTint = screen.getByTestId("recipe-title-plate").className;

    unmount();
    render(<RecipeCover index={0} recipe={recipe(null)} />);

    expect(screen.getByTestId("recipe-title-plate").className).toBe(firstTint);
  });

  it("表紙画像があるときは写真を出す", () => {
    render(<RecipeCover index={0} recipe={recipe("https://images.example/cover.webp")} />);

    expect(screen.getByRole("img", { name: "鶏むね肉のやわらか照り焼き" })).toBeInTheDocument();
    expect(screen.queryByTestId("recipe-title-plate")).not.toBeInTheDocument();
  });
});
