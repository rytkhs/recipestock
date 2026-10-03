import { Copy } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { guideTextClass } from "./share-guide";
import { ShortcutKeys } from "./shortcut-keys";

/**
 * PCには共有の入口がない。設定はiPhoneで行うので、このページをiPhoneで開いてもらう。
 * AppleのデバイスどうしならコピーしたURLをそのままiPhoneで貼れる。
 */
export const DesktopShareGuide = () => {
  const urlInputId = useId();
  const pageUrl = `${window.location.origin}/settings/share`;
  const [copyResult, setCopyResult] = useState<"copied" | "failed" | null>(null);

  const copyPageUrl = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopyResult("copied");
    } catch {
      setCopyResult("failed");
    }
  };

  return (
    <div className="grid gap-10">
      <section className="grid gap-3 rounded-[16px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
        <h2 className="font-bold text-brand-walnut text-lg">iPhoneで設定します</h2>
        <p className={guideTextClass}>
          共有からの取り込みは、iPhoneやiPadのショートカットで使います。iPhoneでこのページを開いて設定してください。
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <label className="sr-only" htmlFor={urlInputId}>
            このページのURL
          </label>
          <Input className="min-w-0 flex-1" id={urlInputId} readOnly value={pageUrl} />
          <Button className="shrink-0" variant="secondary" onClick={() => void copyPageUrl()}>
            <Copy data-icon="inline-start" weight="bold" />
            コピー
          </Button>
        </div>
        {copyResult === "copied" ? (
          <p className="text-brand-sage-dark text-sm" role="status">
            URLをコピーしました。
          </p>
        ) : null}
        {copyResult === "failed" ? (
          <p className="text-brand-danger text-sm" role="alert">
            コピーできませんでした。URLを選んでコピーしてください。
          </p>
        ) : null}
      </section>

      <ShortcutKeys />
    </div>
  );
};
