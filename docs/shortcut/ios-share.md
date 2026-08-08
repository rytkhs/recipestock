# iOS共有Shortcut

`VITE_IOS_SHARE_SHORTCUT_URL`から配布するShortcutの定義と、対応するAPI契約の記録。iCloudリンクの実体はレビューもdiffも取れないため、API契約を変更するときは必ずこの文書と突き合わせる。

配布後のShortcutは更新できない。判断ロジックはサーバーに置き、Shortcutは受け取った文字列を表示するだけにする（ADR 0008）。

## 現行バージョン

`X-Shortcut-Version: 1`

## アクション列

1. **共有シートから受け取る** — 受け付ける型はURL、テキスト、Safari Webページ、記事
2. **テキスト** — 手順1の入力をテキストへ変換する
3. **URLの内容を取得**
   - URL: `https://<app-host>/api/ios-share/shortcut/import-jobs`
   - メソッド: `POST`
   - ヘッダ: `Authorization: Bearer <連携トークン>` / `X-Shortcut-Version: 1`
   - 本文: JSON、`input` = 手順2の結果
4. **通知を表示** — タイトル `notice.title`、本文 `notice.body`
5. **もし** `notice.openUrl` に値がある **なら** — **URLを開く** `notice.openUrl`

連携トークンは、Shortcut追加時のインポート質問でユーザーが貼り付ける。判断ロジックはゼロ、分岐は手順5の1つだけである。

## API契約

### Request

```http
POST /api/ios-share/shortcut/import-jobs
Authorization: Bearer rssc_...
X-Shortcut-Version: 1
Content-Type: application/json

{ "input": "この唐揚げ美味しそう https://www.instagram.com/p/xxxx/ #レシピ" }
```

`input`は共有入力をテキスト化したもので、1〜8192文字。URLの抽出はサーバーが行う。

### Response

routeが把握している結果はすべて`200`で返す。非2xxはrouteが把握していない例外だけであり、Shortcutはそれを表示できない。

```json
{
  "outcome": "accepted",
  "reason": "created",
  "notice": {
    "title": "取り込みを開始しました",
    "body": "完了したらお知らせします。",
    "openUrl": null
  }
}
```

| `reason` | `outcome` | `openUrl` |
| --- | --- | --- |
| `created` | `accepted` | なし |
| `existing_active_job` | `accepted` | なし |
| `no_url_in_input` | `rejected` | なし |
| `invalid_url` | `rejected` | なし |
| `recipe_limit_exceeded` | `rejected` | `/settings/billing?upsell=recipe_limit&from=shortcut` |
| `rate_limit_exceeded` | `rejected` | なし |
| `temporarily_unavailable` | `rejected` | なし |
| `unauthorized` | `rejected` | `/settings` |

表示文言は`apps/api/src/ios-share-notices.ts`が唯一の出所であり、Shortcutは文言を組み立てない。`reason`はHTTPステータスに代わる監視の軸で、routeは結果ごとに`ios_share_shortcut_import_submitted`を出力する。

## 変更時の手順

1. `apps/api/src/routes/ios-share.ts`と`apps/api/src/ios-share-notices.ts`を変更する
2. 文言や遷移先だけの変更であれば、Shortcutの再配布は不要
3. アクション列やrequestの形が変わる場合は`X-Shortcut-Version`を上げ、この文書を更新し、古い版へ更新を促す`notice`を返す経路を用意してから配布する
