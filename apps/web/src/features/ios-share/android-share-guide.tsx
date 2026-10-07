import { CheckCircle } from "@phosphor-icons/react";
import { useId } from "react";
import { SectionHeader } from "../../components/section-header";
import { isStandaloneWebApp } from "../../pwa/display-mode";
import { guideTextClass, ShareIntro } from "./share-guide";
import { ShortcutKeys } from "./shortcut-keys";

/**
 * Androidでは、ホーム画面に追加したWebアプリがそのまま共有先になる（manifestの`share_target`）。
 * 連携キーもショートカットも使わない。
 */
export const AndroidShareGuide = () => {
  const headingId = useId();

  return (
    <div className="grid gap-10">
      <ShareIntro>
        <p className="text-brand-walnut text-sm leading-6">
          Androidでは、KitchenCatをホーム画面に追加すると、共有メニューに出てきます。キーやショートカットはいりません。
        </p>
      </ShareIntro>

      {isStandaloneWebApp() ? (
        <p className="flex items-start gap-2 rounded-[14px] border border-brand-sage-soft bg-brand-sage-soft/30 p-3 font-medium text-brand-sage-dark text-sm leading-6">
          <CheckCircle aria-hidden="true" className="mt-1 shrink-0" size={16} weight="fill" />
          ホーム画面から開いています。レシピのページで、共有 → 「KitchenCat」を選ぶと取り込めます。
        </p>
      ) : (
        <section aria-labelledby={headingId} className="grid gap-4">
          <SectionHeader id={headingId} title="このAndroidで設定する" />
          <ol className="grid list-decimal gap-3 pl-5 text-sm leading-6 marker:font-bold marker:text-brand-walnut">
            <li className={guideTextClass}>
              ブラウザのメニュー（︙）から「ホーム画面に追加」または「アプリをインストール」を選びます。
            </li>
            <li className={guideTextClass}>
              レシピのページやInstagramの投稿を開いて、共有 →
              「KitchenCat」を選ぶと、取り込みの画面が開きます。
            </li>
          </ol>
        </section>
      )}

      <ShortcutKeys />
    </div>
  );
};
