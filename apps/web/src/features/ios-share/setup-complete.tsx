import { Check } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SectionHeader } from "../../components/section-header";
import { PushNotificationSettings } from "../push-notifications/settings-section";
import { ShareFlow } from "./share-flow";

/**
 * 設定を始めてから、新しいキーに共有が届いた。取り込みそのものはアイランドがこの画面にも出すので、
 * ここでは連携が済んだことと、次から押すものだけを伝える。共有が取り込みにならない（リンクがなかった）こともある。
 * 届いたのがどの端末からかは分からない（Safariで設定を済ませたキーのこともある）ので、端末の名前は出さない。
 */
export const ShortcutSetupComplete = () => {
  const nextHeadingId = useId();

  return (
    <div className="grid gap-10">
      <section
        className="flex flex-col items-center gap-2.5 rounded-[16px] border border-brand-line-soft bg-brand-paper px-5 pt-7 pb-6 text-center shadow-pantry-sm"
        role="status"
      >
        <span className="grid size-14 place-items-center rounded-full bg-brand-sage-soft text-brand-sage-dark">
          <Check aria-hidden="true" size={28} weight="bold" />
        </span>
        <h2 className="font-bold text-[21px] text-brand-walnut leading-normal">連携できました</h2>
        <p className="text-brand-muted text-sm leading-6">共有が届きました。</p>
      </section>

      <section aria-labelledby={nextHeadingId} className="grid gap-3">
        <SectionHeader id={nextHeadingId} title="次からは" />
        <ShareFlow after="「取り込みを開始しました」" />
        <p className="text-brand-muted text-sm leading-6">
          取り込みはアプリを閉じていても進みます。できあがったレシピは一覧に並びます。
        </p>
      </section>

      <PushNotificationSettings />

      <Link className={cn(buttonVariants(), "h-11 w-full text-base no-underline")} to="/recipes">
        レシピ一覧へ
      </Link>
    </div>
  );
};
