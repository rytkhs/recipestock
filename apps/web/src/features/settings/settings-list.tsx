import { CaretRight } from "@phosphor-icons/react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";
import { SkeletonBlock } from "../../components/loading";

// 設定の目次の行。枠はタグの一覧と同じ形にして、行ごとに罫線で区切る。
const groupListClass =
  "divide-y divide-brand-line-soft overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm";

const rowClass =
  "flex min-h-13 w-full min-w-0 items-center gap-3 px-4 py-3 text-left no-underline transition-colors hover:bg-brand-paper-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-50";

// 行が1つしかないまとまりに見出しを付けると項目名を繰り返すだけになるので、見出しは任意にする。
export const SettingsGroup = ({ children, title }: { children: ReactNode; title?: string }) => {
  const headingId = useId();

  if (!title) {
    return <ul className={groupListClass}>{children}</ul>;
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 className="mb-2 px-4 font-semibold text-brand-muted text-xs" id={headingId}>
        {title}
      </h2>
      <ul className={groupListClass}>{children}</ul>
    </section>
  );
};

/**
 * 行き先のページで扱うものの、今の状態を右に出す。多くの用事は目次を見るだけで済むようにする。
 * 読み込み中は`value`に`"loading"`を渡す。読めなかったときは何も出さない。
 */
export const SettingsLinkRow = ({
  icon,
  label,
  to,
  value,
  valueTone = "muted",
}: {
  icon: ReactNode;
  label: string;
  to: LinkProps["to"];
  value?: string | "loading";
  valueTone?: "muted" | "warning";
}) => (
  <li>
    <Link className={rowClass} to={to}>
      <span aria-hidden="true" className="shrink-0 text-brand-walnut">
        {icon}
      </span>
      <span className="shrink-0 font-medium text-base text-brand-ink">{label}</span>
      <span
        className={cn(
          "ml-auto min-w-0 truncate text-right text-sm",
          valueTone === "warning" ? "font-semibold text-brand-orange-dark" : "text-brand-muted",
        )}
      >
        {value === "loading" ? (
          <SkeletonBlock className="inline-block h-4 w-16 align-middle" />
        ) : (
          value
        )}
      </span>
      <CaretRight
        aria-hidden="true"
        className="shrink-0 text-brand-muted"
        size={16}
        weight="bold"
      />
    </Link>
  </li>
);

export const SettingsActionRow = ({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) => (
  <li>
    <button className={rowClass} disabled={disabled} type="button" onClick={onPress}>
      <span aria-hidden="true" className="shrink-0 text-brand-walnut">
        {icon}
      </span>
      <span className="font-medium text-base text-brand-ink">{label}</span>
    </button>
  </li>
);
