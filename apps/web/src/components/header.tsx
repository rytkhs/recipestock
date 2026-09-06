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
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PublicNav = () => (
  <nav aria-label="Main navigation" className="flex items-center gap-2">
    <Link
      className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "no-underline")}
      to="/login"
    >
      サインアップ / ログイン
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
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={ariaLabel}
        data-testid={testId}
        render={<Button className={className} />}
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              void navigate({ to: "/import/url" });
            }}
          >
            <div className="flex items-center gap-3">
              <LinkIcon weight="bold" />
              <div className="flex flex-col">
                <span>URLから</span>
                <span className="text-xs text-muted-foreground">サイトから取り込む</span>
              </div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void navigate({ to: "/recipes/new" });
            }}
          >
            <div className="flex items-center gap-3">
              <PencilSimple weight="bold" />
              <div className="flex flex-col">
                <span>手入力</span>
                <span className="text-xs text-muted-foreground">レシピを自分で入力</span>
              </div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const AppNav = () => (
  <nav aria-label="Main navigation" className="flex items-center gap-x-1">
    <AddRecipeMenu className="hidden sm:inline-flex">
      <CookingPot data-icon="inline-start" weight="bold" />
      レシピ追加
    </AddRecipeMenu>
    <Link
      activeProps={{ className: "text-primary" }}
      className={cn(
        buttonVariants({ size: "sm", variant: "ghost" }),
        "hidden no-underline sm:inline-flex",
      )}
      to="/recipes"
    >
      <ListIcon data-icon="inline-start" weight="bold" />
      レシピ一覧
    </Link>
    <Link
      activeProps={{ className: "text-primary" }}
      aria-label="アカウント"
      className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "no-underline")}
      to="/settings"
    >
      <UserCircle data-icon="inline-start" weight="bold" />
      <span className="hidden sm:inline">アカウント</span>
    </Link>
  </nav>
);

export const MobileAddRecipeFab = () => (
  <AddRecipeMenu
    aria-label="レシピ追加"
    data-testid="add-recipe-fab"
    className="fixed right-4 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 size-14 rounded-full shadow-lg sm:hidden"
  >
    <Plus weight="bold" />
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
