import { cn } from "@/lib/utils";

// 詳細のタグと一覧のチップで同じ形を使う。選んでいるものは地を濃くして区別する。
export const tagChipClass = (isSelected = false) =>
  cn(
    "inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 font-medium text-[13px] no-underline outline-none transition-colors focus-visible:outline-2 focus-visible:outline-brand-orange focus-visible:outline-offset-2 disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
    isSelected
      ? "border-brand-walnut bg-brand-walnut text-brand-paper"
      : "border-brand-line bg-brand-paper text-brand-ink hover:bg-brand-paper-muted",
  );
