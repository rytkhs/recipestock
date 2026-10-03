import { fireEvent, render, screen } from "@testing-library/react";
import { RecipeThumbnail } from "./recipe-thumbnail";

const fallback = <span data-testid="thumbnail-fallback">題簽</span>;

describe("RecipeThumbnail", () => {
  it("returns to the hidden state when the source changes", () => {
    const { rerender } = render(
      <RecipeThumbnail fallback={fallback} alt="Tomato pasta" index={0} src="/tomato-pasta.webp" />,
    );

    const initialImage = screen.getByRole("img", { name: "Tomato pasta" });
    expect(initialImage).toHaveClass("opacity-0");
    fireEvent.load(initialImage);
    expect(initialImage).toHaveClass("opacity-100");

    rerender(
      <RecipeThumbnail fallback={fallback} alt="Potato salad" index={0} src="/potato-salad.webp" />,
    );

    const updatedImage = screen.getByRole("img", { name: "Potato salad" });

    expect(updatedImage).toHaveClass("opacity-0");

    fireEvent.load(updatedImage);

    expect(updatedImage).toHaveClass("opacity-100");
  });

  it("shows a placeholder after failure and retries when the source changes", () => {
    const { rerender } = render(
      <RecipeThumbnail fallback={fallback} alt="Tomato pasta" index={0} src="/missing.webp" />,
    );

    const image = screen.getByRole("img", { name: "Tomato pasta" });

    fireEvent.error(image);

    expect(image).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Tomato pastaの画像を読み込めませんでした" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("thumbnail-fallback")).toBeInTheDocument();
    rerender(<RecipeThumbnail fallback={fallback} alt="Tomato pasta" index={0} src="/new.webp" />);
    expect(screen.getByRole("img", { name: "Tomato pasta" })).toHaveAttribute("src", "/new.webp");
  });
});
