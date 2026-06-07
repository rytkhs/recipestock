import { Button, Description, Dropdown, Label } from "@heroui/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAuthSession } from "../lib/auth";

const PublicNav = () => (
  <nav aria-label="Main navigation" className="flex items-center gap-2">
    <Link className="link no-underline text-sm" to="/login">
      <Button size="sm" variant="secondary">
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
        <Button size="sm" variant="primary">
          レシピ追加
        </Button>
        <Dropdown.Popover className="min-w-56">
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
              <div className="flex flex-col">
                <Label>URLから</Label>
                <Description>サイトから取り込む</Description>
              </div>
            </Dropdown.Item>
            <Dropdown.Item id="manual" textValue="手入力">
              <div className="flex flex-col">
                <Label>手入力</Label>
                <Description>レシピを自分で入力</Description>
              </div>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <Link
        activeProps={{ className: "text-accent font-semibold" }}
        className="link no-underline text-default-700 text-sm"
        to="/recipes"
      >
        <Button size="sm" variant="ghost">
          レシピ一覧
        </Button>
      </Link>
      <Link
        activeProps={{ className: "text-accent font-semibold" }}
        className="link no-underline text-default-700 text-sm"
        to="/settings"
      >
        <Button size="sm" variant="ghost">
          アカウント
        </Button>
      </Link>
    </nav>
  );
};

export const Header = () => {
  const session = useAuthSession();

  return (
    <header className="flex flex-col gap-4 border-border border-b bg-surface px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
      <Link className="font-bold text-lg no-underline" to="/">
        Recipe Stock
      </Link>
      {session.data ? <AppNav /> : <PublicNav />}
    </header>
  );
};
