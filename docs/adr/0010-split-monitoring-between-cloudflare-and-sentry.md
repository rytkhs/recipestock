# 監視はCloudflareのログとSentryに分け、DBに触れる監視は置かない

個人で運用するので、見る場所と通知の出どころを絞る。Cloudflare Workers LogsとWorkers Tracesは調べるためのデータとし、Sentryは知らせる場所とする。通知はSentryからだけ出す。Sentryへは、利用者に失敗として見え、直す必要がある例外だけを送る。

外形監視（Sentry Uptimeによる`GET /api/health`）とQueueの滞留を見るcronは、DBに触れない。Neonは何もしない状態が5分続くとcomputeを止める。1分や5分ごとにDBを叩くと、computeが止まらず、その時間が積み上がり続ける。DBの障害は、利用者のリクエストが500になった時点で届く。

## 採らなかった案

- **health checkでNeonに`SELECT 1`を投げる**：DBまで含めた疎通は分かるが、scale-to-zeroが効かなくなる。
- **外形監視にBetter Stackを使う**：無料プランは個人プロジェクト向けで、有料のサービスで使えるかどうかは規約次第になる。SentryのDeveloper planにはuptime monitorとcron monitorが1つずつあり、必要な監視に足りる。
- **Sentryのtracing**：Workers Tracesがbindingまで自動でspanを取るので、同じものを二重に計装することになる。
