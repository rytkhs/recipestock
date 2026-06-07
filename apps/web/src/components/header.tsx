import { Button } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { signOut, useAuthSession } from "../lib/auth";
import { clearUserScopedCache } from "../lib/query-cache";

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
  const queryClient = useQueryClient();
  const session = useAuthSession();

  const handleSignOut = async () => {
    await signOut();
    clearUserScopedCache(queryClient);
    await session.refetch();
    await navigate({ to: "/login" });
  };

  return (
    <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-x-1 gap-y-2">
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
        to="/import"
      >
        <Button size="sm" variant="ghost">
          レシピ登録
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
      <Button size="sm" variant="ghost" onPress={() => void handleSignOut()}>
        ログアウト
      </Button>
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
