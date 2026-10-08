import { Check } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SectionHeader } from "../../components/section-header";
import { PushNotificationSettings } from "../push-notifications/settings-section";
import { ShareFlow } from "./share-flow";

/**
 * 設定を始めてから、新しいキーか、③を押してからどれかのキーに共有が届いた。たいていは③の確認で、取り込みは始まっていない。
 * ③を押さずにほかのアプリから共有したときは取り込みが始まり、アイランドがこの画面にも出す。どちらでも、ここでは
 * 連携が済んだことと、次から押すものだけを伝える。③からはほかのアプリへ行かないので、
 * ほかのアプリで共有メニューを開く案内と、共有メニューの上の列に出す案内はここで出す。
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
        <p className="text-brand-walnut text-sm leading-6">
          SafariやInstagramで見つけたレシピを、いまと同じように共有します。
        </p>
        <ShareFlow after="「取り込みを開始しました」" />
        <p className="text-brand-muted text-sm leading-6">
          取り込みはアプリを閉じていても進みます。できあがったレシピは一覧に並びます。
        </p>
        <p className="text-brand-muted text-sm leading-6">
          Instagramでは「シェア」、YouTubeでは「その他」を押すと、共有メニューが開きます。
        </p>
        <p className="text-brand-muted text-sm leading-6">
          よく使うなら、共有メニューの「アクションを編集」から「よく使う項目」に入れると、上の列に出ます。
        </p>
      </section>

      <PushNotificationSettings />

      <Link className={cn(buttonVariants(), "h-11 w-full text-base no-underline")} to="/recipes">
        レシピ一覧へ
      </Link>
    </div>
  );
};
