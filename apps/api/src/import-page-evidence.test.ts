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
        servingsText: "2 servings",
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
        servingsText: undefined,
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
      servingsText: "2 bowls",
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
      servingsText: undefined,
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
      servingsText: "1 serving",
      imageUrls: ["https://example.com/rice.jpg"],
      rawIngredients: ["Rice 200g", "Egg 1"],
      rawInstructions: ["Steam the rice.", "Add the egg."],
      structuredInstructions: [],
    });
    expect(JSON.stringify(evidence.recipeStructuredEvidence)).not.toContain(
      "Scope outside ingredient",
    );
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
