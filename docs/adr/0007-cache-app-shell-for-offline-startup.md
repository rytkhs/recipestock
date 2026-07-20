# App Shellをprecacheしてオフライン起動を可能にする

Recipe StockのService WorkerはWeb Pushだけを扱っており、アプリ起動に必要なHTML、JavaScript、CSSを保存していない。このため、Service Workerが導入済みでも通信できない状態ではPWAを起動できない。

`vite-plugin-pwa`のWorkbox `injectManifest`を使用し、既存のPush handlerを維持したTypeScript Service Workerへbuild時のprecache manifestを注入する。precache対象は公開App Shellを構成する次のファイルだけとする。

- `index.html`
- Viteが生成した`assets`配下のhashed JavaScriptとCSS
- `manifest.webmanifest`
- `icons/icon-192.png`

API response、session、viewer、Recipe、認証が必要な画像、mutation、screenshot、512px icon、shortcut icon、Google Fontsはキャッシュしない。これらのデータをofflineで利用することやoffline writeは別の決定とする。初回のService Worker installはonlineで成功する必要があり、初回からofflineの起動は保証しない。

Service Workerはprecache routeを他のWorkbox routeより先に登録する。navigation requestはprecache済みの`/index.html`へfallbackするが、`/api`以下は対象外とし、APIをHTMLで応答したりキャッシュしたりしない。Cloudflare WorkerのSPA fallbackはonline navigationを担当し、Service Workerのnavigation fallbackはoffline navigationを担当する。

## 認証済み画面のavailability

App Shellが起動できても、private dataが取得できるとは限らない。protected routeはsessionとviewerを別々のdependencyとして扱い、取得不能時は現在のURLを維持したavailability画面を表示する。private navigationはviewerを信頼できる場合だけ表示し、取得不能時はbrand chromeだけを表示する。

通信失敗は、表示に必要な信頼済みdataがない場合だけ`unavailable`にする。既に取得したviewerがある場合、401以外のbackground refetch失敗では現在の表示を維持する。401は古いviewerを無効とし、user-scoped Query cacheを消してfresh session確認を行う。

availabilityの回復はmanual retry、online、window focus、visibleへの復帰と、2秒・5秒・15秒の有限回retryで行う。自動retryを使い切った後もbrowser eventとmanual retryは利用できる。TanStack Queryのviewer retryとfocus/reconnect refetchは無効化し、回復経路を重複させない。

## 更新とbuild contract

Service Worker登録は`/sw.js`、scope `/`、`updateViaCache: "none"`とする。`skipWaiting()`は使用しない。新しいworkerはApp Shellをprecacheしてwaitingになり、古いclientが閉じた後にactivateする。activate時にclientをclaimし、古いWorkbox cacheを削除する。

Viteの`manifestTransforms`は、必須entryの存在と全entryのallowlist適合をbuild中に検証する。さらにpost-build scriptで`dist/sw.js`の生成、`__WB_MANIFEST` placeholderの除去、必須entry、全hashed JavaScript/CSSの参照、precache entryに`/api`がないことを検証する。
