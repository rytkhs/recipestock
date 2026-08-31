import { Button, Description, Dropdown, Label } from "@heroui/react";
import {
  CookingPot,
  Link as LinkIcon,
  List as ListIcon,
  PencilSimple,
  Plus,
  UserCircle,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
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
  "data-testid": testId,
}: {
  "aria-label"?: string;
  children: ReactNode;
  className: string;
  "data-testid"?: string;
}) => {
  const navigate = useNavigate();

  return (
    <Dropdown>
      <Dropdown.Trigger aria-label={ariaLabel} className={className} data-testid={testId}>
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
  <nav aria-label="Main navigation" className="flex items-center gap-x-1">
    <AddRecipeMenu className="hidden h-8 items-center justify-center gap-1.5 rounded-full bg-brand-sage px-3 font-semibold text-sm text-white hover:bg-brand-sage-dark sm:inline-flex">
      <CookingPot size={16} weight="bold" />
      レシピ追加
    </AddRecipeMenu>
    <Link
      activeProps={{ className: "text-brand-sage font-semibold" }}
      className="hidden no-underline text-brand-walnut text-sm sm:block"
      to="/recipes"
    >
      <Button className="rounded-full text-sm gap-1.5" size="sm" variant="ghost">
        <ListIcon size={16} weight="bold" />
        レシピ一覧
      </Button>
    </Link>
    <Link
      activeProps={{ className: "text-brand-sage font-semibold" }}
      aria-label="アカウント"
      className="no-underline text-brand-walnut text-sm"
      to="/settings"
    >
      <Button
        className="h-10 w-10 rounded-full text-sm gap-1.5 sm:h-8 sm:w-auto"
        size="sm"
        variant="ghost"
      >
        <UserCircle className="size-6 sm:size-4" weight="bold" />
        <span className="hidden sm:inline">アカウント</span>
      </Button>
    </Link>
  </nav>
);

export const MobileAddRecipeFab = () => (
  <AddRecipeMenu
    aria-label="レシピ追加"
    data-testid="add-recipe-fab"
    className="fixed right-4 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-sage text-white shadow-lg shadow-brand-sage/40 transition-all duration-200 hover:scale-105 hover:bg-brand-sage-dark sm:hidden"
  >
    <Plus size={26} weight="bold" />
  </AddRecipeMenu>
);

export const Header = ({
  isMobileVisible = true,
  variant,
}: {
  isMobileVisible?: boolean;
  variant: "brand" | "public" | "private";
}) => {
  const isAppChrome = variant === "private" || variant === "brand";

  return (
    <header
      className={`sticky top-0 z-40 border-b border-brand-line bg-brand-cream/95 backdrop-blur-md px-4 sm:px-6 lg:px-10 ${
        isAppChrome
          ? "h-14 items-center justify-between gap-4 sm:h-16"
          : "flex-col gap-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      } ${isMobileVisible ? "flex" : "hidden sm:flex"}`}
    >
      <Link className="font-bold text-lg text-brand-walnut no-underline tracking-tight" to="/">
        Recipe Stock
      </Link>
      {variant === "private" ? <AppNav /> : null}
      {variant === "public" ? <PublicNav /> : null}
    </header>
  );
};
