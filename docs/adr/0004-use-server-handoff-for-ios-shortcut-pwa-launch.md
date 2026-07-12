# iOS ShortcutからPWAへのURL配送にサーバーhandoffを使用する

iOSの非公開`webapp:` URL schemeはHome Screen Web Appを起動できるが、pathとqueryをPWAへ渡さない。また、対象PWAがインストールされていない場合は空のWeb App画面を開く。WebKitはWeb Share Target APIを実装していないため、manifestの`share_target`だけではiOS共有を受け取れない。

iOS Shortcutは共有URLを認証付きAPIへ送信し、サーバーに短命なShare Handoffを作成してから`webapp:`でPWAを起動する。PWAは起動・復帰時に認証ユーザーのpending Share Handoffを取得し、`/import/url`へ遷移してPWA deliveryを記録する。Shortcutはdelivery状態を短時間確認し、PWAが受理しなければHTTPSの`/import/url`をSafariで開く。

Share HandoffはImport Jobと分離する。Share Handoffの作成やdeliveryではレシピ取り込みを開始せず、ユーザーがURL取り込み画面から送信した時点で既存のImport Jobを作成する。

ShortcutはCookie sessionを利用できないため、設定画面でユーザー・端末単位のBearer tokenを発行する。平文tokenは発行時に一度だけ返し、DBにはSHA-256 hashだけを保存する。tokenの権限はShare Handoffの作成と状態確認に限定する。Cookie認証を使う設定・delivery endpointにはCSRFを適用し、Shortcut endpointにはBearer認証を適用する。

Share Handoffは30分で期限切れになる。同一チャンネルから新しいShare Handoffが作成された場合、既存のpendingをsupersedeする。この更新はneon-httpの制約に合わせ、単一SQLとDB制約でアトミックに行う。`INSERT`は既存pendingを更新するdata-modifying CTEの`RETURNING`結果へ明示的に依存させる。同一チャンネルへの同時リクエストでpendingのpartial unique indexと競合した場合は、その制約の`23505`に限りSQL全体を一度だけ再試行する。

Shortcutは追加時のimport questionでBearer tokenを受け取り、共有実行時に次の順で処理する。

1. 共有入力からHTTPまたはHTTPS URLを取得する
2. `POST /api/ios-share/shortcut/handoffs`へURLを送る
3. 成功したら`webapp://<host>/`を開く
4. 最大4回、1秒間隔で`GET /api/ios-share/shortcut/handoffs/:handoffId`を確認する
5. `delivered_to_pwa`なら終了し、`pending`のままならレスポンスの`fallbackUrl`を開く
6. API作成に失敗した場合は、共有入力をqueryに設定したHTTPSの`/import/url`を開く
