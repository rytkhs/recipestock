import { describe, expect, it } from "vitest";
import { extractRecipePageEvidence } from "./page-evidence";

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
            <div>醤油 大さじ2<br>みりん 大さじ1<br>
            </div>
            <div>酒 大さじ1</div>
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
    // 末尾の<br>のあとの整形の改行で、次のブロックとの間に空行を増やさない。
    expect(evidence.markdownContent).toMatch(/醤油 大さじ2\nみりん 大さじ1\n酒 大さじ1/);
    expect(evidence.markdownContent).toMatch(/砂糖 小さじ1\n塩 少々/);
    expect(evidence.markdownContent).toContain("Mix flour and water");
    expect(evidence.markdownContent).toMatch(
      /Step 1\n!\[Step 1\]\(<https:\/\/example\.com\/step1\.jpg>\)/,
    );
  });

  it("AI入力のMarkdownにリンク先と強調の記法を入れず、表はセルを区切って行ごとに書く", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <article>
            <p>Mix <strong>flour</strong> and <a href="/glossary/water">water</a>.</p>
            <table>
              <tr><th>材料</th><th>分量</th></tr>
              <tr>
                <td>砂糖</td>
                <td>
                  <p>大さじ1</p>
                </td>
              </tr>
            </table>
          </article>
        </body>
      </html>
    `);

    expect(evidence.markdownContent).toContain("Mix flour and water.");
    expect(evidence.markdownContent).not.toContain("/glossary/water");
    expect(evidence.markdownContent).toMatch(/材料 \| 分量\n砂糖 \| 大さじ1/);
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

  it("構造化証拠は長さの上限を超えたレシピから後ろを落とし、レシピの途中では切らない", async () => {
    const instruction = "Stir the sauce. ".repeat(300).trim();
    const recipes = ["Soup A", "Soup B", "Soup C"].map((name) => ({
      "@type": "Recipe",
      name,
      recipeInstructions: [instruction],
    }));
    const evidence = await extractRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({ "@graph": recipes })}</script>
        </head>
        <body><main><p>Enough visible recipe content for extraction.</p></main></body>
      </html>
    `);

    expect(
      evidence.recipeStructuredEvidence.map(({ name, rawInstructions }) => ({
        name,
        rawInstructions,
      })),
    ).toEqual([
      { name: "Soup A", rawInstructions: [instruction] },
      { name: "Soup B", rawInstructions: [instruction] },
    ]);
  });

  it("1件目のレシピは、それだけで長さの上限を超えても残す", async () => {
    const instruction = "Stir the sauce. ".repeat(1000).trim();
    const recipes = ["Long soup", "Short soup"].map((name) => ({
      "@type": "Recipe",
      name,
      recipeInstructions: [name === "Long soup" ? instruction : "Stir."],
    }));
    const evidence = await extractRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({ "@graph": recipes })}</script>
        </head>
        <body><main><p>Enough visible recipe content for extraction.</p></main></body>
      </html>
    `);

    expect(
      evidence.recipeStructuredEvidence.map(({ name, rawInstructions }) => ({
        name,
        rawInstructions,
      })),
    ).toEqual([{ name: "Long soup", rawInstructions: [instruction] }]);
  });

  it("JSON.parseが受け付けない空白を含むJSON-LDも、文字列の中身を変えずに読む", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {\u00a0"@type": "Recipe",\u3000"name": "肉じゃが\u3000大盛り",
              "recipeIngredient": ["じゃがいも\f3個"],
              "recipeInstructions": ["煮る。
            火を止める。"]
            }
          </script>
        </head>
        <body><main><p>Enough visible recipe content for extraction.</p></main></body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toEqual([
      expect.objectContaining({
        format: "jsonLd",
        name: "肉じゃが\u3000大盛り",
        rawIngredients: ["じゃがいも 3個"],
        rawInstructions: ["煮る。 火を止める。"],
      }),
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
        `<center>Rest.</center>` +
        `</div>` +
        `<div itemprop="recipeIngredient"><fieldset><legend>Salt</legend>1 tsp</fieldset></div>` +
        `</div></body></html>`,
    );

    expect(evidence.recipeStructuredEvidence).toContainEqual({
      format: "microdata",
      name: "Stew",
      yieldText: undefined,
      imageUrls: [],
      rawIngredients: ["Salt\n1 tsp"],
      rawInstructions: ["Prep\nSlice.\nServe.\nRest."],
      structuredInstructions: [],
    });
  });

  it("Microdataの表のセルと水平線を区切りとして扱う", async () => {
    const evidence = await extractRecipeHtml(
      `<html><body><div itemscope itemtype="https://schema.org/Recipe">` +
        `<h1 itemprop="name">Soup</h1>` +
        `<table itemprop="recipeIngredient"><colgroup><col><col></colgroup>` +
        `<tr><td>Salt</td><td>1</td></tr></table>` +
        `<div itemprop="recipeInstructions">Boil.<hr>Serve.</div>` +
        `</div></body></html>`,
    );

    expect(evidence.recipeStructuredEvidence).toContainEqual({
      format: "microdata",
      name: "Soup",
      yieldText: undefined,
      imageUrls: [],
      rawIngredients: ["Salt | 1"],
      rawInstructions: ["Boil.\nServe."],
      structuredInstructions: [],
    });
  });

  it("文字にはさまれた改行は残し、要素の前後の改行は畳んで、Markdownと構造化証拠で揃える", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <div itemscope itemtype="https://schema.org/Recipe">
            <h1 itemprop="name">Batter</h1>
            <div itemprop="recipeInstructions">
              <p>Chop the
                onion.</p>
              <p>Fry it.</p>
            </div>
            <ul>
              <li itemprop="recipeIngredient">plain flour,
                sifted</li>
            </ul>
          </div>
        </body>
      </html>
    `);

    // CSSのpre-wrapで改行を出すページがあるので、テキスト中の改行は区切りとして残す。
    expect(evidence.recipeStructuredEvidence).toContainEqual({
      format: "microdata",
      name: "Batter",
      yieldText: undefined,
      imageUrls: [],
      rawIngredients: ["plain flour,\nsifted"],
      rawInstructions: ["Chop the\nonion.\n\nFry it."],
      structuredInstructions: [],
    });
    expect(evidence.markdownContent).toContain("Chop the\nonion.\n\nFry it.");
    expect(evidence.markdownContent).toContain("- plain flour,\nsifted");
  });

  it("liの外では、Microdataのインライン要素の境界に区切りを足さない", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <div itemscope itemtype="https://schema.org/Recipe">
            <h1 itemprop="name">Tea</h1>
            <span itemprop="recipeIngredient">Sugar <b>1</b><i>tsp</i><marquee>, sifted</marquee></span>
          </div>
        </body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toContainEqual({
      format: "microdata",
      name: "Tea",
      yieldText: undefined,
      imageUrls: [],
      rawIngredients: ["Sugar 1tsp, sifted"],
      rawInstructions: [],
      structuredInstructions: [],
    });
  });

  it("本文・タイトル・属性値の文字参照を、前後の空白に関係なく1回だけ戻す", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <head>
          <title>Cr&egrave;me br&ucirc;l&eacute;e &#8211; Site</title>
          <meta property="og:title" content="A &amp;lt;b&amp;gt; B">
        </head>
        <body>
          <p>
            I&#8217;m &amp;lt;tag&amp;gt; 180&deg;
          </p>
          <img src="/a.jpg?resize=640%2C427&#038;quality=89&#038;ssl=1" alt="Deb&apos;s &reg;">
        </body>
      </html>
    `);

    expect(evidence.title).toBe("Crème brûlée – Site");
    expect(evidence.meta["og:title"]).toBe("A &lt;b&gt; B");
    expect(evidence.markdownContent).toContain("I’m &lt;tag&gt; 180°");
    expect(evidence.imageCandidates).toContainEqual({
      id: "img_001",
      url: "https://example.com/a.jpg?resize=640%2C427&quality=89&ssl=1",
      alt: "Deb's ®",
      position: 0,
    });
  });

  it("構造化証拠の文字参照を1回だけ戻し、JSON-LDの文字列に&quot;があっても読める", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Recipe",
              "name": "12&quot; Pizza &amp;lt;b&amp;gt;",
              "recipeYield": "2&nbsp;servings",
              "recipeIngredient": ["Sugar &frac12; cup"]
            }
          </script>
        </head>
        <body>
          <div itemscope itemtype="https://schema.org/Recipe">
            <h1 itemprop="name">A &amp;lt;b&amp;gt; B</h1>
            <ul>
              <li itemprop="recipeIngredient">
                Sugar &#189; cup
              </li>
            </ul>
          </div>
        </body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toEqual([
      expect.objectContaining({
        format: "jsonLd",
        name: '12" Pizza &lt;b&gt;',
        yieldText: "2 servings",
        rawIngredients: ["Sugar ½ cup"],
      }),
      expect.objectContaining({
        format: "microdata",
        name: "A &lt;b&gt; B",
        rawIngredients: ["Sugar ½ cup"],
      }),
    ]);
  });

  it("HTMLでないJSON-LDの文字列では、文中のURLのパラメータを文字参照として戻さない", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Recipe",
              "name": "Pizza",
              "recipeInstructions": ["https://example.com/v?id=1&region=jp&notes=2 &amp; 180&deg;"]
            }
          </script>
        </head>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toEqual([
      expect.objectContaining({
        format: "jsonLd",
        rawInstructions: ["https://example.com/v?id=1&region=jp&notes=2 & 180°"],
      }),
    ]);
  });

  it("仕様の外にある数値参照で落ちず、U+FFFDに置き換える", async () => {
    const evidence = await extractRecipeHtml(
      "<html><body><p>A&#0;B &#99999999; &#xD800; &#150;</p></body></html>",
    );

    expect(evidence.markdownContent).toBe("A\uFFFDB \uFFFD \uFFFD –");
  });

  it("JSON-LDの文字列は、エスケープされていても終了タグか<br>があるときだけHTMLとして、ページの本文と同じ区切りでテキストにする", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Recipe",
              "name": "Renkon",
              "recipeIngredient": ["<b>Salt</b> 1 tsp", "温度 &lt; 180℃", "200g < 300g", "<A>醤油 大さじ1", "&lt;B&gt;砂糖 大さじ1"],
              "recipeInstructions": [
                "<p>玉ねぎを切る</p><p>炒める</p>",
                "&lt;p&gt;塩を振る&lt;/p&gt;&lt;p&gt;焼く&lt;br&gt;返す&lt;/p&gt;",
                {
                  "@type": "HowToStep",
                  "text": "れんこんは<a href=\\"/wordlist/輪切り\\">輪切り</a>にする。<br>水にさらす。"
                },
                "<A>を加えて、x<yになるまで煮る。"
              ]
            }
          </script>
        </head>
        <body><main><p>Enough visible recipe content for extraction.</p></main></body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toContainEqual(
      expect.objectContaining({
        format: "jsonLd",
        rawIngredients: [
          "Salt 1 tsp",
          "温度 < 180℃",
          "200g < 300g",
          "<A>醤油 大さじ1",
          "<B>砂糖 大さじ1",
        ],
        rawInstructions: [
          "玉ねぎを切る\n\n炒める",
          "塩を振る\n\n焼く\n返す",
          "れんこんは輪切りにする。\n水にさらす。",
          "<A>を加えて、x<yになるまで煮る。",
        ],
      }),
    );
  });

  it("表示されない要素の中身を、構造化証拠にもMarkdownにも入れない", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <div itemscope itemtype="https://schema.org/Recipe">
            <h1 itemprop="name">Boiled egg</h1>
            <div itemprop="recipeInstructions">Boil.
              <script>var track = {a:1};</script>
              <style>.step{color:red}</style>
              <template><p>hidden draft</p></template>
              <noscript>Enable JavaScript</noscript>
              <span style="display:none">SALE 50% OFF</span>
              <span hidden>coupon</span>
              <select><option>Print size</option></select>
            Serve.</div>
          </div>
        </body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toContainEqual(
      expect.objectContaining({ format: "microdata", rawInstructions: ["Boil. Serve."] }),
    );
    expect(evidence.markdownContent).toBe("# Boiled egg\n\nBoil. Serve.");
  });

  it("ページタイトルにSVGの<title>を混ぜない", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <head><title>simple chicken tacos &#8211; smitten kitchen</title></head>
        <body><svg><title>arrow</title></svg><p>Enough visible recipe content.</p></body>
      </html>
    `);

    expect(evidence.title).toBe("simple chicken tacos – smitten kitchen");
    expect(evidence.markdownContent).not.toContain("arrow");
  });

  it("spanなどの中でほかの文字と並ぶ見出しは、インラインに見せているとみなして行を変えない", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <h2>材料</h2>
          <div class="mate"><span><a href="/food/1"><h2 class="dispin">カニ缶</h2></a>(ズワイガニ) <span class="amount">100g</span></span></div>
          <div class="mate"><span><a href="/food/2"><h2 class="dispin">卵</h2></a> <span class="amount">2個</span></span></div>
          <div>＜調味料1＞</div>
        </body>
      </html>
    `);

    expect(evidence.markdownContent).toBe(
      "## 材料\n\nカニ缶(ズワイガニ) 100g\n卵 2個\n＜調味料1＞",
    );
  });

  it("見出しだけを包むbやspanの中の見出しは、ブロックとして行を変える", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <div itemscope itemtype="https://schema.org/Recipe">
            <h1 itemprop="name">Omelette</h1>
            <div itemprop="recipeIngredient"><span style="color:red"><h3>調味料</h3></span>醤油 大さじ1</div>
            <div itemprop="recipeInstructions"><b><h3>作り方</h3></b>卵を割る。</div>
          </div>
        </body>
      </html>
    `);

    expect(evidence.recipeStructuredEvidence).toContainEqual(
      expect.objectContaining({
        format: "microdata",
        rawIngredients: ["調味料\n醤油 大さじ1"],
        rawInstructions: ["作り方\n卵を割る。"],
      }),
    );
    expect(evidence.markdownContent).toContain("### 作り方\n\n卵を割る。");
  });

  it("http(s)以外の画像URLは候補にしない", async () => {
    const evidence = await extractRecipeHtml(`
      <html>
        <body>
          <p>Enough visible recipe content.</p>
          <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="placeholder">
        </body>
      </html>
    `);

    expect(evidence.imageCandidates).toEqual([]);
    expect(evidence.markdownContent).not.toContain("data:");
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
