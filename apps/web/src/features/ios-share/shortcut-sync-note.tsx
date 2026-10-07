import { useId } from "react";
import { SectionHeader } from "../../components/section-header";
import { guideTextClass } from "./share-guide";

/**
 * ショートカットは、貼ったキーごとiCloudで同じApple IDの端末へ同期される（実機での確認は
 * docs/shortcut/ios-share.md）。連携済みの人を、ほかの端末で同じショートカットの追加へ誘わない。
 */
export const ShortcutSyncNote = () => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <SectionHeader id={headingId} title="ほかの端末でも使うには" />
      <p className={guideTextClass}>
        ショートカットは、同じApple
        IDのiPhone・iPad・MacにiCloudで同期されます。同期を切っていなければ、共有メニューにもう「KitchenCat」が出ています。
      </p>
      <p className={guideTextClass}>
        出てこないiPhoneやiPadでは、その端末でこのページを開いて、ショートカットを追加してください。
      </p>
    </section>
  );
};
