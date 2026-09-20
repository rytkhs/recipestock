import { CaretLeft } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ScreenTopBar, ScreenTopBarIconButton } from "../../components/screen-top-bar";

// 設定のページはどれもタグの管理と同じ幅にする。広い画面でも1列のまま読む。
export const settingsPageClass = "mx-auto w-full max-w-3xl px-0 pb-10 sm:px-6 lg:px-10";

export const settingsPageBodyClass = "mt-4 px-4 sm:mt-6 sm:px-0";

// 目次から開くページの上部バー。戻る先は来た経路によらず目次にする。
export const SettingsSubpageTopBar = ({ title }: { title: string }) => {
  const navigate = useNavigate();

  return (
    <ScreenTopBar
      leading={
        <ScreenTopBarIconButton
          aria-label="設定へ戻る"
          onPress={() => {
            void navigate({ to: "/settings" });
          }}
        >
          <CaretLeft size={21} weight="bold" />
        </ScreenTopBarIconButton>
      }
      title={title}
    />
  );
};

// フォームの結果を伝える1枚。成功は読み上げの邪魔をせず、失敗はその場で知らせる。
export const SettingsFormMessage = ({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "error" | "success";
}) =>
  tone === "success" ? (
    <div className="rounded-[14px] border border-brand-sage-soft bg-brand-sage-soft/30 p-3">
      <p className="font-medium text-brand-sage-dark text-sm leading-6" role="status">
        {children}
      </p>
    </div>
  ) : (
    <div className="rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
      <p className="text-brand-danger text-sm leading-6" role="alert">
        {children}
      </p>
    </div>
  );

const noticeToneClass = {
  info: "border-brand-line-soft bg-brand-paper-muted",
  success: "border-brand-sage-soft bg-brand-sage-soft/30",
  warning: "border-brand-orange-soft bg-brand-orange-soft/25",
} as const;

// ページの冒頭に、そのとき伝えることを1つだけ出す。戻ってきた理由や、手続きの結果に使う。
export const SettingsNotice = ({
  action,
  children,
  icon,
  title,
  tone,
}: {
  action?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  title: string;
  tone: keyof typeof noticeToneClass;
}) => (
  <div className={cn("rounded-[14px] border p-4", noticeToneClass[tone])} role="status">
    <div className="flex min-w-0 items-center gap-2">
      {icon}
      <p className="min-w-0 font-semibold text-brand-ink text-sm">{title}</p>
    </div>
    {children ? <p className="mt-1 text-brand-walnut text-sm leading-6">{children}</p> : null}
    {action ? <div className="mt-3">{action}</div> : null}
  </div>
);
