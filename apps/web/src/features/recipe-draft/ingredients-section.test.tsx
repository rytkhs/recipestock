import { render, screen, waitFor } from "@testing-library/react";
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
      <form
        onSubmit={(event) => void handleSubmit((values) => submittedValues.push(values))(event)}
      >
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

const nthByLabelText = (label: string, index: number) => {
  const element = screen.getAllByLabelText(label)[index];

  if (!element) {
    throw new Error(`${label}の${index + 1}つ目が見つかりません`);
  }

  return element;
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

    await waitFor(() => {
      expect(submittedValues.at(-1)?.ingredientGroups).toEqual([
        { label: "", ingredients: [{ name: "トマト缶", amount: "1缶" }] },
      ]);
    });
  });

  it("Enterで材料名から分量、分量から次の行へ進み、最後の行なら行を足す", async () => {
    const { submittedValues } = renderIngredientsSection([
      { label: "", ingredients: [{ name: "砂糖", amount: "" }] },
    ]);

    await userEvent.type(nthByLabelText("分量", 0), "10g{Enter}");

    await waitFor(() => {
      expect(screen.getAllByLabelText("材料名")).toHaveLength(2);
    });
    await waitFor(() => {
      expect(nthByLabelText("材料名", 1)).toHaveFocus();
    });

    await userEvent.keyboard("塩{Enter}");
    expect(nthByLabelText("分量", 1)).toHaveFocus();
    await userEvent.keyboard("少々");

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(submittedValues.at(-1)?.ingredientGroups).toEqual([
        {
          label: "",
          ingredients: [
            { name: "砂糖", amount: "10g" },
            { name: "塩", amount: "少々" },
          ],
        },
      ]);
    });
  });

  it("材料名に複数行を貼り付けると、1行ずつ材料にして空の行を置き換える", async () => {
    const { submittedValues } = renderIngredientsSection([
      {
        label: "",
        ingredients: [
          { name: "砂糖", amount: "10g" },
          { name: "", amount: "" },
        ],
      },
    ]);

    await userEvent.click(nthByLabelText("材料名", 1));
    await userEvent.paste("鶏むね肉 1枚\n大根　1/4本");

    await waitFor(() => {
      expect(screen.getAllByLabelText("材料名")).toHaveLength(3);
    });

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(submittedValues.at(-1)?.ingredientGroups).toEqual([
        {
          label: "",
          ingredients: [
            { name: "砂糖", amount: "10g" },
            { name: "鶏むね肉", amount: "1枚" },
            { name: "大根", amount: "1/4本" },
          ],
        },
      ]);
    });
  });

  it("行の操作から並べ替えと削除ができる", async () => {
    const { submittedValues } = renderIngredientsSection([
      {
        label: "",
        ingredients: [
          { name: "砂糖", amount: "10g" },
          { name: "塩", amount: "少々" },
          { name: "酢", amount: "大さじ1" },
        ],
      },
    ]);

    await userEvent.click(screen.getByRole("button", { name: "塩の操作" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "上に移動" }));
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "酢の操作" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "削除" }));

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(submittedValues.at(-1)?.ingredientGroups).toEqual([
        {
          label: "",
          ingredients: [
            { name: "塩", amount: "少々" },
            { name: "砂糖", amount: "10g" },
          ],
        },
      ]);
    });
  });
});
