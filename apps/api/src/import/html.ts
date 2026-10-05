import { type DefaultTreeAdapterTypes, html, parse, parseFragment } from "parse5";
import { normalizeMultilineText } from "./text";

export type HtmlDocument = DefaultTreeAdapterTypes.Document;
export type HtmlElement = DefaultTreeAdapterTypes.Element;
type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlParentNode = DefaultTreeAdapterTypes.ParentNode;

// 文字参照はパーサが本文と属性値でそれぞれ仕様どおりに1回だけ戻す。ここから取った値は再びデコードしない。
export const parseHtmlDocument = (value: string): HtmlDocument => parse(value);

export const isHtmlElement = (node: HtmlNode): node is HtmlElement =>
  "tagName" in node && node.namespaceURI === html.NS.HTML;

export const getHtmlAttribute = (element: HtmlElement, name: string) =>
  element.attrs.find((attribute) => attribute.name === name)?.value;

/** 文書順に要素をたどる。templateの中身は文書の一部ではないので入らない。 */
export const forEachHtmlElement = (
  root: HtmlParentNode,
  callback: (element: HtmlElement) => void,
) => {
  for (const child of root.childNodes) {
    if (!isHtmlElement(child)) continue;
    callback(child);
    forEachHtmlElement(child, callback);
  }
};

export const getHtmlTextContent = (node: HtmlNode): string => {
  if (node.nodeName === "#text") return (node as DefaultTreeAdapterTypes.TextNode).value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(getHtmlTextContent).join("");
};

type HtmlTextFormat = "markdown" | "plain";

type RenderHtmlTextOptions = {
  /** markdownは見出し・リスト・画像を記法で書く。plainは文字と改行だけにする。 */
  format: HtmlTextFormat;
  renderImage?: (element: HtmlElement) => string | undefined;
};

// CSSは見えないので、表示はWHATWG RenderingのUAスタイルシートで推す。
// UAでdisplay: noneの要素、スクリプトが有効なら出ないnoscript、中身が代替コンテンツになる埋め込み、
// 値を表示するフォーム部品は描かない。buttonは中身がそのまま表示される（動画の再生ボタンに完成写真を置くページがある）ので描く。
// 閉じたdetailsの中身も、開けば読めるレシピの補足なので描く。
const NOT_RENDERED_TAG_NAMES = new Set([
  "area",
  "audio",
  "base",
  "basefont",
  "canvas",
  "datalist",
  "embed",
  "head",
  "iframe",
  "input",
  "link",
  "meta",
  "noembed",
  "noframes",
  "noscript",
  "object",
  "param",
  "rp",
  "script",
  "select",
  "style",
  "template",
  "textarea",
  "title",
  "video",
]);

const INLINE_HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i;

// UAスタイルシートでブロックとして並ぶ要素。前後で行を変える。
const BLOCK_TAG_NAMES = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "center",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "html",
  "legend",
  "listing",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "plaintext",
  "pre",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "ul",
  "xmp",
]);

// markdownでは前後に空行を置くブロック。plainでは段落（p）だけに空行を置く。
const MARKDOWN_SECTION_TAG_NAMES = new Set([
  "blockquote",
  "dir",
  "dl",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "menu",
  "ol",
  "pre",
  "table",
  "ul",
]);

const HEADING_TAG_NAMES = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
// 中に段落や見出しを置けない（phrasing contentだけを持つ）要素。aは中身に合わせるので含めない。
const PHRASING_TAG_NAMES = new Set([
  "abbr",
  "b",
  "bdi",
  "bdo",
  "big",
  "cite",
  "code",
  "data",
  "dfn",
  "em",
  "font",
  "i",
  "kbd",
  "label",
  "mark",
  "nobr",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "time",
  "tt",
  "u",
  "var",
]);
const LINE_BOX_TAG_NAMES = new Set([...BLOCK_TAG_NAMES, "dd", "dt", "li", "td", "th", "tr"]);

const LIST_TAG_NAMES = new Set(["dir", "menu", "ol", "ul"]);
// liの中でも、入れ子のリストと表は行の並びを保つ。
const LIST_ITEM_BLOCK_TAG_NAMES = new Set([...LIST_TAG_NAMES, "dl", "table"]);
// 整形済みテキストの中では、テキストの端の改行も残す。空白は最後にほかと同じく畳む。
const PREFORMATTED_TAG_NAMES = new Set(["listing", "plaintext", "pre", "xmp"]);

// HTMLでは見出しをspanなどの中に置けない。置いているページは、CSSでインラインに見せている（E・レシピの材料名）。
const isHeadingInsidePhrasing = (element: HtmlElement) => {
  for (let current = element.parentNode; current && isHtmlElement(current); ) {
    if (PHRASING_TAG_NAMES.has(current.tagName)) return true;
    if (LINE_BOX_TAG_NAMES.has(current.tagName)) return false;
    current = current.parentNode;
  }
  return false;
};

const isNotRendered = (element: HtmlElement) =>
  NOT_RENDERED_TAG_NAMES.has(element.tagName) ||
  (element.tagName === "dialog" && getHtmlAttribute(element, "open") === undefined) ||
  getHtmlAttribute(element, "hidden") !== undefined ||
  getHtmlAttribute(element, "aria-hidden") === "true" ||
  INLINE_HIDDEN_STYLE.test(getHtmlAttribute(element, "style") ?? "");

// CSSのwhite-spaceは見えない。文字にはさまれた改行は作者が書いた改行として残し（pre-wrapで出すページがある）、
// テキストの端と空白だけのノードはwhite-space: normalと同じく1つの空白に畳む。
const collapseTextNode = (value: string) => {
  if (!/[^\t\n\f ]/.test(value)) return value ? " " : "";

  return value
    .replace(/^[\t\n\f ]+/, " ")
    .replace(/[\t\n\f ]+$/, " ")
    .replace(/[\t\f ]*\n[\t\n\f ]*/g, "\n")
    .replace(/[\t\f ]+/g, " ");
};

// 行の端では、ブロックの改行と、整形の空白だけのテキストが消える。最後の組み立ての行頭と、
// 端で行を変えない要素（liの子要素・表のセル・dt・dd）の両端で、同じこの判定を使う。
const isLineEdgePart = (part: string | number) => typeof part === "number" || /^ *$/.test(part);

const countLeadingNewlines = (value: string) => {
  let count = 0;
  while (value[count] === "\n") count += 1;
  return count;
};

const countTrailingNewlines = (value: string) => {
  let count = 0;
  while (value[value.length - 1 - count] === "\n") count += 1;
  return count;
};

/**
 * innerTextに近い規則で、要素の表示テキストを作る。ページ全体のmarkdownも、構造化証拠の1つの値も、
 * 同じ規則で作るので、AIに渡る2つの証拠で区切りや文字が食い違わない。
 */
export const renderHtmlText = (root: HtmlParentNode, options: RenderHtmlTextOptions) => {
  const markdown = options.format === "markdown";
  // 文字列か、そこで必要な改行の数。改行の数は隣り合うものの大きい方だけが効く。
  const parts: Array<string | number> = [];
  const lists: Array<{ ordered: boolean; itemCount: number }> = [];
  const rows: Array<{ cellCount: number }> = [];
  let preformattedDepth = countPreformattedAncestors(root);

  // ブロックの改行を落とした中身を足す。liの子要素や表のセルは、端で行を変えない。
  const appendInline = (render: () => void) => {
    const start = parts.length;
    render();
    while (parts.length > start && isLineEdgePart(parts[start])) parts.splice(start, 1);
    while (parts.length > start && isLineEdgePart(parts[parts.length - 1])) parts.pop();
  };

  const visitChildren = (node: HtmlParentNode) => {
    for (const child of node.childNodes) visitNode(child);
  };

  const visitNode = (node: HtmlNode) => {
    if (node.nodeName === "#text") {
      const value = (node as DefaultTreeAdapterTypes.TextNode).value;
      parts.push(preformattedDepth > 0 ? value : collapseTextNode(value));
      return;
    }
    // svgとmathの中身はアイコンや数式なので描かない。
    if (!isHtmlElement(node) || isNotRendered(node)) return;

    visitElement(node);
  };

  // 子要素は横に並ぶとみなす（材料名と分量をflexで並べるページが多い）。要素の前に空白を置き、端では行を変えない。
  const visitListItemChildren = (element: HtmlElement) => {
    for (const child of element.childNodes) {
      if (!isHtmlElement(child) || isNotRendered(child)) {
        visitNode(child);
        continue;
      }
      if (LIST_ITEM_BLOCK_TAG_NAMES.has(child.tagName)) {
        visitElement(child);
        continue;
      }

      parts.push(" ");
      appendInline(() => visitElement(child));
    }
  };

  const visitElement = (element: HtmlElement) => {
    const tagName = element.tagName;

    if (tagName === "br") {
      parts.push("\n");
      return;
    }

    if (tagName === "img") {
      const image = markdown ? options.renderImage?.(element) : undefined;
      // 画像は自分の行に置く。liの子要素として端の改行を落とされても残るよう、改行を文字で入れる。
      if (image) parts.push("\n", image, "\n");
      return;
    }

    if (tagName === "td" || tagName === "th") {
      const row = rows.at(-1);
      if (row && row.cellCount > 0) parts.push(" | ");
      if (row) row.cellCount += 1;
      appendInline(() => visitChildren(element));
      return;
    }

    if (tagName === "tr") {
      parts.push(1);
      rows.push({ cellCount: 0 });
      visitChildren(element);
      rows.pop();
      parts.push(1);
      return;
    }

    if (tagName === "li") {
      parts.push(1);
      const list = lists.at(-1);
      if (markdown && list) {
        list.itemCount += 1;
        parts.push(list.ordered ? `${list.itemCount}. ` : "- ");
      }
      visitListItemChildren(element);
      parts.push(1);
      return;
    }

    // 定義リストは、項目と説明を1行に並べる。
    if (tagName === "dt") {
      parts.push(1);
      appendInline(() => visitChildren(element));
      return;
    }
    if (tagName === "dd") {
      parts.push(" ");
      appendInline(() => visitChildren(element));
      return;
    }

    if (
      !BLOCK_TAG_NAMES.has(tagName) ||
      (HEADING_TAG_NAMES.has(tagName) && isHeadingInsidePhrasing(element))
    ) {
      visitChildren(element);
      return;
    }

    const lineBreaks =
      tagName === "p" || (markdown && MARKDOWN_SECTION_TAG_NAMES.has(tagName)) ? 2 : 1;
    parts.push(lineBreaks);
    if (markdown && HEADING_TAG_NAMES.has(tagName)) {
      parts.push(`${"#".repeat(Number(tagName[1]))} `);
    }
    if (LIST_TAG_NAMES.has(tagName)) lists.push({ ordered: tagName === "ol", itemCount: 0 });
    if (PREFORMATTED_TAG_NAMES.has(tagName)) preformattedDepth += 1;

    visitChildren(element);

    if (PREFORMATTED_TAG_NAMES.has(tagName)) preformattedDepth -= 1;
    if (LIST_TAG_NAMES.has(tagName)) lists.pop();
    parts.push(lineBreaks);
  };

  if (isHtmlElement(root as HtmlNode)) {
    // 起点の要素は、隠れていても描く。構造化データの値は、表示されていない要素に書かれることがある。
    visitElement(root as HtmlElement);
  } else {
    visitChildren(root);
  }

  // 組み立て中の文字列は読み返さない（長いページで遅くなる）。末尾の改行の数は足しながら数える。
  const chunks: string[] = [];
  let trailingNewlines = 0;
  let pendingLineBreaks = 0;
  for (const part of parts) {
    if (typeof part === "number") {
      pendingLineBreaks = Math.max(pendingLineBreaks, part);
      continue;
    }
    if (!part) continue;
    // ブロックの間や改行のあとは行の頭になる。
    if ((pendingLineBreaks > 0 || trailingNewlines > 0) && isLineEdgePart(part)) continue;

    if (chunks.length > 0 && pendingLineBreaks > 0) {
      const missing = pendingLineBreaks - trailingNewlines - countLeadingNewlines(part);
      if (missing > 0) {
        chunks.push("\n".repeat(missing));
        trailingNewlines += missing;
      }
    }
    pendingLineBreaks = 0;
    chunks.push(part);
    const partTrailingNewlines = countTrailingNewlines(part);
    trailingNewlines =
      partTrailingNewlines === part.length
        ? trailingNewlines + partTrailingNewlines
        : partTrailingNewlines;
  }

  return normalizeMultilineText(chunks.join(""));
};

/** JSON-LDの文字列などに入ったHTMLの断片を、ページの本文と同じ規則でテキストにする。 */
export const renderHtmlFragmentText = (value: string) =>
  renderHtmlText(parseFragment(value), { format: "plain" });

const getParentNode = (node: HtmlParentNode) => ("parentNode" in node ? node.parentNode : null);

const countPreformattedAncestors = (node: HtmlParentNode) => {
  let count = 0;
  let current = getParentNode(node);
  while (current) {
    if (isHtmlElement(current) && PREFORMATTED_TAG_NAMES.has(current.tagName)) {
      count += 1;
    }
    current = getParentNode(current);
  }
  return count;
};
