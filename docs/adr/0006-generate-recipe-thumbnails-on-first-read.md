# 一覧用サムネイルは初回取得時に生成してR2へ保存する

一覧で元画像を配信すると、小さな表示枠でも大きな画像の転送とデコードが必要になる。そこで一覧のサムネイルは、初回の取得時にCloudflare Images bindingで固定の仕様（`v1`）に変換し、`recipes/{userId}/{recipeId}/_thumbnails/{imageFile}/v1.webp`へ保存して、以降はそれを返す。RecipeContentには元画像のキーだけを持つ。変換の仕様を変えるときは、別の版のURLと保存キーにする。
