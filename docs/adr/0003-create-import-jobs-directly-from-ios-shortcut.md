# iOSの共有はShortcutから直接Import Jobを作る

iOSのWebKitはWeb Share Targetを実装していないため、manifestの`share_target`ではiOSの共有を受け取れない。そこで、iOS Shortcutが共有された入力をBearer認証付きのendpointへ送り、サーバーがImport Jobを作る。PWAの起動、インストール、Push通知の許可は、取り込みの前提にしない。

## 採らなかった案

- **Shortcutがサーバーに短命なhandoffを作り、非公開の`webapp:` URL schemeでPWAを起動して受け取らせる**：`webapp:`はpathとqueryを渡さない。PWAの起動と復帰、受け取りの確認、Safariへのfallbackに依存し、取り込みまでの操作と状態が増える。一度この方式で実装し、置き換えた。
