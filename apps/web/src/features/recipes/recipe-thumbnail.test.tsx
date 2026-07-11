import { fireEvent, render, screen } from "@testing-library/react";
import { RecipeThumbnail } from "./recipe-thumbnail";

describe("RecipeThumbnail", () => {
  it("reveals the image after it loads", () => {
    render(<RecipeThumbnail alt="Tomato pasta" index={0} src="/tomato-pasta.webp" />);

    const image = screen.getByRole("img", { name: "Tomato pasta" });

    expect(image).toHaveClass("opacity-0");
    expect(image).not.toHaveClass("opacity-100");

    fireEvent.load(image);

    expect(image).toHaveClass("opacity-100");
    expect(image).not.toHaveClass("opacity-0");
  });

  it("returns to the hidden state when the source changes", () => {
    const { rerender } = render(
      <RecipeThumbnail alt="Tomato pasta" index={0} src="/tomato-pasta.webp" />,
    );

    fireEvent.load(screen.getByRole("img", { name: "Tomato pasta" }));

    rerender(<RecipeThumbnail alt="Potato salad" index={0} src="/potato-salad.webp" />);

    const updatedImage = screen.getByRole("img", { name: "Potato salad" });

    expect(updatedImage).toHaveClass("opacity-0");

    fireEvent.load(updatedImage);

    expect(updatedImage).toHaveClass("opacity-100");
  });

  it("loads the first four images eagerly and later images lazily", () => {
    const { rerender } = render(
      <RecipeThumbnail alt="Fourth recipe" index={3} src="/fourth.webp" />,
    );

    expect(screen.getByRole("img", { name: "Fourth recipe" })).toHaveAttribute("loading", "eager");

    rerender(<RecipeThumbnail alt="Fifth recipe" index={4} src="/fifth.webp" />);

    expect(screen.getByRole("img", { name: "Fifth recipe" })).toHaveAttribute("loading", "lazy");
  });

  it("keeps decoding and motion behavior inside the module", () => {
    render(<RecipeThumbnail alt="Tomato pasta" index={0} src="/tomato-pasta.webp" />);

    const image = screen.getByRole("img", { name: "Tomato pasta" });

    expect(image).toHaveAttribute("decoding", "async");
    expect(image).toHaveClass(
      "transition-[opacity,transform]",
      "duration-200",
      "ease-out",
      "motion-reduce:transition-none",
      "group-hover:scale-105",
    );
  });

  it("reveals the browser image error state", () => {
    render(<RecipeThumbnail alt="Tomato pasta" index={0} src="/missing.webp" />);

    const image = screen.getByRole("img", { name: "Tomato pasta" });

    fireEvent.error(image);

    expect(image).toHaveClass("opacity-100");
  });
});
