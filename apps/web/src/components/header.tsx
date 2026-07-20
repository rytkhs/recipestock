import { Button, Description, Dropdown, Label } from "@heroui/react";
import {
  CookingPot,
  Link as LinkIcon,
  List as ListIcon,
  PencilSimple,
  UserCircle,
} from "@phosphor-icons/react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode } from "react";

const PublicNav = () => (
  <nav aria-label="Main navigation" className="flex items-center gap-2">
    <Link className="no-underline" to="/login">
      <Button
        className="rounded-full bg-brand-paper-raised border border-brand-line text-brand-walnut font-semibold text-sm hover:bg-brand-paper-muted"
        size="sm"
        variant="secondary"
      >
        サインアップ / ログイン
      </Button>
    </Link>
  </nav>
);

const AddRecipeMenu = ({
  "aria-label": ariaLabel,
  children,
  className,
}: {
  "aria-label"?: string;
  children: ReactNode;
  className: string;
}) => {
  const navigate = useNavigate();

  return (
    <Dropdown>
      <Dropdown.Trigger aria-label={ariaLabel} className={className}>
        {children}
      </Dropdown.Trigger>
      <Dropdown.Popover className="min-w-56 rounded-[20px] border border-brand-line-soft bg-brand-paper shadow-pantry">
        <Dropdown.Menu
          onAction={(key) => {
            if (key === "manual") {
              void navigate({ to: "/recipes/new" });
              return;
            }

            if (key === "url") {
              void navigate({ to: "/import/url" });
            }
          }}
        >
          <Dropdown.Item id="url" textValue="URLから">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-orange-soft text-brand-orange">
                <LinkIcon size={16} weight="bold" />
              </div>
              <div className="flex flex-col">
                <Label className="text-brand-ink font-semibold text-sm">URLから</Label>
                <Description className="text-brand-muted text-xs">サイトから取り込む</Description>
              </div>
            </div>
          </Dropdown.Item>
          <Dropdown.Item id="manual" textValue="手入力">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-sage-soft text-brand-sage">
                <PencilSimple size={16} weight="bold" />
              </div>
              <div className="flex flex-col">
                <Label className="text-brand-ink font-semibold text-sm">手入力</Label>
                <Description className="text-brand-muted text-xs">レシピを自分で入力</Description>
              </div>
            </div>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
};

const AppNav = () => (
  <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-x-1 gap-y-2">
    <AddRecipeMenu className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-brand-sage px-3 font-semibold text-sm text-white hover:bg-brand-sage-dark">
      <CookingPot size={16} weight="bold" />
      レシピ追加
    </AddRecipeMenu>
    <Link
      activeProps={{ className: "text-brand-sage font-semibold" }}
      className="no-underline text-brand-walnut text-sm"
      to="/recipes"
    >
      <Button className="rounded-full text-sm gap-1.5" size="sm" variant="ghost">
        <ListIcon size={16} weight="bold" />
        レシピ一覧
      </Button>
    </Link>
    <Link
      activeProps={{ className: "text-brand-sage font-semibold" }}
      className="no-underline text-brand-walnut text-sm"
      to="/settings"
    >
      <Button className="rounded-full text-sm gap-1.5" size="sm" variant="ghost">
        <UserCircle size={16} weight="bold" />
        アカウント
      </Button>
    </Link>
  </nav>
);

const MobileBottomNavLink = ({
  isActive,
  icon,
  label,
  to,
}: {
  isActive: boolean;
  icon: ReactNode;
  label: string;
  to: "/recipes" | "/settings";
}) => (
  <Link
    aria-current={isActive ? "page" : undefined}
    className={`group relative flex h-12 w-22 flex-col items-center justify-center gap-0.5 rounded-full no-underline transition-all duration-200 ${
      isActive ? "text-brand-sage-dark" : "text-brand-muted hover:text-brand-walnut"
    }`}
    to={to}
  >
    <div
      className={`relative z-10 transition-transform duration-300 ${isActive ? "[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] scale-110 -translate-y-1" : "ease-out scale-100 group-hover:scale-110"}`}
    >
      {icon}
    </div>
    <span
      className={`relative z-10 text-[10px] font-bold tracking-wide transition-opacity duration-200 ${isActive ? "opacity-100" : "opacity-90 group-hover:opacity-100"}`}
    >
      {label}
    </span>
  </Link>
);

export const MobileBottomNav = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-50 w-max -translate-x-1/2 rounded-full border border-white/60 bg-brand-paper/85 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_16px_32px_-8px_rgba(0,0,0,0.15)] backdrop-blur-xl sm:hidden"
    >
      <div className="flex items-center gap-2 px-1">
        <MobileBottomNavLink
          icon={<ListIcon size={24} weight={pathname.startsWith("/recipes") ? "fill" : "bold"} />}
          isActive={pathname.startsWith("/recipes")}
          label="レシピ"
          to="/recipes"
        />
        <AddRecipeMenu
          aria-label="レシピ追加"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-sage text-white shadow-lg shadow-brand-sage/40 transition-all duration-200 hover:scale-105 hover:bg-brand-sage-dark"
        >
          <CookingPot size={24} weight="fill" />
        </AddRecipeMenu>
        <MobileBottomNavLink
          icon={
            <UserCircle size={24} weight={pathname.startsWith("/settings") ? "fill" : "bold"} />
          }
          isActive={pathname.startsWith("/settings")}
          label="設定"
          to="/settings"
        />
      </div>
    </nav>
  );
};

export const Header = ({ variant }: { variant: "brand" | "public" | "private" }) => {
  return (
    <header
      className={`sticky top-0 z-40 flex-col gap-4 border-b border-brand-line bg-brand-cream/95 backdrop-blur-md px-4 py-3 sm:px-6 lg:px-10 sm:flex-row sm:items-center sm:justify-between ${
        variant === "private" ? "hidden sm:flex" : "flex"
      }`}
    >
      <Link className="font-bold text-lg text-brand-walnut no-underline tracking-tight" to="/">
        Recipe Stock
      </Link>
      {variant === "private" ? <AppNav /> : null}
      {variant === "public" ? <PublicNav /> : null}
    </header>
  );
};
