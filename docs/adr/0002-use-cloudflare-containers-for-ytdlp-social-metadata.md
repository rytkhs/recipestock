# yt-dlp ソーシャルメタデータ抽出に Cloudflare Containers を使用する

TikTok など、Worker の通常 fetch だけでは投稿本文、caption、description、thumbnail、attached images などの AI 正規化用 source extraction を安定して作れない SNS 投稿 URL import では、`yt-dlp` を実行する metadata service を Cloudflare Containers 上に置き、Cloudflare Worker から container-enabled Durable Object binding 経由で呼び出します。動画の中身は解析しません。

Worker 本体には `yt-dlp` と Python 実行環境を入れず、`yt-dlp` が必要な SNS adapter は URL 正規化と `yt-dlp` metadata から `RecipeImportAIInput` への変換だけを担当します。container と client の interface は platform を受け取る `yt-dlp` metadata source extraction として設計します。

Instagram adapter は `yt-dlp` metadata service の対象外にします。Instagram は canonical URL の `embed/` HTML を Worker から直接 fetch し、`contextJSON.gql_data.shortcode_media` から caption、author、display images、carousel children を抽出します。単一画像投稿と carousel の画像は `sourceMediaUrls` と `imageCandidates` に配置し、Reel と動画投稿は cover image だけを `coverImageUrl` に配置します。

Twitter/X は public SSR HTML の `og:description`、`NoteTweet` text、`pbs.twimg.com` media URL から投稿本文と画像候補を抽出できるため、`yt-dlp` metadata source extraction の対象外にします。X/Twitter adapter は X API、Browser Rendering、`yt-dlp` を使わず、direct HTML fetch の結果だけを処理します。

Cloudflare Browser Run は Instagram adapter の fallback にしません。embed metadata 取得失敗、ログイン要求、private 投稿、caption 不在は import 失敗として扱います。
