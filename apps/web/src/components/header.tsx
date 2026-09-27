import {
  Article,
  CookingPot,
  GearSix,
  Link as LinkIcon,
  List as ListIcon,
  PencilSimple,
  Plus,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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

const addRecipeOptions = [
  { to: "/import/url", icon: LinkIcon, label: "URLから", description: "サイトから取り込む" },
  {
    to: "/import/text",
    icon: Article,
    label: "テキストから",
    description: "文章を貼り付けて取り込む",
  },
  { to: "/recipes/new", icon: PencilSimple, label: "手入力", description: "レシピを自分で入力" },
] as const;

const AddRecipeMenu = () => {
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button className="hidden sm:inline-flex" />}>
        <CookingPot data-icon="inline-start" weight="bold" />
        レシピ追加
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56">
        <DropdownMenuGroup>
          {addRecipeOptions.map(({ description, icon: Icon, label, to }) => (
            <DropdownMenuItem
              key={to}
              onClick={() => {
                void navigate({ to });
              }}
            >
              <div className="flex items-center gap-3">
                <Icon weight="bold" />
                <div className="flex flex-col">
                  <span>{label}</span>
                  <span className="text-xs text-muted-foreground">{description}</span>
                </div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const AppNav = () => (
  <nav aria-label="Main navigation" className="flex items-center gap-x-1">
    <AddRecipeMenu />
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
      aria-label="設定"
      className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "no-underline")}
      to="/settings"
    >
      <GearSix data-icon="inline-start" weight="bold" />
      <span className="hidden sm:inline">設定</span>
    </Link>
  </nav>
);

// モバイルでは親指の届く下からシートで出し、追加の方法を全幅の行で選ばせる。
// 行を選ぶと一覧から離れ、FABごとシートが外れる。
export const MobileAddRecipeFab = () => (
  <Sheet>
    <SheetTrigger
      aria-label="レシピ追加"
      data-testid="add-recipe-fab"
      render={
        <Button className="fixed right-4 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 size-14 rounded-full shadow-lg sm:hidden" />
      }
    >
      <Plus weight="bold" />
    </SheetTrigger>
    <SheetContent
      className="gap-0 rounded-t-[20px] border-brand-line-soft bg-brand-paper"
      showCloseButton={false}
      side="bottom"
    >
      <div className="mx-auto flex w-full max-w-lg flex-col pb-[env(safe-area-inset-bottom)]">
        <SheetHeader className="flex-row items-center justify-between gap-3 border-brand-line-soft border-b px-4 py-3">
          <SheetTitle className="font-semibold text-brand-ink">レシピを追加</SheetTitle>
          <SheetClose render={<Button size="sm" variant="ghost" />}>閉じる</SheetClose>
        </SheetHeader>
        <ul className="px-2 py-2">
          {addRecipeOptions.map(({ description, icon: Icon, label, to }) => (
            <li key={to}>
              <Link
                className="flex min-h-14 items-center gap-3 rounded-[12px] px-2 py-2 text-brand-ink no-underline outline-none transition-colors hover:bg-brand-paper-muted focus-visible:bg-brand-paper-muted"
                to={to}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-brand-line-soft bg-brand-paper-raised text-brand-walnut [&_svg]:size-5">
                  <Icon weight="bold" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-sm">{label}</span>
                  <span className="text-brand-muted text-xs">{description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </SheetContent>
  </Sheet>
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
