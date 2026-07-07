import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { IngredientsSection } from "./ingredients-section";
import {
  createEmptyRecipeDraftFormValues,
  type RecipeDraftFormValues,
} from "./recipe-draft-form-values";

const renderIngredientsSection = (ingredientGroups: RecipeDraftFormValues["ingredientGroups"]) => {
  const submittedValues: RecipeDraftFormValues[] = [];

  const TestForm = () => {
    const { control, handleSubmit } = useForm<RecipeDraftFormValues>({
      defaultValues: {
        ...createEmptyRecipeDraftFormValues(),
        title: "テストレシピ",
        ingredientGroups,
      },
    });

    return (
      <form onSubmit={(event) => void handleSubmit((values) => submittedValues.push(values))(event)}>
        <IngredientsSection control={control} />
        <button type="submit">保存</button>
      </form>
    );
  };

  return {
    submittedValues,
    ...render(<TestForm />),
  };
};

describe("IngredientsSection", () => {
  it("単一の空ラベル材料グループではグループ名入力を表示しない", () => {
    renderIngredientsSection([{ label: "", ingredients: [{ name: "砂糖", amount: "10g" }] }]);

    expect(screen.queryByLabelText("グループ名")).not.toBeInTheDocument();
  });

  it("単一のラベル付き材料グループではグループ名を編集できる", async () => {
    const { submittedValues } = renderIngredientsSection([
      { label: "ソース", ingredients: [{ name: "トマト缶", amount: "1缶" }] },
    ]);

    const groupLabelInput = screen.getByLabelText("グループ名");
    expect(groupLabelInput).toHaveValue("ソース");

    await userEvent.clear(groupLabelInput);
    expect(groupLabelInput).toHaveValue("");

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(submittedValues.at(-1)?.ingredientGroups).toEqual([
      { label: "", ingredients: [{ name: "トマト缶", amount: "1缶" }] },
    ]);
  });
});
