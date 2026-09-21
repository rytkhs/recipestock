import { describe, expect, it } from "vitest";
import { extractRecipePageEvidence } from "./import-page-evidence";

describe("Recipe page evidence", () => {
  it("本文画像を絶対URL付きMarkdown画像としてAI入力に残す", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Tomato pasta",
              "image": "/cover.jpg?width=1200&format=webp",
              "recipeIngredient": ["Tomato 1 can"],
              "recipeInstructions": ["Simmer the tomato sauce."]
            }
          </script>
        </head>
        <body>
          <article>
            <h1>Tomato pasta</h1>
            <p>Enough visible recipe content for extraction.</p>
            <img src="/cover.jpg?width=1200&amp;format=webp" alt="Tomato pasta cover">
          </article>
        </body>
      </html>
    `);

    expect(evidence.markdownContent).toContain("Tomato pasta");
    expect(evidence.markdownContent).toContain(
      "![Tomato pasta cover](<https://example.com/cover.jpg?width=1200&format=webp>)",
    );
    expect(JSON.stringify(evidence.recipeStructuredEvidence)).toContain(
      "https://example.com/cover.jpg?width=1200&format=webp",
    );
    expect(evidence.recipeStructuredEvidence).toContainEqual(
      expect.objectContaining({
        imageUrls: ["https://example.com/cover.jpg?width=1200&format=webp"],
      }),
    );
    expect(evidence.imageCandidates).toContainEqual({
      id: "img_001",
      url: "https://example.com/cover.jpg?width=1200&format=webp",
      alt: "Tomato pasta cover",
      position: 0,
    });
  });

  it("Markdownのリスト構造をAI入力で保持する", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <article>
            <h1>Simple pancakes</h1>
            <h2>Ingredients</h2>
            <ul>
              <li>1 cup flour</li>
              <li>2 eggs</li>
            </ul>
            <h2>Instructions</h2>
            <ol>
              <li>Mix the batter.</li>
              <li>Bake until golden.</li>
            </ol>
          </article>
        </body>
      </html>
    `);

    expect(evidence.markdownContent).toMatch(/- 1 cup flour\n- 2 eggs/);
    expect(evidence.markdownContent).toMatch(/1\. Mix the batter\.\n2\. Bake until golden\./);
  });

  it("タグが表す区切りをAI入力のMarkdownに残す", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <article>
            <h1>Nikujaga</h1>
            <h2>材料</h2>
            <ul>
              <li><span>鶏もも肉</span><span>300g</span></li>
              <li><span>玉ねぎ</span><span>1個</span></li>
            </ul>
            <div>醤油 大さじ2<br>みりん 大さじ1</div>
            <dl>
              <dt>砂糖</dt>
              <dd>小さじ1</dd>
              <dt>塩</dt>
              <dd>少々</dd>
            </dl>
            <p>Mix <strong>flour</strong> and water</p>
            <p><span>Step 1</span><img src="/step1.jpg" alt="Step 1"></p>
          </article>
        </body>
      </html>
    `);

    expect(evidence.markdownContent).toMatch(/- 鶏もも肉 300g\n- 玉ねぎ 1個/);
    expect(evidence.markdownContent).toMatch(/醤油 大さじ2\nみりん 大さじ1/);
    expect(evidence.markdownContent).toMatch(/砂糖 小さじ1\n塩 少々/);
    expect(evidence.markdownContent).toContain("Mix **flour** and water");
    expect(evidence.markdownContent).toMatch(
      /Step 1\n!\[Step 1\]\(<https:\/\/example\.com\/step1\.jpg>\)/,
    );
    expect(evidence.markdownContent).not.toMatch(/[]/);
  });

  it("JSON-LD Recipeをstructured evidenceとして抽出する", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Tomato pasta",
              "recipeYield": "2 servings",
              "image": "/jsonld.jpg",
              "recipeIngredient": ["Tomato 1 can", "Olive oil 1 tbsp"],
              "recipeInstructions": [
                {
                  "@type": "HowToStep",
                  "text": "Simmer the tomato sauce.",
                  "image": "/step-1.jpg"
                },
                {
                  "@type": "HowToStep",
                  "name": "Toss with pasta.",
                  "image": ["/step-2a.jpg", { "url": "/step-2b.jpg" }]
                }
              ]
            }
          </script>
        </head>
        <body><main><h1>Tomato pasta</h1><p>Enough visible recipe content for extraction.</p></main></body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toEqual([
      {
        format: "jsonLd",
        name: "Tomato pasta",
        yieldText: "2 servings",
        imageUrls: ["https://example.com/jsonld.jpg"],
        rawIngredients: ["Tomato 1 can", "Olive oil 1 tbsp"],
        rawInstructions: ["Simmer the tomato sauce.", "Toss with pasta."],
        structuredInstructions: [
          {
            text: "Simmer the tomato sauce.",
            imageUrls: ["https://example.com/step-1.jpg"],
          },
          {
            text: "Toss with pasta.",
            imageUrls: ["https://example.com/step-2a.jpg", "https://example.com/step-2b.jpg"],
          },
        ],
      },
    ]);
  });

  it("JSON-LD Recipeのsection/list配下の手順画像をstructured evidenceとして抽出する", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Layered pasta",
              "recipeIngredient": ["Pasta 100g"],
              "recipeInstructions": [
                {
                  "@type": "HowToSection",
                  "name": "Sauce",
                  "itemListElement": [
                    {
                      "@type": "HowToStep",
                      "text": "Warm the sauce.",
                      "image": { "url": "/section-step.jpg" }
                    }
                  ]
                },
                {
                  "@type": "ItemList",
                  "steps": [
                    {
                      "@type": "HowToStep",
                      "name": "Serve with pasta.",
                      "image": "/item-list-step.jpg"
                    }
                  ]
                }
              ]
            }
          </script>
        </head>
        <body><main><h1>Layered pasta</h1><p>Enough visible recipe content for extraction.</p></main></body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toEqual([
      {
        format: "jsonLd",
        name: "Layered pasta",
        yieldText: undefined,
        imageUrls: [],
        rawIngredients: ["Pasta 100g"],
        rawInstructions: ["Warm the sauce.", "Serve with pasta."],
        structuredInstructions: [
          {
            text: "Warm the sauce.",
            imageUrls: ["https://example.com/section-step.jpg"],
          },
          {
            text: "Serve with pasta.",
            imageUrls: ["https://example.com/item-list-step.jpg"],
          },
        ],
      },
    ]);
  });

  it("Microdata RecipeをRecipe scope内だけから抽出する", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <span itemprop="recipeIngredient">Scope outside ingredient</span>
          <article itemscope itemtype="https://schema.org/Recipe">
            <h1 itemprop="name headline">Miso soup</h1>
            <meta itemprop="recipeYield" content="2 bowls">
            <meta itemprop="image" content="/miso.jpg">
            <ul>
              <li itemprop="recipeIngredient">Miso 2 tbsp</li>
              <li itemprop="recipeIngredient">Tofu 150g</li>
            </ul>
            <ol>
              <li itemprop="recipeInstructions" itemscope itemtype="https://schema.org/HowToStep">
                <span itemprop="text">Warm the broth.</span>
              </li>
              <li itemprop="recipeInstructions" itemscope itemtype="https://schema.org/HowToStep">
                <span itemprop="name">Dissolve the miso.</span>
              </li>
            </ol>
            <p>Enough visible recipe content for extraction and import conversion.</p>
          </article>
        </body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toContainEqual({
      format: "microdata",
      name: "Miso soup",
      yieldText: "2 bowls",
      imageUrls: ["https://example.com/miso.jpg"],
      rawIngredients: ["Miso 2 tbsp", "Tofu 150g"],
      rawInstructions: ["Warm the broth.", "Dissolve the miso."],
      structuredInstructions: [],
    });
    expect(JSON.stringify(evidence.recipeStructuredEvidence)).not.toContain(
      "Scope outside ingredient",
    );
  });

  it("同じMicrodata Recipe要素のtext propertyをRecipe evidenceへ反映する", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <head>
          <meta
            name="description"
            content="Recipe page with enough metadata for import conversion."
          >
        </head>
        <body>
          <article
            itemscope
            itemtype="https://schema.org/Recipe"
            itemprop="recipeIngredient"
          >
            <meta itemprop="name" content="Same node soup">
            Same-node ingredient text for extraction and import conversion.
          </article>
        </body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toContainEqual({
      format: "microdata",
      name: "Same node soup",
      imageUrls: [],
      rawIngredients: ["Same-node ingredient text for extraction and import conversion."],
      rawInstructions: [],
      structuredInstructions: [],
      yieldText: undefined,
    });
  });

  it("RDFa Recipeをschema.org表記揺れ込みで抽出する", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body vocab="https://schema.org/">
          <span property="recipeIngredient">Scope outside ingredient</span>
          <article typeof="schema:Recipe">
            <h1 property="schema:name headline">Rice bowl</h1>
            <meta property="https://schema.org/recipeYield" content="1 serving">
            <img property="schema:image" src="/rice.jpg" alt="Rice bowl">
            <p property="schema:recipeIngredient">Rice 200g</p>
            <p property="schema:recipeIngredient">Egg 1</p>
            <ol>
              <li property="schema:recipeInstructions">
                Steam the rice.
              </li>
              <li property="schema:recipeInstructions">
                Add the egg.
              </li>
            </ol>
            <p>Enough visible recipe content for extraction and import conversion.</p>
          </article>
        </body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toContainEqual({
      format: "rdfa",
      name: "Rice bowl",
      yieldText: "1 serving",
      imageUrls: ["https://example.com/rice.jpg"],
      rawIngredients: ["Rice 200g", "Egg 1"],
      rawInstructions: ["Steam the rice.", "Add the egg."],
      structuredInstructions: [],
    });
    expect(JSON.stringify(evidence.recipeStructuredEvidence)).not.toContain(
      "Scope outside ingredient",
    );
  });

  it("Microdataの材料と手順でタグが表す区切りを改行として残す", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <div itemscope itemtype="https://schema.org/Recipe">
            <h1 itemprop="name">Onion soup</h1>
            <ul><li itemprop="recipeIngredient">Onion<br>1 piece</li></ul>
            <div itemprop="recipeInstructions"><p>Slice.</p><p>Fry.</p><p>Simmer.</p></div>
          </div>
        </body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toContainEqual({
      format: "microdata",
      name: "Onion soup",
      yieldText: undefined,
      imageUrls: [],
      rawIngredients: ["Onion\n1 piece"],
      rawInstructions: ["Slice.\n\nFry.\n\nSimmer."],
      structuredInstructions: [],
    });
  });

  it("Microdataでdetailsなど見落としやすいブロック要素も区切りとして扱う", async () => {
    const evidence = await extractRecipeHtml(
      `<html><body><div itemscope itemtype="https://schema.org/Recipe">` +
        `<h1 itemprop="name">Stew</h1>` +
        `<div itemprop="recipeInstructions">` +
        `<details><summary>Prep</summary>Slice.</details><dialog open>Serve.</dialog>` +
        `</div>` +
        `</div></body></html>`,
    );

    expect(evidence.recipeStructuredEvidence).toContainEqual({
      format: "microdata",
      name: "Stew",
      yieldText: undefined,
      imageUrls: [],
      rawIngredients: [],
      rawInstructions: ["Prep\nSlice.\n\nServe."],
      structuredInstructions: [],
    });
  });

  it("Microdataのインライン要素の境界には区切りを足さない", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <div itemscope itemtype="https://schema.org/Recipe">
            <h1 itemprop="name">Tea</h1>
            <span itemprop="recipeIngredient">Sugar <b>1</b><i>tsp</i></span>
          </div>
        </body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toContainEqual({
      format: "microdata",
      name: "Tea",
      yieldText: undefined,
      imageUrls: [],
      rawIngredients: ["Sugar 1tsp"],
      rawInstructions: [],
      structuredInstructions: [],
    });
  });
});

const extractRecipeHtml = (body: string) =>
  extractRecipePageEvidence(
    {
      finalUrl: "https://example.com/recipes/test",
      contentType: "text/html",
      body,
    },
    "https://example.com/recipes/test",
  );
