# sessionを署名付きcookie cacheから返す

Better Authの`session.cookieCache`を有効にし（maxAge 60秒）、認証のたびにDBからsessionを引かないようにする。レシピ画像も認証を通るので、以前は一覧を開くとサムネイルの枚数だけsessionの照会が走っていた。その代わり、他端末でのsessionの遮断（パスワードのリセットや変更による失効など）は、最大60秒遅れて効く。自端末のログアウトは即時である。

## 401の回復経路だけはcacheを迂回する

APIが401を返したあとのfresh sessionの確認（`getFreshAuthSession`）は、`disableCookieCache`を指定してDBを引く。cacheから答えると必ずauthenticatedが返り、回復経路が働かなくなるためである。
