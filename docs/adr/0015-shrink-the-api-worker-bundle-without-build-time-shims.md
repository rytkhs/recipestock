---
status: accepted
---

# API Worker の bundle を build 時 shim なしで縮小する

API Worker の bundle は raw 4,709.5 KiB / gzip 811.75 KiB で、Cloudflare が報告する `startup_time_ms` は 149 ms だった。gzip size は有料プランの上限 10 MiB に対して十分小さく、削減の目的は size そのものではなく cold start である。

`wrangler deploy --dry-run --metafile` が出力する esbuild metafile を集計したところ、寄与の大きい順に kysely 611.7 KiB、AI SDK 一式 775.4 KiB、Resend SDK 454.1 KiB、zod v4 の locales 273.3 KiB、web-push 257.3 KiB、OpenTelemetry 173.3 KiB、Stripe SDK 165.4 KiB だった。Issue が疑っていた `auth.ts` の top-level import は、`createAuthService` が遅延 factory であるため起動時の実行コストにはなっておらず、実体は bundle と parse のコストだった。一方で wrangler の minify が無効のままだった。

そこで次の3つを採用する。wrangler の `minify` を有効にする。`upload_source_maps` は既に有効なので stack trace は復元できる。Resend は SDK をやめ、Email API へ直接 POST する client に置き換える。SDK は送信のほかに webhook 検証（svix）と受信 mail 解析（postal-mime）を抱えており、利用しているのは `emails.send` だけだった。`@ai-sdk/provider-utils` は `ai` 系と `@ai-sdk/groq` が別 version を引いて二重に bundle されていたため、pnpm の overrides で寄せる。結果は raw 2,046.4 KiB / gzip 532.97 KiB、`startup_time_ms` は 124〜132 ms である。

Resend client は送信失敗を throw する。SDK は失敗を `{ data, error }` で返し、呼び出し側はそれを読んでいなかったため、送信失敗が Better Auth へ伝わらず sign-up が成功したように見えていた。この経路は throw する側が正しい。

kysely、OpenTelemetry、zod の locales は library 側の静的 import と再 export に起因し、build 時の alias stub か pnpm patch でしか外せない。合計 1,058.3 KiB になるが、third-party の内部構造に依存する仕掛けを持ち込まず、upstream の修正と version 更新を待つ。AI SDK 一式は Queue 経路からしか実行されないが、fetch handler と queue handler が同一 script である限り bundle からは外せない。Worker 分割の可否は ADR ではなく Issue #119 の検証で判断する。

bundle の構成は `apps/api/scripts/analyze-bundle.mjs` で再計測できる。`startup_time_ms` は `wrangler versions upload` の出力から取る。同一 code でも 124 ms と 132 ms のばらつきがあるため、単発の値では小さい差を判定しない。
