# アトミックな書き込みは単一SQLで表す

APIはCloudflare Workersから`drizzle-orm/neon-http`でNeonに接続しており、このドライバはinteractive transactionを持たない。そのため、アトミック性・同時実行制御・冪等性が必要な書き込み（保存上限の適用、AI利用回数の消費、Stripe webhookの冪等性など）は、制約・CTE・`ON CONFLICT`を使った単一SQLで表す。通常のCRUDはDrizzleのクエリビルダーを使う。

インタラクティブトランザクションのユースケースが増え、単一 SQL では読みづらい、または保守しづらくなる場合は、Cloudflare Workers 上での WebSocket 接続の挙動と運用コストを検証したうえで、drizzle-orm/neon-serverless などへの移行を再検討する。