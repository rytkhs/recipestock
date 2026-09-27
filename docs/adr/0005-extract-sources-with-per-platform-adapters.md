# 取り込み元の読み取りはプラットフォームごとのadapterで行う

URL取り込みでは、取り込み元の読み取りを対象プラットフォームごとの明示的なadapterで行い、必要になるまで汎用のmetadata serviceは置かない。YouTubeはYouTube Data APIの`videos.list`を使う。Workersからwatch HTMLを取得しても、必要なデータが安定して得られないためである。InstagramとXは、Workerから直接取得したHTMLを読む。TikTokは`https://www.tiktok.com/embed/v2/{id}`のHTMLに埋め込まれたJSONを読む。これは非公開の内部契約で、構造が変われば静かに壊れるため、TikTokの`extraction_failed`を監視する。

## 採らなかった案

- **yt-dlpをCloudflare Containersで動かす**：一度入れたがより軽く実装できたため外した。
- **Browser Renderingで描画後のDOMを読む**：TikTokのcaptionの改行を得られるが、1件に13〜20秒かかり、断続的に失敗し、費用もかかる。改行が畳まれたcaptionでも、promptで材料グループを抽出できる。
- **TikTokのoEmbed**：photo carouselに400を返す。
