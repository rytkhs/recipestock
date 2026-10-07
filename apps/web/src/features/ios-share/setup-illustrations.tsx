import { Copy, Eyeglasses, Stack } from "@phosphor-icons/react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 設定の途中でアプリの外に出る画面を、先に見せておくための図。iOSの画面そのものではなく、
 * 何を押すかが分かる程度に写す。同じことは本文にも書くので、図は読み上げに出さない。
 * 文言はiOSの版で変わりうるので、実機で見たものに合わせて保つ。
 */
const IllustrationFrame = ({ children, label }: { children: ReactNode; label: string }) => (
  <div
    aria-hidden="true"
    className="relative flex flex-col items-center gap-2.5 rounded-[16px] bg-[#efe8dd] px-3.5 pt-8 pb-4"
  >
    <span className="absolute top-2.5 left-3 font-bold text-[11px] text-brand-muted">{label}</span>
    {children}
  </div>
);

const systemPanelClass =
  "w-full max-w-[280px] rounded-[14px] bg-[#f2f2f7] text-[#1c1c1e] shadow-[0_4px_12px_rgba(0,0,0,0.08)] [font-family:-apple-system,'Hiragino_Sans','Noto_Sans_JP',sans-serif]";

const highlightClass = "bg-[#fff1e2] font-bold shadow-[inset_0_0_0_2px_var(--brand-orange)]";

export const ShortcutQuestionIllustration = () => (
  <IllustrationFrame label="ショートカットApp">
    <div className={cn(systemPanelClass, "flex flex-col gap-2.5 p-3.5")}>
      <p className="text-center font-bold text-[13px]">ショートカットを設定</p>
      <p className="text-xs leading-relaxed">
        KitchenCatでコピーした連携キーを貼り付けてください
      </p>
      <div className="relative mt-6 h-[34px] rounded-[8px] bg-white shadow-[inset_0_0_0_2px_var(--brand-orange)]">
        <span className="-top-7 absolute left-2.5 rounded-[7px] bg-[#1c1c1e] px-2.5 py-1 text-[11px] text-white">
          ペースト
        </span>
      </div>
      <p className="rounded-[10px] bg-[#0060c8] py-2 text-center font-bold text-[13px] text-white">
        ショートカットを追加
      </p>
    </div>
  </IllustrationFrame>
);

const shareSheetApps = ["メッセージ", "メール", "メモ", "その他"];

const ShareSheetRow = ({
  children,
  icon,
  isHighlighted = false,
}: {
  children: ReactNode;
  icon?: ReactNode;
  isHighlighted?: boolean;
}) => (
  <p
    className={cn(
      "flex items-center justify-between gap-2 border-[#e5e5ea] border-t px-3 py-2 text-xs first:border-t-0",
      isHighlighted && highlightClass,
    )}
  >
    {children}
    {icon}
  </p>
);

export const ShareSheetIllustration = () => (
  <IllustrationFrame label="共有メニュー">
    <div className={cn(systemPanelClass, "flex flex-col gap-2 p-2.5")}>
      <div className="grid grid-cols-4 gap-1.5 px-0.5 py-1">
        {shareSheetApps.map((app) => (
          <span className="flex flex-col items-center gap-1 text-[#3c3c43] text-[9px]" key={app}>
            <span className="size-[38px] rounded-[10px] bg-[#d1d1d6]" />
            {app}
          </span>
        ))}
      </div>
      <div className="overflow-hidden rounded-[10px] bg-white">
        <ShareSheetRow icon={<Copy size={14} />}>コピー</ShareSheetRow>
        <ShareSheetRow icon={<Eyeglasses size={14} />}>リーディングリストに追加</ShareSheetRow>
        <ShareSheetRow icon={<Stack size={14} />} isHighlighted>
          KitchenCat
        </ShareSheetRow>
        <ShareSheetRow>
          <span className="text-[#0060c8]">アクションを編集...</span>
        </ShareSheetRow>
      </div>
    </div>
  </IllustrationFrame>
);

const permissionChoices = [
  { label: "1回だけ許可", isRecommended: false },
  { label: "常に許可", isRecommended: true },
  { label: "許可しない", isRecommended: false },
];

export const ConnectionPermissionIllustration = ({ host }: { host: string }) => (
  <IllustrationFrame label="初回だけ">
    <div className={cn(systemPanelClass, "max-w-[260px] overflow-hidden text-center")}>
      <p className="px-3.5 pt-3.5 pb-3 font-bold text-xs leading-relaxed">
        “KitchenCat”に“{host}”への接続を許可しますか?
      </p>
      {permissionChoices.map((choice) => (
        <p
          className={cn(
            "border-[#d1d1d6] border-t py-2.5 text-[#0060c8] text-[13px]",
            choice.isRecommended && highlightClass,
          )}
          key={choice.label}
        >
          {choice.label}
        </p>
      ))}
    </div>
  </IllustrationFrame>
);
