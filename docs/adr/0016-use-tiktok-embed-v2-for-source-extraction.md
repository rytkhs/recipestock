# TikTok source extraction に embed v2 ページを使用する

TikTok URL import では、`https://www.tiktok.com/embed/v2/{id}` の HTML に埋め込まれた `__FRONTITY_CONNECT_STATE__` JSON を単一の取得経路として使用します。取得対象は caption (`itemInfos.text`)、投稿者 (`authorInfos.uniqueId`)、カバー画像 (`itemInfos.coversOrigin` / `covers`)、photo carousel の画像 (`imagePostInfo.displayImages[].urlList`) です。動画の音声、映像、字幕は解析しません。

ADR 0014 が定めたとおり yt-dlp と Container には依存しません。API key、課金サービス、Browser Rendering も追加しません。既存の `context.fetchHtml` をそのまま使えるため、YouTube (ADR 0003) のような client 注入も不要です。

## 経路選定

Cloudflare Workers 実測（12 サンプル）で、oEmbed `/oembed?url=` は photo carousel に対して 400 を返し、watch ページ HTML は photo carousel で必要データを返さないうえ実行元 IP によって captcha shell に化けました。embed v2 は video / photo の両方を 200 で返し、caption は oEmbed および watch ページと完全一致したため、経路を 1 本に絞っています。

caption の改行は embed v2 の `itemInfos.text`、oEmbed の `title`、watch ページ HTML の `__UNIVERSAL_DATA_FOR_REHYDRATION__` が持つ `itemStruct.desc` のいずれでも半角スペースへ正規化されています。HTTP fetch で到達できる範囲に改行は残りません。材料行の区切りが記号のみになるため、social prompt での変換品質は実サンプルで継続的に確認する必要があります。

## 対応範囲と失敗の扱い

video 投稿と photo carousel の両方に対応します。短縮 URL (`vt.tiktok.com` / `vm.tiktok.com` / `www.tiktok.com/t/`) は adapter 内で 1 度 fetch して `finalUrl` から id を解決します。

photo carousel は、実測したサンプルでは caption にレシピ本文が無く、レシピが画像の中にありました。画像入力の AI 経路が無く social prompt も画像からの推論を禁止しているため、こうした投稿は「参照画像だけが保存され本文が空の Recipe」になります。画像を保存できること自体に価値があると判断してこれを許容し、caption が空でも `displayImages` があれば成功として扱います。video 投稿は Instagram adapter と同じく caption が空なら `extraction_failed` とします。画像入力の AI 経路を用意する際にこの扱いを再訪します。

削除済み、非公開、審査落ち、存在しない id はいずれも embed が HTTP 400 と `errorCode: 10204` を返し、TikTok 側で区別できません。`fetchImportPage` は非 2xx の時点で `fetch_failed` を投げるため、これをそのまま import error code とします。3 者を区別できない以上 `private_or_login_required` に倒すと「存在しない投稿」に対して誤った説明になるため、fetch 層に非 2xx の body を読む経路は追加しません。

canonical URL は `authorInfos.uniqueId` から `https://www.tiktok.com/@{uniqueId}/{video|photo}/{id}` を組み立てます。URL パス上の `@user` は投稿者と一致していなくても TikTok 側で解決されるため、embed が返す値を正とします。`uniqueId` が取れなければ入力 URL の `@user` へフォールバックせず `extraction_failed` とします。フォールバックすると spoof された URL や投稿者が改名した古い URL から誤った `sourceUrl` を保存してしまい、embed を正とする前提が崩れるためです。

video と photo の区別も同じ理由で、URL パスではなく `imagePostInfo.displayImages` が 1 件以上あるかで決めます。判定は要素数のみで行い、画像 URL を取り出せたかどうかとは切り離します。両者を混ぜると、`displayImages` はあるのに `urlList` から URL を取れないとき、photo が video として静かに成立して画像なしの Recipe になるためです。photo と判定したのに画像 URL が 1 件も取れない場合は `extraction_failed` とします。

## リスク

`__FRONTITY_CONNECT_STATE__` は TikTok の非公開な内部契約です。構造が変われば静かに壊れるため、TikTok import の `extraction_failed` 発生を監視対象とします。oEmbed が公式提供であるのに対し、embed ページの JSON 読み取りは非公式利用にあたります。

## 追記: watch ページの DOM には改行が残る (2026-09-21)

上の「経路選択では改善できません」という記述は、HTTP fetch で到達できる範囲に限れば正しく、描画後の DOM については誤りでした。Browser Run (`BROWSER` binding の `quickAction("content")`) で watch ページを取得すると、caption は 1 行ごとに `<span data-e2e="desc-span-N">` へ分割され、span の間に `<br>` が入ります。連番から行順を復元できます。同じページの `itemStruct.desc` は空白正規化済みのままなので、改行を得るには JSON ではなく DOM を読む必要があります。

`BROWSER` binding 自体は generic 経路の `IMPORT_FETCH_MODE=browser-run` のために既に存在しますが、source extraction は `deterministicFetcher` を通るため現在も標準 fetch のままです。

実測（3 投稿、いずれも初回で取得成功、所要 13.6 / 19.3 / 20.5 秒）で分かった制約は次のとおりです。

- `gotoOptions.waitUntil` は `networkidle0` が必要です。`networkidle2` と `load` は `execution context was destroyed` (code 6000) を返し、`domcontentloaded` は中身のない 1.6KB を返します。`BrowserRunBinding` 型は `waitUntil: "networkidle2"` をリテラルで固定しているため、採用するなら型から変更が要ります。
- `networkidle0` でも同じ失敗が断続的に発生します（観測は成功 4 / 失敗 1）。リトライが前提になります。
- `resolveImportTimeoutMs` の既定 10,000ms では足りません。job 全体の `DEFAULT_IMPORT_JOB_TIMEOUT_MS` は 600,000ms なので、fetch 側の引き上げで収まります。

それでも embed v2 を単一経路とする決定は維持します。改行が畳まれた caption でも、記号マーカーをグループラベルとして扱う指示を prompt の `ingredientGroups` ルールへ加えることで材料グループを抽出できると確認したためです。DOM 取得が上積みする 13〜20 秒のレイテンシ、Browser Rendering の費用、断続的な失敗は、その差分に見合いません。social prompt で品質を確保できなくなった場合に再訪します。
