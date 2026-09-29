# iOS共有Shortcut

`VITE_IOS_SHARE_SHORTCUT_URL`から配布するShortcutの定義と、対応するAPI契約の記録。iCloudリンクの実体はレビューもdiffも取れないため、API契約を変更するときは必ずこの文書と突き合わせる。

配布後のShortcutは更新できない。判断ロジックはサーバーに置き、Shortcutは受け取った文字列を表示するだけにする（ADR 0004）。

## 現行バージョン

`X-Shortcut-Version: 1`

## アクション列

1. **共有シートから受け取る** — 受け付ける型はURL、テキスト、Safari Webページ、記事
2. **テキスト** — 手順1の入力をテキストへ変換する
3. **URLの内容を取得**
   - URL: `https://<app-host>/api/shortcut/import-jobs`
   - メソッド: `POST`
   - ヘッダ: `Authorization: Bearer <連携キー>` / `X-Shortcut-Version: 1`
   - 本文: JSON、`input` = 手順2の結果
4. **通知を表示** — タイトル `notice.title`、本文 `notice.body`
5. **もし** `notice.openUrl` が `https://` を含む **なら** — **URLを開く** `notice.openUrl`

連携キーは、Shortcut追加時のインポート質問でユーザーが貼り付ける。質問文は「Recipe Stockの設定画面でコピーした連携キーを貼り付けてください」とし、設定画面の「共有から取り込む」（`/settings/share`）の言葉と合わせる。判断ロジックはゼロ、分岐は手順5の1つだけである。

画面では「連携トークン」と呼ばない。「トークン」は利用者に伝わらず、インポート質問はアプリの外に出るので説明を添えられない。「キー」は人に見せない・無効にできるという性質を伝え、ログインの「確認コード」とも紛れない。APIとDBでは従来どおりtoken/credentialと呼ぶ。

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

連携キーは`rssc_`と乱数25文字（`[A-Za-z0-9_-]`）の計30文字で、150bitである。DBにはSHA-256のhashだけを保存し、末尾4文字を`tokenSuffix`として平文で持ち、設定画面の連携キーの一覧に出す。suffixは平文で公開する分だけ実効エントロピーを削るため、長くしない。認証はhash照合だけで行い長さや文字種を検査しないので、旧形式の発行済みトークンもそのまま有効である。

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
| `malformed_request` | `rejected` | あり | `/settings/share?reason=malformed_request` |
| `recipe_limit_exceeded` | `rejected` | あり | `/settings/billing?upsell=recipe_limit&from=shortcut` |
| `ai_usage_limit_exceeded` | `rejected` | あり | `/settings/billing?upsell=ai_usage_limit&from=shortcut` |
| `ai_usage_quota_exhausted` | `rejected` | あり | なし |
| `rate_limit_exceeded` | `rejected` | 空文字 | なし |
| `temporarily_unavailable` | `rejected` | あり | なし |
| `unauthorized` | `rejected` | あり | `/settings/share?reason=unauthorized` |

`openUrl`のキーは常に存在し、遷移先がないreasonでは`null`になる。`body`と違い空文字は返さない。

`/settings/share`へ送るreasonには`reason`を添え、開いた画面が、なぜ来たのかを伝えてから入れ直しの手順を出せるようにする。

バナーは一瞥されるだけの表示であり、`body`は次に取るべき行動があるreasonにだけ置く。`title`の言い換えにしかならない2行目は持たせない。

AI月次上限はプランでreasonを分ける。保存上限がfreeの投稿を先に止めAIを消費させないため、freeが`ai_usage_limit_exceeded`に達するのは例外的であり、実際に到達するのは主にProである。すでに払っているProへ「Proにすると」と案内しても意味がないので、`ai_usage_quota_exhausted`はopenUrlを持たせずリセット時期だけを伝える。リセットはJST月初固定なので「毎月1日」は常に真であり、日付を補間する必要はない。

上限値は運用中にenvで変えられるため、`body`に具体的な回数を書かず、文言の一覧を固定のまま保つ。Freeの回数は、遷移先のプランのページが今の値から出す。利用者向けの文言では「AI取り込み」の上限と呼ぶ。

表示文言は`apps/api/src/ios-share-notices.ts`が唯一の出所であり、Shortcutは文言を組み立てない。`reason`はHTTPステータスに代わる監視の軸で、routeは結果ごとに`ios_share_shortcut_import_submitted`を出力する。`malformed_request`、`unauthorized`、`rate_limit_exceeded`、`temporarily_unavailable`、`ai_usage_quota_exhausted`はwarn、それ以外はinfo。freeのAI上限到達はコンバージョン機会であり通常の利用結果だが、proの枠切れは容量または濫用の兆候であるため別のlevelで扱う。

`malformed_request`はrequest bodyが契約に合わない場合、`no_url_in_input`は`input`にURLが含まれない場合であり、両者を混ぜない。前者はクライアントの契約違反、後者はユーザーの通常の操作結果である。

`rate_limit_exceeded`は2つの安全弁から返る。`credentialId`単位の毎分10回と、認証へ到達する前にclient IP単位で引く毎分60回である。後者は、無効なtokenを送り続けるrequestがtoken hash照合のDBアクセスを無制限に起こすのを防ぐ。keyは`cf-connecting-ip`とし、Cloudflareの背後では常に付与されるため、欠落するlocal devやtestでは共通のkeyで数える。IPは監視ログへ残さない。responseはどちらの安全弁でも同じ`reason`と同じnoticeであり、切り分けはログの`rateLimitScope`（`client`または`credential`）で行う。

`unauthorized`もresponseは1つだが、ログの`authFailure`で連携の設定のどこで詰まったかを分ける。

| `authFailure` | 条件 | 主な原因 |
| --- | --- | --- |
| `missing_token` | Bearerがない、または空 | インポート質問でキーを貼らずに追加した |
| `malformed_token` | 照合できず、今の連携キーの形でもない | 別のものを貼った（コピーに失敗した、途中で別のものをコピーした） |
| `unknown_token` | 今の形だが照合できない | 別の環境で発行したキー、手で打ち間違えたキー |
| `revoked_token` | 解除済みのキー | 解除したキーのショートカットを使い続けている。`credentialId`と`userId`を添える |

形の判定はログを分けるためだけに使い、認証はhash照合だけで行う。

## 連携キーの利用の記録

認証を通したrequestは、同じSQLで連携キーの`first_used_at`と`last_used_at`を記録する。取り込みを受け付けたかどうかは問わない。`no_url_in_input`や上限で止まったrequestでも、キーの貼り付けと接続の許可は済んでいるので、連携の設定は済んだとみなす。`first_used_at`は上書きしない。解除済みのキーは記録しない。

設定画面は、どこまで進んだかを端末に覚えず、連携キーの一覧だけから出す画面を決める。ホーム画面から開いたアプリとSafariはlocalStorageもログインも別で、連携し直しの`openUrl`はSafariで開くため、端末に覚えた進み具合は入れ物ごとに食い違う。

- 使ったキー（`firstUsedAt`がある）が1本でもあれば連携済みとし、連携の管理を出す。
- 未連携で、使われていないキーがあれば、設定の続き（共有を待つところ）から出す。
- 設定を始めた時点で使われていなかったキー（その後に発行したキーを含む）のどれかに`firstUsedAt`が入ったら、連携できたと伝える。発行し直す前のキーや、Safariで発行したキーで共有が届いても完了になる。
- 設定が始まるのは、未連携の画面を開いたとき（連携の管理で最後のキーを解除して未連携になったときを含む）、連携し直しに来たとき、「この端末でショートカットを追加する」「最初からやり直す」を押したとき。完了の基準と続きから出すキーは、始めた時点の一覧で決め、その設定の間は変えない。

キーは端末を表さない。ショートカットはiCloudで同じApple IDの端末へ同期されうるので、1本のキーを複数の端末で使うことも、発行し直しや連携し直しで1台に複数のキーが残ることもある。キーの名前（iPhone、iPad）は発行した場所でしかないので、画面は台数を数えず、`lastUsedAt`をキーごとの最後に使った日として出す。使われなくなったキーの片付けは #224 で扱う。

ショートカットから作ったImport Jobは、作ったときの連携キーを`import_jobs.shortcut_credential_id`に残す。同じURLのactive Jobへ合流したときは、作った側の値を書き換えない。アプリから作ったJobはnullである。

## 計測

設定の流れと共有からの利用は、上の列とログから、見たいときにSQLで数える。定期実行の監視は置かない（ADR 0010）。連携キーは発行し直すと同じ人に複数できるので、設定の完了は人単位で数える。

```sql
-- 人ごとの、設定を始めた日時・初めて使えた日時・使われていないキーの数
select user_id,
       min(created_at)    as started_at,
       min(first_used_at) as first_used_at,
       count(*) filter (where first_used_at is null and revoked_at is null) as unused_keys
from shortcut_credentials
group by user_id;

-- 共有から取り込んで保存できた人
select count(distinct user_id)
from import_jobs
where shortcut_credential_id is not null
  and status = 'succeeded';
```

発行してから使われるまでの間で、リクエストが届く失敗（キーを貼っていない、別のものを貼った）は`authFailure`で数えられる。ショートカットを追加していない、接続の確認で「許可しない」を選んだ、はリクエストが届かないので観測できず、使われていないキーとしてだけ現れる。

## 共有入力の実機確認

`受け取るもの`を`すべて`にした状態で、Safari（記事・通常ページ）、Instagram、YouTube、LINE、X、レシピアプリから共有したとき、`input`の先頭に現れる`https://`は常に共有対象のURLと一致した。記事本文が`input`へ入る事象は観測されていない。したがってサーバー側の抽出は先頭のURLを採用し、`input`の上限は8192文字とする。

画像・スクリーンショットを共有した場合、`input`にはファイル名が入る。URLを含まないため`no_url_in_input`となる。画像の共有取り込みは未対応である。

受け取る型やこの前提を変える場合は、同じ確認をやり直してから契約を決める。

## 分岐の実機確認

配布前に、`openUrl`が`null`のreason（`created`）と`openUrl`を持つreason（`unauthorized`）の両方を実機で通し、前者で遷移も失敗も起きないこと、後者で遷移することを確認する。手順5はShortcut唯一の分岐であり、配布後は修正できない。

## 設定の手順の実機確認

設定画面（`apps/web/src/features/ios-share/`）は、アプリの外で起きることを図と文で先に見せる。次はテストでは確かめられないので、iPhoneのSafariとホーム画面から開いたアプリの両方で確かめ、画面の図と文言を実機に合わせる。

- 「キーをコピー」の1回のタップで、発行を待ってからでもクリップボードに書けること（`ClipboardItem`にPromiseを渡している）
- 「ショートカットを追加」から、iCloudのリンクがショートカットAppで開くこと
- 初回の共有で出る接続の確認の文言と選択肢、ほかに送信の確認が出るかどうか
- 同じ名前のショートカットを追加し直したときにiOSが何を聞くか、同期先がどうなるか（置き換わる、2つ並ぶ）。連携し直しの手順の「古いものを削除してから」はこれで決まる
- ショートカットAppやSafariから戻ったとき、一覧の読み直しで「連携できました」に変わること
- キーを貼ったショートカットが、iCloud同期で同じApple IDのiPadやMacに入り、そのキーで共有が届くこと。届かなければ、連携の管理の「ほかの端末でも使うには」（`shortcut-sync-note.tsx`）を消す。届くなら、Macでも連携し直しの`?reason=`が開きうるので、Macの画面にも理由と、iPhoneで入れ直す案内を出す
- Safariとホーム画面から開いたアプリで、ログインとlocalStorageがそれぞれ別になっていること
- `openUrl`（Safariで開く）から、ログインしたあとに`?reason=`付きの同じ画面へ戻り、連携し直せること

## 変更時の手順

1. `apps/api/src/routes/ios-share.ts`と`apps/api/src/ios-share-notices.ts`を変更する
2. 文言や遷移先だけの変更であれば、Shortcutの再配布は不要
3. アクション列やrequestの形が変わる場合は`X-Shortcut-Version`を上げ、この文書を更新し、古い版へ更新を促す`notice`を返す経路を用意し、「分岐の実機確認」を行ってから配布する
