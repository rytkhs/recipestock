import { ArrowDown, ArrowUp, DotsThreeVertical, Trash } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const menuItemClass = "py-2";

// 並べ替えと削除は行の「…」にまとめ、入力している行の横に操作を並べない。
export const DraftRowMenu = ({
  disabled = false,
  isFirst = false,
  isLast = false,
  label,
  removeLabel = "削除",
  onMoveDown,
  onMoveUp,
  onRemove,
}: {
  disabled?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  label: string;
  removeLabel?: string;
  onMoveDown?: () => void;
  onMoveUp?: () => void;
  onRemove: () => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      aria-label={label}
      className="grid size-10 shrink-0 place-items-center rounded-full text-brand-muted outline-none transition-colors hover:bg-brand-paper-muted hover:text-brand-walnut focus-visible:outline-2 focus-visible:outline-brand-orange aria-expanded:bg-brand-paper-muted aria-expanded:text-brand-walnut"
      render={<button type="button" />}
    >
      <DotsThreeVertical size={18} weight="bold" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-40">
      {onMoveUp || onMoveDown ? (
        <>
          <DropdownMenuGroup>
            {onMoveUp ? (
              <DropdownMenuItem
                className={menuItemClass}
                disabled={disabled || isFirst}
                onClick={onMoveUp}
              >
                <ArrowUp weight="bold" />
                <span>上に移動</span>
              </DropdownMenuItem>
            ) : null}
            {onMoveDown ? (
              <DropdownMenuItem
                className={menuItemClass}
                disabled={disabled || isLast}
                onClick={onMoveDown}
              >
                <ArrowDown weight="bold" />
                <span>下に移動</span>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      ) : null}
      <DropdownMenuGroup>
        <DropdownMenuItem
          className={menuItemClass}
          disabled={disabled}
          variant="destructive"
          onClick={onRemove}
        >
          <Trash weight="bold" />
          <span>{removeLabel}</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);
