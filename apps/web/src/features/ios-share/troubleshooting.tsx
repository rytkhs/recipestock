import { CaretDown } from "@phosphor-icons/react";
import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "../../components/section-header";
import { type IosDeviceName } from "../../pwa/platform";

const TroubleshootingItem = ({ children, title }: { children: ReactNode; title: string }) => (
  <details className="group border-brand-line-soft border-t first:border-t-0">
    <summary className="flex min-h-13 cursor-pointer list-none items-center gap-3 px-4 py-3 font-medium text-base text-brand-ink outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange [&::-webkit-details-marker]:hidden">
      <span className="min-w-0 flex-1">{title}</span>
      <CaretDown
        aria-hidden="true"
        className="shrink-0 text-brand-muted transition-transform group-open:rotate-180"
        size={16}
        weight="bold"
      />
    </summary>
    <div className="grid gap-2 px-4 pb-4 text-brand-muted text-sm leading-6">{children}</div>
  </details>
);

/**
 * つまずくのはアプリの外なので、画面からは起きたことが見えない。起きやすい順に、利用者が気づく言葉で並べる。
 * やり直すしかないものには、この画面で最初からやり直す入口を添える。
 */
export const ShortcutTroubleshooting = ({
  deviceName,
  onRestart,
}: {
  deviceName: IosDeviceName;
  onRestart: () => void;
}) => {
  const headingId = useId();
  const restartButton = (
    <Button className="justify-self-start" variant="secondary" onClick={onRestart}>
      最初からやり直す
    </Button>
  );

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="うまくいかないとき" />
      <div className="mt-4 overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm">
        <TroubleshootingItem title="共有メニューに「KitchenCat」が出ない">
          <p>
            共有メニューをいちばん下までスクロールしてください。InstagramやYouTube、Xでは、アプリの共有画面で「その他」を押すと、
            {deviceName}の共有メニューが開きます。
          </p>
          <p>
            よく使うなら、共有メニューの「アクションを編集」から「よく使う項目」に入れておくと上に出ます。
          </p>
        </TroubleshootingItem>
        <TroubleshootingItem title="接続の確認で「許可しない」を選んだ">
          <p>
            ショートカットAppで「KitchenCat」を削除してから、キーのコピーからやり直してください。追加し直したショートカットでは、もう一度聞かれます。
          </p>
          {restartButton}
        </TroubleshootingItem>
        <TroubleshootingItem title="キーを貼り忘れた・違うものを貼った">
          <p>
            ショートカットAppで「KitchenCat」を削除してから、キーのコピーからやり直してください。
          </p>
          {restartButton}
        </TroubleshootingItem>
        <TroubleshootingItem title="「取り込みを開始しました」が出ない">
          <p>
            共有しても何も出ないときは、{deviceName}
            の「設定」→「通知」→「ショートカット」で通知を許可してください。
          </p>
          <p>取り込みが始まっていれば、KitchenCatを開くと取り込み中と出ます。</p>
        </TroubleshootingItem>
      </div>
    </section>
  );
};
