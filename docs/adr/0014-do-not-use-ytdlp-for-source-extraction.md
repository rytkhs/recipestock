---
status: accepted
---

# source extraction に yt-dlp Container を使用しない

yt-dlp metadata client と Cloudflare Container は Import Job へ注入されていたが、production の source extraction adapter は client を呼び出していなかった。そのため Container は import の成否に寄与せず、Worker bundle と設定、依存関係だけを増やしていた。

yt-dlp metadata client、Container image、Durable Object binding、`@cloudflare/containers` dependency を削除する。既存 namespace にアプリケーションが保持すべきデータはないため、Durable Object migration の `deleted_classes` で class と namespace も削除する。この migration を deploy すると既存 instance の storage は復元できない。

今後の source extraction は、対象 platform ごとの明示的な adapter で実装する。TikTok も yt-dlp に依存しない取得経路を採用し、必要性が確認されるまで汎用 metadata service や Container は追加しない。
