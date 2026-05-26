# neon-http と単一 SQL を使用したアトミックな書き込み

この API は Cloudflare Workers 上で動作し、Neon PostgreSQL へのアクセスには `drizzle-orm/neon-http` を使った Drizzle ORM を使用しています。このドライバーは Drizzle のインタラクティブトランザクションをサポートしていないため、アトミック性、同時実行制御、または冪等性が必要な API の書き込みでは、可能な限り PostgreSQL 側で単一の SQL 文、制約、CTE、`ON CONFLICT` を使って保証を表現してください。

通常の CRUD では、引き続き Drizzle のクエリビルダー API を優先してください。レシピのプラン上限適用、AI 使用量のカウント、Stripe Webhook の冪等性などのアトミックな書き込みでは、データベース上の保証を 1 つの文に収められる場合、Drizzle の `sql` タグ付きテンプレートと `db.execute(...)` の使用は許容され、推奨されます。

インタラクティブトランザクションのユースケースが増え、単一 SQL では読みづらい、または保守しづらくなる場合は、Cloudflare Workers 上での WebSocket 接続の挙動と運用コストを検証したうえで、`drizzle-orm/neon-serverless` への移行を再検討してください。
