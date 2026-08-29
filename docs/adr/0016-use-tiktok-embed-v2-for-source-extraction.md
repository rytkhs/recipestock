# TikTok source extraction に embed v2 ページを使用する

TikTok URL import では、`https://www.tiktok.com/embed/v2/{id}` の HTML に埋め込まれた `__FRONTITY_CONNECT_STATE__` JSON を単一の取得経路として使用します。取得対象は caption (`itemInfos.text`)、投稿者 (`authorInfos.uniqueId`)、カバー画像 (`itemInfos.coversOrigin` / `covers`)、photo carousel の画像 (`imagePostInfo.displayImages[].urlList`) です。動画の音声、映像、字幕は解析しません。

ADR 0014 が定めたとおり yt-dlp と Container には依存しません。API key、課金サービス、Browser Rendering も追加しません。既存の `context.fetchHtml` をそのまま使えるため、YouTube (ADR 0003) のような client 注入も不要です。

## 経路選定

Cloudflare Workers 実測（12 サンプル）で、oEmbed `/oembed?url=` は photo carousel に対して 400 を返し、watch ページ HTML は photo carousel で必要データを返さないうえ実行元 IP によって captcha shell に化けました。embed v2 は video / photo の両方を 200 で返し、caption は oEmbed および watch ページと完全一致したため、経路を 1 本に絞っています。

caption の改行は TikTok 側でスペースへ正規化されており、これは経路選択では改善できません。材料行の区切りが記号のみになるため、social prompt での変換品質は実サンプルで継続的に確認する必要があります。

## 対応範囲と失敗の扱い

video 投稿と photo carousel の両方に対応します。短縮 URL (`vt.tiktok.com` / `vm.tiktok.com` / `www.tiktok.com/t/`) は adapter 内で 1 度 fetch して `finalUrl` から id を解決します。

photo carousel は、実測したサンプルでは caption にレシピ本文が無く、レシピが画像の中にありました。画像入力の AI 経路が無く social prompt も画像からの推論を禁止しているため、こうした投稿は「参照画像だけが保存され本文が空の Recipe」になります。画像を保存できること自体に価値があると判断してこれを許容し、caption が空でも `displayImages` があれば成功として扱います。video 投稿は Instagram adapter と同じく caption が空なら `extraction_failed` とします。画像入力の AI 経路を用意する際にこの扱いを再訪します。

削除済み、非公開、審査落ち、存在しない id はいずれも embed が HTTP 400 と `errorCode: 10204` を返し、TikTok 側で区別できません。`fetchImportPage` は非 2xx の時点で `fetch_failed` を投げるため、これをそのまま import error code とします。3 者を区別できない以上 `private_or_login_required` に倒すと「存在しない投稿」に対して誤った説明になるため、fetch 層に非 2xx の body を読む経路は追加しません。

canonical URL は `authorInfos.uniqueId` から `https://www.tiktok.com/@{uniqueId}/{video|photo}/{id}` を組み立てます。URL パス上の `@user` は投稿者と一致していなくても TikTok 側で解決されるため、embed が返す値を正とします。`uniqueId` が取れなければ入力 URL の `@user` へフォールバックせず `extraction_failed` とします。フォールバックすると spoof された URL や投稿者が改名した古い URL から誤った `sourceUrl` を保存してしまい、embed を正とする前提が崩れるためです。

video と photo の区別も同じ理由で、URL パスではなく `imagePostInfo.displayImages` が 1 件以上あるかで決めます。判定は要素数のみで行い、画像 URL を取り出せたかどうかとは切り離します。両者を混ぜると、`displayImages` はあるのに `urlList` から URL を取れないとき、photo が video として静かに成立して画像なしの Recipe になるためです。photo と判定したのに画像 URL が 1 件も取れない場合は `extraction_failed` とします。

## リスク

`__FRONTITY_CONNECT_STATE__` は TikTok の非公開な内部契約です。構造が変われば静かに壊れるため、TikTok import の `extraction_failed` 発生を監視対象とします。oEmbed が公式提供であるのに対し、embed ページの JSON 読み取りは非公式利用にあたります。
