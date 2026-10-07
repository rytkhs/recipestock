import { Export } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useShortcutSetupOffer } from "./use-shortcut-setup-offer";

const shortcutNudgeDismissedStorageKey = "shortcutNudgeDismissed";

const readNudgeDismissed = () => {
  try {
    return localStorage.getItem(shortcutNudgeDismissedStorageKey) === "true";
  } catch {
    return false;
  }
};

const writeNudgeDismissed = () => {
  try {
    localStorage.setItem(shortcutNudgeDismissedStorageKey, "true");
  } catch {
    // 覚えておけなくても、誘いを出している間は閉じたままにできる。絞り込みや画面の移動で出し直すと、また出る。
  }
};

/**
 * レシピを1件でも保存した人に、次は共有ボタンから送れることを勧める。
 * 保存できたあとなら、アプリを切り替える設定にも付き合ってもらいやすい。
 * 連携するか「今はしない」を押すまで出す。閉じたことはlocalStorageに覚えるので、Safariとホーム画面から
 * 開いたアプリでは別々に覚え、アカウントでは分けない。
 */
export const ShortcutSetupNudge = () => {
  const offer = useShortcutSetupOffer();
  const [isDismissed, setIsDismissed] = useState(readNudgeDismissed);

  if (offer.status !== "offer" || isDismissed) {
    return null;
  }

  return (
    <section
      aria-label="共有ボタンからの取り込み"
      className="mt-4 flex gap-3 rounded-[16px] border border-brand-sage-soft bg-brand-sage-soft/30 p-4"
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-sage-soft text-brand-sage-dark"
      >
        <Export size={18} weight="bold" />
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="font-bold text-[15px] text-brand-ink leading-snug">次は、共有ボタンから</p>
        <p className="text-brand-muted text-[13px] leading-[22px]">
          InstagramやSafariを見ながら、共有 → KitchenCat
          で保存できます。URLをコピーしなくて済みます。
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Link className={cn(buttonVariants(), "no-underline")} to="/settings/share">
            設定する（1分）
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              writeNudgeDismissed();
              setIsDismissed(true);
            }}
          >
            今はしない
          </Button>
        </div>
      </div>
    </section>
  );
};
