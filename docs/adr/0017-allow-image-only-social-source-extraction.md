# 静止画像だけの social source extraction を許可する

SNS 投稿の source extraction は、caption、description、title などの有効なテキスト、または投稿本体の保存可能な静止画像のどちらかがあれば成功として扱います。platform ごとに caption の有無だけで成否を決めません。

TikTok photo carousel では ADR 0016 により、画像を保存できること自体に価値があるため caption が空でも成功としていました。この価値は Instagram と X の静止画像投稿にも共通するため、同じ条件を適用します。画像だけの場合、social prompt は画像内容からレシピを推論せず、本文が空の Recipe に cover image と reference images を保存します。

動画の cover や thumbnail は投稿本体の静止画像とはみなしません。現在の source extraction は動画の音声、映像、字幕を解析しないため、動画の cover や thumbnail しかなく、有効なテキストもない場合は `extraction_failed` とします。YouTube は description が空でも title をテキスト evidence として成功できます。

private、login required、unavailable を識別できる platform では、その error を evidence 不足より優先します。画像の配置、重複除去、上限は既存規則を維持します。
