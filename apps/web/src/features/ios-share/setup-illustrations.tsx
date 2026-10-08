import {
  BookOpen,
  CaretDown,
  CaretRight,
  Copy,
  Eyeglasses,
  ForkKnife,
  MagnifyingGlass,
  PlusSquare,
} from "@phosphor-icons/react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 設定の途中でアプリの外に出る画面を、先に見せておくための図。iOSの画面そのものではなく、
 * 何をどの順に押すかが分かる程度に写す。押すものには番号を付け、本文は何をするかだけにする。
 * 同じことは本文にも書くので、図は読み上げに出さない。文言はiOSの版で変わりうるので、実機で見たものに合わせて保つ。
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
  "rounded-[14px] bg-[#f2f2f7] text-[#1c1c1e] shadow-[0_4px_12px_rgba(0,0,0,0.08)] [font-family:-apple-system,'Hiragino_Sans','Noto_Sans_JP',sans-serif]";

const tapRingClass = "shadow-[0_0_0_2px_var(--brand-orange)]";

const systemButtonClass = "rounded-[8px] bg-[#0060c8] py-1.5 text-center font-bold text-white";

/** 押す順の番号。押すものの右上に重ねる。 */
const TapNumber = ({ className, number }: { className?: string; number: number }) => (
  <span
    className={cn(
      "grid size-4 shrink-0 place-items-center rounded-full bg-brand-orange font-bold text-[10px] text-white leading-none",
      className,
    )}
  >
    {number}
  </span>
);

const TapTarget = ({
  children,
  className,
  number,
}: {
  children: ReactNode;
  className?: string;
  number: number;
}) => (
  <div className={cn("relative", tapRingClass, className)}>
    {children}
    <TapNumber className="-top-2 -right-2 absolute" number={number} />
  </div>
);

/** 配っているショートカットのアイコン。ショートカットAppでは、この色の地に白い記号で出る。 */
const ShortcutIcon = () => (
  <span className="grid size-9 place-items-center rounded-[9px] bg-gradient-to-b from-[#ff9a7e] to-[#f7785b] text-white">
    <ForkKnife size={20} weight="fill" />
  </span>
);

const shortcutName = "KitchenCatで取り込む";

/**
 * ショートカットAppの2枚。1枚目で「ショートカットを設定」を押すと、2枚目でキーを聞かれる。
 * 1枚目は実機で撮れていないので、配布ページのアイコンと名前から描いている。
 */
export const ShortcutQuestionIllustration = () => (
  <IllustrationFrame label="ショートカットApp">
    <div className="flex w-full max-w-[300px] items-stretch gap-1.5">
      <div
        className={cn(
          systemPanelClass,
          "flex min-w-0 flex-1 flex-col items-center gap-2 px-2 pt-3.5 pb-2.5",
        )}
      >
        <ShortcutIcon />
        <p className="text-center font-bold text-[10px] leading-snug">{shortcutName}</p>
        <TapTarget className="mt-auto w-full rounded-[8px]" number={1}>
          <p className={cn(systemButtonClass, "text-[10px]")}>ショートカットを設定</p>
        </TapTarget>
      </div>
      <CaretRight className="shrink-0 self-center text-brand-muted" size={12} weight="bold" />
      <div className={cn(systemPanelClass, "flex min-w-0 flex-1 flex-col gap-1.5 px-2 py-2.5")}>
        <p className="text-center font-bold text-[9px] leading-snug">このショートカットを構成</p>
        <p className="text-[9px] leading-snug">
          KitchenCatでコピーした連携キーを貼り付けてください
        </p>
        <TapTarget className="mt-4 h-6 rounded-[6px] bg-white" number={2}>
          <span className="-top-4 absolute left-1.5 rounded-[5px] bg-[#1c1c1e] px-1.5 py-0.5 text-[9px] text-white">
            ペースト
          </span>
        </TapTarget>
        <TapTarget className="mt-auto rounded-[8px]" number={3}>
          <p className={cn(systemButtonClass, "text-[10px]")}>ショートカットを追加</p>
        </TapTarget>
      </div>
    </div>
  </IllustrationFrame>
);

const shareSheetActions = [
  { label: "コピー", icon: <Copy size={16} /> },
  { label: "リーディングリスト", icon: <Eyeglasses size={16} /> },
  { label: "ブックマーク", icon: <BookOpen size={16} /> },
];

const ShareSheetAction = ({ icon, label }: { icon: ReactNode; label: string }) => (
  <span className="flex flex-col items-center gap-1 text-center text-[#3c3c43] text-[9px] leading-tight">
    <span className="grid size-[34px] place-items-center rounded-full bg-[#e5e5ea] text-[#1c1c1e]">
      {icon}
    </span>
    {label}
  </span>
);

const ShareSheetRow = ({
  children,
  icon,
  isTarget = false,
}: {
  children: ReactNode;
  icon: ReactNode;
  isTarget?: boolean;
}) => (
  <p
    className={cn(
      "flex items-center gap-2 border-[#e5e5ea] border-t px-3 py-2 text-xs first:border-t-0",
      isTarget && "bg-[#fff1e2] font-bold shadow-[inset_0_0_0_2px_var(--brand-orange)]",
    )}
  >
    {icon}
    <span className="min-w-0 flex-1">{children}</span>
    {isTarget ? <TapNumber number={2} /> : null}
  </p>
);

/**
 * 共有メニューは畳んだ状態で開き、ショートカットは「表示を増やす」で出るリストのいちばん下にある。
 * Safari、Instagram、YouTubeのどこから開いても同じ。
 */
export const ShareSheetIllustration = () => (
  <IllustrationFrame label="共有メニュー">
    <div className={cn(systemPanelClass, "flex w-full max-w-[280px] flex-col gap-2 p-2.5")}>
      <div className="grid grid-cols-4 gap-1.5 px-0.5 pt-1">
        {shareSheetActions.map((action) => (
          <ShareSheetAction icon={action.icon} key={action.label} label={action.label} />
        ))}
        <span className="flex flex-col items-center gap-1 text-center font-bold text-[#3c3c43] text-[9px] leading-tight">
          <span
            className={cn(
              "relative grid size-[34px] place-items-center rounded-full bg-[#e5e5ea] text-[#1c1c1e]",
              tapRingClass,
            )}
          >
            <CaretDown size={16} weight="bold" />
            <TapNumber className="-top-1.5 -right-1.5 absolute" number={1} />
          </span>
          表示を増やす
        </span>
      </div>
      <p className="text-center text-[#8e8e93] text-xs leading-none">⋮</p>
      <div className="overflow-hidden rounded-[10px] bg-white">
        <ShareSheetRow icon={<MagnifyingGlass size={14} />}>ページを検索</ShareSheetRow>
        <ShareSheetRow icon={<PlusSquare size={14} />}>ホーム画面に追加</ShareSheetRow>
        <ShareSheetRow icon={<ForkKnife size={14} weight="fill" />} isTarget>
          {shortcutName}
        </ShareSheetRow>
      </div>
      <p className="self-center rounded-full bg-[#e5e5ea] px-3 py-1 text-[10px]">
        アクションを編集
      </p>
    </div>
  </IllustrationFrame>
);

/**
 * ショートカットが初めてこのサイトへ送るときの確認。選択肢は「許可しない｜許可」の2つのときと、
 * 「許可しない／1度だけ許可／常に許可」の3つのときがあり、出し分けは分かっていない。図は2つのほうで描き、本文で両方に触れる。
 */
export const SendPermissionIllustration = ({ host }: { host: string }) => (
  <IllustrationFrame label="送信の確認">
    <div className={cn(systemPanelClass, "grid w-full max-w-[260px] gap-3 p-3.5 text-center")}>
      <p className="font-bold text-xs leading-relaxed">
        “{shortcutName}”が1個のSafariの項目を“{host}”へ送信することを許可しますか?
      </p>
      <div className="grid grid-cols-2 gap-2">
        <p className="rounded-full bg-[#e5e5ea] py-2 text-[13px]">許可しない</p>
        <TapTarget className="rounded-full" number={3}>
          <p className="rounded-full bg-[#0a84ff] py-2 font-bold text-[13px] text-white">許可</p>
        </TapTarget>
      </div>
    </div>
  </IllustrationFrame>
);
