# UI コンポーネントライブラリを HeroUI v3 から shadcn/ui (Base UI) に置き換える

`apps/web` の UI プリミティブは shadcn/ui の Base UI ベース（`base-nova` style）を使います。コンポーネントは registry からリポジトリ内の `apps/web/src/components/ui/` にコピーして所有し、`@heroui/react` と `@heroui/styles` は削除しました。

HeroUI v3 は React Aria をラップした npm パッケージで、内部実装と生成 CSS クラスに手が届きませんでした。実際、`apps/web/src/styles.css` にあった `.text-field__input` / `.text-field__textarea` / `.progress-bar__indicator` の上書きは HeroUI 3.1.0 の実クラス名（`.input` / `.textarea` / `.progress-bar__fill`）と一致しておらず、無効なまま気づかれずに残っていました。shadcn/ui はコンポーネント実装そのものをリポジトリに置くため、この種のずれが起きません。Base UI を選んだのは Radix / Floating UI / Material UI のチームによる後継実装であり、React 19 に対応しているためです。

テーマは shadcn の既定トークン（`neutral`）をそのまま使い、Recipe Stock の見た目は従来どおり `--color-brand-*` を各コンポーネントの `className` で当てて表現します。HeroUI のセマンティック変数を Pantry パレットで上書きしていた `src/themes/pantry.css` と `<html data-theme="pantry">` は廃止しました。ブランド配色の定義は `src/styles.css` の `@theme inline` に一本化されています。

移行で API が変わった主なもの: `onPress` → `onClick`、`isDisabled` → `disabled`、`Dropdown.Menu` の `onAction(key)` 集中ディスパッチ → `DropdownMenuItem` ごとの `onClick`、`ToggleButtonGroup` の `selectedKeys` / `onSelectionChange` → `ToggleGroup` の `value` / `onValueChange`（`disallowEmptySelection` は無いのでハンドラ内で空配列を無視する）、選択状態のスタイル `data-[selected=true]:` → `aria-pressed:`、`ProgressBar isIndeterminate` → `Progress value={null}`。`TextField` が React Aria の context で label と control を自動結線していたのに対し、shadcn の `Field` / `FieldLabel` は結線しないため、`useId()` による `htmlFor` / `id` の明示が必要です。アクセシビリティ上の等価性は既存のテスト 5 スイート（`login` / `import` / `recipes` / `settings` / `router`）が role と label で検証しており、テストコードを変更せずに全て通ることを移行の受け入れ条件としました。

Base UI のポップアップ位置決めは Floating UI の `autoUpdate` を経由して `ResizeObserver` を使います。jsdom には無いため、`apps/web/src/test/setup.ts` に `ResizeObserver` と `Element.prototype.scrollIntoView` のスタブを追加しています。

`apps/web/src/components/ui/` は registry の出力なので Biome の lint 対象から外しています（`biome.json` の `overrides`）。フォーマットは適用されます。
