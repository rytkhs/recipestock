# YouTube source extraction に YouTube Data API を使用する

YouTube URL import では、Worker から YouTube watch HTML を通常 fetch して `ytInitialPlayerResponse` を抽出する方式をやめ、YouTube Data API v3 の `videos.list` `snippet` を使用します。

取得対象は title、description、channelTitle、thumbnails です。動画の音声、映像、字幕は解析しません。

Worker fetch の結果は実行環境によって安定せず、Cloudflare Workers から必要な player response を取得できないケースがあるためです。YouTube Data API は API key と quota 管理が必要ですが、URL import では video id が既知なので `videos.list` 1 call で必要なmetadataを取得できます。

YouTube adapter は generic HTML conversion へ fallback しません。YouTube source extraction が失敗した場合は import 失敗として扱います。
