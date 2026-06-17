import { Button, Description, Dropdown, Label } from "@heroui/react";
import {
  CookingPot,
  Link as LinkIcon,
  List as ListIcon,
  PencilSimple,
  UserCircle,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
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

const AppNav = () => {
  const navigate = useNavigate();

  return (
    <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-x-1 gap-y-2">
      <Dropdown>
        <Button
          className="rounded-full bg-brand-sage text-white font-semibold text-sm gap-1.5 hover:bg-brand-sage-dark"
          size="sm"
          variant="primary"
        >
          <CookingPot size={16} weight="bold" />
          レシピ追加
        </Button>
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
};

export const Header = () => {
  const session = useAuthSession();

  return (
    <header className="sticky top-0 z-40 flex flex-col gap-4 border-b border-brand-line bg-brand-cream/95 backdrop-blur-md px-4 sm:px-6 lg:px-10 py-3 sm:flex-row sm:items-center sm:justify-between">
      <Link className="font-bold text-lg text-brand-walnut no-underline tracking-tight" to="/">
        Recipe Stock
      </Link>
      {session.data ? <AppNav /> : <PublicNav />}
    </header>
  );
};
