import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

const toneClass = {
  info: "border-brand-line-soft bg-brand-paper-muted",
  success: "border-brand-sage-soft bg-brand-sage-soft/30",
  warning: "border-brand-orange-soft bg-brand-orange-soft/25",
} as const;

// プランのページの冒頭に、そのとき伝えることを1つだけ出す。
export const BillingNotice = ({
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
  tone: keyof typeof toneClass;
}) => (
  <div className={cn("rounded-[14px] border p-4", toneClass[tone])} role="status">
    <div className="flex min-w-0 items-center gap-2">
      {icon}
      <p className="min-w-0 font-semibold text-brand-ink text-sm">{title}</p>
    </div>
    {children ? <p className="mt-1 text-brand-walnut text-sm leading-6">{children}</p> : null}
    {action ? <div className="mt-3">{action}</div> : null}
  </div>
);
