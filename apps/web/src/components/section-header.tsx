import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

// 段の見出し。カードで囲まず、見出しと罫線だけで区切る。レシピの詳細・編集と設定で使う。
export const SectionHeader = ({
  action,
  id,
  meta,
  title,
}: {
  action?: ReactNode;
  id: string;
  /** 見出しの横に添える補足。編集画面ではできあがり量の入力欄を置く。 */
  meta?: ReactNode;
  title: string;
}) => (
  <div className="flex items-center gap-3 border-brand-line border-b pb-2.5">
    <h2 className="shrink-0 font-bold text-brand-walnut text-lg leading-8" id={id}>
      {title}
    </h2>
    {meta ? <div className="min-w-0 flex-1 text-brand-muted text-sm">{meta}</div> : null}
    {action ? <div className={cn("shrink-0", !meta && "ml-auto")}>{action}</div> : null}
  </div>
);
