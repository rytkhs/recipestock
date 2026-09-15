import { ArrowUpRight } from "@phosphor-icons/react";
import { type ReactNode, useId } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 詳細の段の見出し。一覧と同じくカードで囲まず、見出しと罫線だけで区切る。
export const RecipeSectionHeader = ({
  action,
  id,
  meta,
  title,
}: {
  action?: ReactNode;
  id: string;
  meta?: string;
  title: string;
}) => (
  <div className="flex items-center gap-3 border-brand-line border-b pb-2.5">
    <h2 className="shrink-0 font-bold text-brand-walnut text-lg leading-8" id={id}>
      {title}
    </h2>
    {meta ? <p className="min-w-0 flex-1 text-brand-muted text-sm">{meta}</p> : null}
    {action ? <div className={cn("shrink-0", !meta && "ml-auto")}>{action}</div> : null}
  </div>
);

export const RecipeNote = ({ note }: { note: string }) => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <RecipeSectionHeader id={headingId} title="メモ" />
      <p className="mt-3 whitespace-pre-wrap text-base text-brand-ink leading-7">{note}</p>
    </section>
  );
};

// 出典の名前と、元のページを開く導線。本などURLのない出典は名前だけを出す。
// 料理中にアプリの画面を失わないよう、元のページは別のタブで開く。
export const RecipeSource = ({
  host,
  name,
  url,
}: {
  host: string | null;
  name: string;
  url: string | null;
}) => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <RecipeSectionHeader id={headingId} title="出典" />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium text-base text-brand-ink">{name}</p>
          {host && host !== name ? (
            <p className="truncate text-brand-muted text-sm">{host}</p>
          ) : null}
        </div>
        {url ? (
          <a
            className={cn(buttonVariants({ size: "lg", variant: "outline" }), "no-underline")}
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            元のページを開く
            <ArrowUpRight data-icon="inline-end" weight="bold" />
          </a>
        ) : null}
      </div>
    </section>
  );
};
