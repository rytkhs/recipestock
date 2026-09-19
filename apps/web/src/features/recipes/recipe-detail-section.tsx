import { ArrowUpRight } from "@phosphor-icons/react";
import { useId } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SectionHeader } from "../../components/section-header";

export const RecipeNote = ({ note }: { note: string }) => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="メモ" />
      <p className="mt-3 whitespace-pre-wrap break-words text-base text-brand-ink leading-7">
        {note}
      </p>
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
      <SectionHeader id={headingId} title="出典" />
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
