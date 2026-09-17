# iOS共有Shortcut

`VITE_IOS_SHARE_SHORTCUT_URL`から配布するShortcutの定義と、対応するAPI契約の記録。iCloudリンクの実体はレビューもdiffも取れないため、API契約を変更するときは必ずこの文書と突き合わせる。

配布後のShortcutは更新できない。判断ロジックはサーバーに置き、Shortcutは受け取った文字列を表示するだけにする（ADR 0008）。

## 現行バージョン

`X-Shortcut-Version: 1`

## アクション列

Shortcutの名前は「Recipe Stockに保存」とする。共有シートのアクション一覧にこの名前で並ぶ。

1. **共有シートから受け取る** — 受け付ける型はURL、テキスト、Safari Webページ、記事
2. **テキスト** — 手順1の入力をテキストへ変換する
3. **URLの内容を取得**
   - URL: `https://<app-host>/api/shortcut/import-jobs`
   - メソッド: `POST`
   - ヘッダ: `Authorization: Bearer <連携トークン>` / `X-Shortcut-Version: 1`
   - 本文: JSON、`input` = 手順2の結果
4. **通知を表示** — タイトル `notice.title`、本文 `notice.body`
5. **もし** `notice.openUrl` が `https://` を含む **なら** — **URLを開く** `notice.openUrl`

連携トークンは、Shortcut追加時のインポート質問でユーザーが貼り付ける。質問文は「Recipe Stockでコピーした連携トークンを、長押しして貼り付けてください」とする。ショートカットAppの中でユーザーが読める説明はこの一文だけである。判断ロジックはゼロ、分岐は手順5の1つだけである。

`notice.body`は常に存在し、2行目を出さないreasonでは空文字になる。手順4はbodyの有無を分岐せず、空文字のときはタイトルだけの1行通知になる。

手順5に「値がある」を使わない。Shortcutsの「値がある」は空でないことの判定ではなく、辞書から取り出した値は空でも「値がある」側へ流れる。JSONの`null`が「値なし」「空文字」「文字列`null`」のどれになるかはAppleが仕様として公開しておらず、iOSの版で変わりうる。配布後のShortcutは更新できないため、この未定義の挙動に分岐を賭けない。`openUrl`は必ず絶対URLなので、`https://`を含むかどうかで判定すれば`null`がどう化けても必ず偽になる。

## API契約

### Request

```http
POST /api/shortcut/import-jobs
Authorization: Bearer rssc_...
X-Shortcut-Version: 1
Content-Type: application/json

{ "input": "この唐揚げ美味しそう https://www.instagram.com/p/xxxx/ #レシピ" }
```

`input`は共有入力をテキスト化したもので、1〜8192文字。URLの抽出はサーバーが行う。

連携トークンは`rssc_`と乱数25文字（`[A-Za-z0-9_-]`）の計30文字で、150bitである。DBにはSHA-256のhashだけを保存し、末尾4文字を`tokenSuffix`として平文で持ち、設定画面の連携済み端末一覧に出す。suffixは平文で公開する分だけ実効エントロピーを削るため、長くしない。認証はhash照合だけで行い長さや文字種を検査しないので、旧形式の発行済みトークンもそのまま有効である。

### Response

routeが把握している結果はすべて`200`で返す。非2xxはrouteが把握していない例外だけであり、Shortcutはそれを表示できない。

```json
{
  "outcome": "accepted",
  "reason": "created",
  "notice": {
    "title": "取り込みを開始しました",
    "body": "",
    "openUrl": null
  }
}
```

| `reason` | `outcome` | `body` | `openUrl` |
| --- | --- | --- | --- |
| `created` | `accepted` | 空文字 | なし |
| `existing_active_job` | `accepted` | 空文字 | なし |
| `no_url_in_input` | `rejected` | 空文字 | なし |
| `invalid_url` | `rejected` | あり | なし |
| `malformed_request` | `rejected` | あり | なし |
| `recipe_limit_exceeded` | `rejected` | あり | `/settings/billing?upsell=recipe_limit&from=shortcut` |
| `ai_usage_limit_exceeded` | `rejected` | あり | `/settings/billing?upsell=ai_usage_limit&from=shortcut` |
| `ai_usage_quota_exhausted` | `rejected` | あり | なし |
| `rate_limit_exceeded` | `rejected` | 空文字 | なし |
| `temporarily_unavailable` | `rejected` | あり | なし |
| `unauthorized` | `rejected` | あり | なし |
| `setup_verified` | `accepted` | 空文字 | なし |

`openUrl`のキーは常に存在し、遷移先がないreasonでは`null`になる。`body`と違い空文字は返さない。

再連携を促す`malformed_request`と`unauthorized`は`openUrl`を持たない。「URLを開く」はhttpsのURLをSafariで開き、standaloneでない設定画面は「ホーム画面へ追加してください」しか表示しないため、導線にならない（ADR 0025）。`body`でRecipe Stockの設定から追加し直すよう伝える。

`setup_verified`は設定画面の試し共有にだけ返す。取り出したURLのoriginが`APP_ORIGIN`と一致し、pathが`/shortcut/test`のとき、認証とcredential単位のrate limitを通過したあとでImport Jobを作らずに返す。保存上限にもAI利用回数にも数えない。認証に成功したrequestは、試し共有かどうかに関わらず、その連携トークンの`first_used_at`が空であれば書き込む。

バナーは一瞥されるだけの表示であり、`body`は次に取るべき行動があるreasonにだけ置く。`title`の言い換えにしかならない2行目は持たせない。

AI月次上限はプランでreasonを分ける。保存上限がfreeの投稿を先に止めAIを消費させないため、freeが`ai_usage_limit_exceeded`に達するのは例外的であり、実際に到達するのは主にProである。すでに払っているProへ「Proにすると」と案内しても意味がないので、`ai_usage_quota_exhausted`はopenUrlを持たせずリセット時期だけを伝える。リセットはJST月初固定なので「毎月1日」は常に真であり、日付を補間する必要はない。

AI上限は濫用防止の安全弁であり、プランが売る枠ではない。上限値は運用中にenvで変えられるため、`body`に具体的な回数を書かない。数字を書けばそれ自体が仕様として読まれ、上限の調整がユーザーの期待を裏切ることになる。

表示文言は`apps/api/src/ios-share-notices.ts`が唯一の出所であり、Shortcutは文言を組み立てない。`reason`はHTTPステータスに代わる監視の軸で、routeは結果ごとに`ios_share_shortcut_import_submitted`を出力する。`malformed_request`、`unauthorized`、`rate_limit_exceeded`、`temporarily_unavailable`、`ai_usage_quota_exhausted`はwarn、それ以外はinfo。freeのAI上限到達はコンバージョン機会であり通常の利用結果だが、proの枠切れは容量または濫用の兆候であるため別のlevelで扱う。

`unauthorized`のログには`authFailure`を付ける。`Authorization`にtokenがなければ`missing_token`（インポート質問を空欄のまま追加した）、照合できなければ`unknown_token`（別の文字列を貼った、または連携を解除した）である。

`malformed_request`はrequest bodyが契約に合わない場合、`no_url_in_input`は`input`にURLが含まれない場合であり、両者を混ぜない。前者はクライアントの契約違反、後者はユーザーの通常の操作結果である。

`rate_limit_exceeded`は2つの安全弁から返る。`credentialId`単位の毎分10回（ADR 0006）と、認証へ到達する前にclient IP単位で引く毎分60回である。後者は、無効なtokenを送り続けるrequestがtoken hash照合のDBアクセスを無制限に起こすのを防ぐ。keyは`cf-connecting-ip`とし、Cloudflareの背後では常に付与されるため、欠落するlocal devやtestでは共通のkeyで数える。IPは監視ログへ残さない。responseはどちらの安全弁でも同じ`reason`と同じnoticeであり、切り分けはログの`rateLimitScope`（`client`または`credential`）で行う。

## 共有入力の実機確認

`受け取るもの`を`すべて`にした状態で、Safari（記事・通常ページ）、Instagram、YouTube、LINE、X、レシピアプリから共有したとき、`input`の先頭に現れる`https://`は常に共有対象のURLと一致した。記事本文が`input`へ入る事象は観測されていない。したがってサーバー側の抽出は先頭のURLを採用し、`input`の上限は8192文字とする。

画像・スクリーンショットを共有した場合、`input`にはファイル名が入る。URLを含まないため`no_url_in_input`となる。画像の共有取り込みは未対応である。

受け取る型やこの前提を変える場合は、同じ確認をやり直してから契約を決める。

## 分岐の実機確認

配布前に、`openUrl`が`null`のreason（`created`）と`openUrl`を持つreason（保存上限に達したfreeアカウントでの`recipe_limit_exceeded`）の両方を実機で通し、前者で遷移も失敗も起きないこと、後者で遷移することを確認する。手順5はShortcut唯一の分岐であり、配布後は修正できない。

## セットアップの実機確認

設定カードの挙動は次の前提に依存する（ADR 0025）。配布前にホーム画面から開いたPWAで確認し、崩れていれば設定カードを直す。

- **発行後の移動**：「ショートカットを追加」のタップで、発行を待ってクリップボードへ書き込んだあと、`location.assign`でショートカットの追加画面まで到達する。到達しなければ、コピーが成功してから追加リンクを出す2タップに分ける。
- **試し共有**：`navigator.share`で開いた共有シートにこのShortcutが並ぶ。`navigator.share`のPromiseがShortcutの実行完了より後に解決し、取り直した一覧に`firstUsedAt`が載る。並ばなければ試し共有をやめる。解決が先であれば、解決後の取り直しを数回に増やす。
- **再追加**：同じ名前のShortcutを追加し直したときに、置き換わるか「2」付きで増えるか。置き換わるなら、設定カードの「前に追加した『Recipe Stockに保存』を削除してください」を消す。
- **送信の許可**：初回実行時に出る許可ダイアログの文言と「常に許可」の有無。設定カードの「許可してください」をそれに合わせる。

## 変更時の手順

1. `apps/api/src/routes/ios-share.ts`と`apps/api/src/ios-share-notices.ts`を変更する
2. 文言や遷移先だけの変更であれば、Shortcutの再配布は不要
3. アクション列やrequestの形が変わる場合は`X-Shortcut-Version`を上げ、この文書を更新し、古い版へ更新を促す`notice`を返す経路を用意し、「分岐の実機確認」を行ってから配布する
