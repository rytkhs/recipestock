# 読み取り経路ではplanを書き戻さず導出だけ行う

`/api/me`と`/api/recipes`は、応答を組み立てる前に`syncAppUserPlanForDb`を呼んでいた。この関数は`app_users`行の存在を保証し、保存済みのplanとsubscriptionsを引き、導出結果が保存値と違えば書き戻す。Neonへの往復に直すと、ensureAppUserで1回、planとsubscriptionsを並列で引いて1回、差分があればさらに1回である。ADR 0012がsessionの往復を消したあと、起動の波2に残る所要はほぼこれになる。

しかしこの再導出は、読み取り経路にフレッシュさを足していない。`listSubscriptionPlans`が読むのはローカルの`subscriptions`テーブルであり、Stripeには問い合わせない。そして`subscriptions`を書くのはStripe webhookであり、webhookは同じ処理の中で`app_users.plan`も更新する。つまり読み取り経路が再導出しているのは、webhookがすでに材料と結論の両方を書き終えた同じ行である。

読み取り経路は導出だけを行う。`readAppUserPlanForDb`は`subscriptions`を1回引き、`derivePlanFromSubscriptions`に渡して終わる。`app_users`は読まないし書き戻さない。`/api/me`と`/api/usage/ai`と`/api/recipes`の一覧・詳細がこれを使う。

## 書き戻しが必要な経路は残す

保存上限とAI上限を強制する単一SQLは、`app_users.plan`を直接読む。`createRecipeEnforcingPlanLimit`は`plan = 'pro' or saved_recipe_count < ...`で保存を予約し、Import Jobの投稿は`selected_user`から読んだplanで保存上限とAI上限を評価し、`completeJobWithRecipe`も同じ形で保存を予約する。ADR 0001が定めたとおりこれらはアトミック性のために単一SQLへ畳まれており、SQLの外で導出したplanを渡す形にはなっていない。したがってこの3経路では、直前の`syncAppUserPlanForDb`による書き戻しが判定の前提そのものであり、残す。

キュー処理中の`consumeAiUsage`も同期版を使い続ける。ここは起動経路ではなく往復数が体感に効かないうえ、書き戻しによる自己修復の機会を1つ残しておく価値がある。

結果として`app_users.plan`は、webhookと上限を強制する経路が維持するmaterialized valueという位置づけになる。読み取り経路はそれを訂正しない。

## nowに依存するのはpast_dueだけである

書き戻しを外すと、読み取りが返すplanは`app_users.plan`ではなく毎回の導出結果になる。両者がずれうるのは`isProSubscription`が`now`を見るケースだけであり、それは`status`が`past_due`でかつ`currentPeriodEnd`を過ぎた場合に限られる。`active`と`trialing`は期間を見ずにproと判定する。

このケースで読み取りはfreeを返し、`app_users.plan`は次のwebhookか次の書き込みまでproのままになる。ユーザーに見えるplanとlocked判定はどちらも導出結果で決まるため、表示と強制の間に不整合は生まれない。強制側が一時的に緩いままになるが、それは書き戻しを外す前から、webhookが届くまでの間に同じだけ存在していた状態である。

## app_users行の作成は読み取りが担わない

`readAppUserPlanForDb`は`ensureAppUser`を呼ばない。導出は`subscriptions`だけで決まるため行の存在を必要としないうえ、行を実際に必要とするのは`app_users`を更新する書き込み経路であり、そこはすべて`syncAppUserPlanForDb`を通る。行そのものはsignup時にBetter Authの`databaseHooks.user.create.after`が作る。読み取り経路のensureは、作成を保証すべき地点から離れた場所に置かれた重複であり、外す。
