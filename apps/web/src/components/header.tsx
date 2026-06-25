import { Button, Description, Dropdown, Label } from "@heroui/react";
import {
  CookingPot,
  Link as LinkIcon,
  List as ListIcon,
  PencilSimple,
  UserCircle,
} from "@phosphor-icons/react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAuthSession } from "../lib/auth";

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

const AddRecipeMenu = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();

  return (
    <Dropdown>
      {children}
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
    <AddRecipeMenu>
      <Button
        className="rounded-full bg-brand-sage text-white font-semibold text-sm gap-1.5 hover:bg-brand-sage-dark"
        size="sm"
        variant="primary"
      >
        <CookingPot size={16} weight="bold" />
        レシピ追加
      </Button>
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
    className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-[14px] no-underline text-[11px] font-semibold transition-colors ${
      isActive ? "bg-brand-sage-soft/70 text-brand-sage-dark" : "text-brand-muted"
    }`}
    to={to}
  >
    {icon}
    {label}
  </Link>
);

export const MobileBottomNav = () => {
  const session = useAuthSession();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (!session.data) {
    return null;
  }

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-50 border-brand-line border-t bg-brand-paper/95 px-3 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-pantry-lg backdrop-blur-md sm:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-[1fr_auto_1fr] items-end gap-3">
        <MobileBottomNavLink
          icon={<ListIcon size={22} weight="bold" />}
          isActive={pathname.startsWith("/recipes")}
          label="レシピ"
          to="/recipes"
        />
        <AddRecipeMenu>
          <Button
            className="h-16 min-w-16 rounded-full bg-brand-sage px-4 text-white shadow-pantry-lg hover:bg-brand-sage-dark"
            variant="primary"
          >
            <span className="flex flex-col items-center gap-0.5 text-[11px] font-bold">
              <CookingPot size={24} weight="bold" />
              追加
            </span>
          </Button>
        </AddRecipeMenu>
        <MobileBottomNavLink
          icon={<UserCircle size={22} weight="bold" />}
          isActive={pathname.startsWith("/settings")}
          label="設定"
          to="/settings"
        />
      </div>
    </nav>
  );
};

export const Header = () => {
  const session = useAuthSession();

  return (
    <header
      className={`sticky top-0 z-40 flex-col gap-4 border-b border-brand-line bg-brand-cream/95 backdrop-blur-md px-4 py-3 sm:px-6 lg:px-10 sm:flex-row sm:items-center sm:justify-between ${
        session.data ? "hidden sm:flex" : "flex"
      }`}
    >
      <Link className="font-bold text-lg text-brand-walnut no-underline tracking-tight" to="/">
        Recipe Stock
      </Link>
      {session.data ? <AppNav /> : <PublicNav />}
    </header>
  );
};
