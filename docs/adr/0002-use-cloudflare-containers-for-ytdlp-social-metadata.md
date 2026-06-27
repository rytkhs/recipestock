# yt-dlp ソーシャルメタデータ抽出に Cloudflare Containers を使用する

Instagram、Twitter/X、TikTok などの SNS 投稿 URL import では、投稿本文、caption、description、thumbnail、attached images などの AI 正規化用 source extraction を作り、動画の中身は解析しません。これらのサイトは通常の HTML fetch や oEmbed だけでは安定して必要な情報を取得できないため、`yt-dlp` を実行する metadata service を Cloudflare Containers 上に置き、Cloudflare Worker から container-enabled Durable Object binding 経由で呼び出します。

Worker 本体には `yt-dlp` と Python 実行環境を入れず、SNS ごとの adapter は URL 正規化と `yt-dlp` metadata から `RecipeImportAIInput` への変換だけを担当します。最初は Instagram adapter のみを有効化し、container と client の interface は Twitter/X と TikTok を追加できる `yt-dlp` metadata source extraction として設計します。

Cloudflare Browser Run は Instagram adapter の初期実装では fallback にしません。取得失敗、ログイン要求、private 投稿、caption 不在は import 失敗として扱います。
