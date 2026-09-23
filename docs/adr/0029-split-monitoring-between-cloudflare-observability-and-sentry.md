# 監視はCloudflareのログとSentryに分け、Neonを叩く監視は置かない

有料で出す以上、壊れたことに利用者からの連絡より先に気づく必要がある。一方で個人で運用するので、見る場所と通知の出どころは少ないほうがよい。

役割を二つに分ける。Cloudflare Workers LogsとWorkers Tracesは調べるためのデータで、すべてのリクエストとImport Jobの構造化ログと、binding・外部fetchのspanを持つ。Sentryは知らせるための場所で、直すべき例外と、サービスが使えなくなったことを受け持つ。通知はSentryのメールだけにする。

## Sentryへ送るもの

送るのは、利用者に失敗として見え、コードか運用で直す必要があるものに限る。

- APIの`onError`で500になった例外。4xxの`HTTPException`は入力や権限による想定内の失敗なので送らない。
- Import Queueの最後の配信で、Jobを失敗にする例外。再試行で直った失敗は利用者に見えないので送らない。
- DLQに落ちたImport Job。
- handlerの外へ漏れた例外（bindingの検証失敗など）。SDKがそのまま拾う。

Stripe webhookの失敗は`onError`の経路で送り、`route` tagで見分けてアラートにする。署名検証の失敗は400を返すだけで送らない。インターネットから届く不正なリクエストは異常ではない。

送る内容はログと同じ線に揃える。request body（レシピ本文、Stripeのpayload）、request header（cookie、iOS共有のtoken）、利用者のIP、URLのqueryは送らない。Workerの外部fetchのbreadcrumbは取り込み元のURLや署名付きURLを含むので、originだけを残す。これはログに`sourceHost`だけを残すのと同じ扱いである。利用者はidだけを載せる。

Sentryのtracingは使わない。WorkerのspanはWorkers Tracesがbindingまで自動で取るので、二つ持つと同じものを二重に計装することになる。

## DLQは件数を見るのでなく処理する

通常の失敗は最後の配信でJobを失敗にしてackするので、DLQには届かない。届くのはconsumer自体が落ちたとき（最後の配信でのDB障害、実行時間の上限など）で、そのJobはqueued/runningのまま残る。利用者が画面を開くまで`job_timeout`にならず、完了通知も届かない。

DLQにconsumerを置き、Jobを失敗に確定させて通知を出し、Sentryへ送る。件数を定期的に見るだけだと、保持期限が切れるまで同じ状態が鳴り続け、Jobも宙に浮いたままになる。

## Queueの滞留はmetricsだけで見る

5分ごとのcronで`IMPORT_QUEUE.metrics()`を読み、最古の未ackメッセージが「Jobの期限（`IMPORT_JOB_TIMEOUT_MS`）+5分」より古ければ停滞とみなす。期限を過ぎたJobは次の配信ですぐ`job_timeout`になりackされるので、正常ならこれより古いメッセージは残らない。backlogの件数では判定しない。この規模では件数の多さは故障を意味しない。

結果はSentry Cronsのcheck-inで伝える。cronが動かなければmissedになるので、実行が止まったこともこのmonitorで分かる。停滞は例外にせずcheck-inの`error`にする。例外にするとissueとmonitorの二重通知になる。

## 外形監視はDBに触れない

Sentry Uptimeで`GET /api/health`を1分ごとに見る。このendpointはWorkerが応答できることだけを示し、DBには触れない。bindingの検証はfetchの入口で先に走るので、設定の誤りでWorkerが応答できない状態はここでも500として見える。

Neonは何もしない状態が5分続くとcomputeを止める。1分ごとの外形監視や5分ごとのcronがDBを叩くと、止まらずにcomputeの時間が積み上がる。監視のためにDBの常時稼働を決めることはしない。DBの障害は、利用者のリクエストが500になった時点で`onError`から届く。

`/`は監視しない。`/`はWorkerを通らずassetsから返るので、Workerが動いているかを表さない。

## releaseとsource map

webとWorkerは1回のdeployで同時に出るので、releaseはgit SHAにして両方で使う。どちらもminifyしているので、source mapが無いとSentryのstack traceは読めない。deployは`apps/api/scripts/deploy.mjs`にまとめ、webのsource mapは`@sentry/vite-plugin`が、Workerのsource mapは`sentry-cli`が上げる。webの`dist`はそのまま公開されるので、上げたsource mapは`dist`から消す。commitしていない変更がある状態と、tokenやDSN（webの`VITE_SENTRY_DSN`とWorkerのsecretの`SENTRY_DSN`）が無い状態ではdeployしない。

## 採らなかった案

- **外形監視とheartbeatにBetter Stackを使う**：Free planにステータスページが付くが、「personal projects」向けであり、有料のサービスで使ってよいかが規約次第になる。SentryのDeveloper planにはuptime monitorとcron monitorが1つずつ含まれ、必要な監視はちょうどこの2つである。通知の出どころも1つで済む。
- **`@sentry/hono`のmiddlewareを使う**：route patternでtransactionを名付けられるが、覆うのはfetchだけである。このWorkerはfetch・queue・cronを1つのdefault exportで持ち、`withSentry`と併用する方法は公式に示されていない。初期化の経路が二つになるより、`withSentry`で全体を包み、送るかどうかは`onError`で決めるほうが一か所で済む。
- **health checkでNeonに`SELECT 1`を投げる**：DBまで含めた疎通が分かるが、scale-to-zeroが効かなくなる。
- **Scheduled Workerを別に立てる**：Queueのmetricsはbindingから読めるので、別のWorkerとAPI tokenを持つ理由がない。
