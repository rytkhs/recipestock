import { CaretLeft } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { ScreenTopBar, ScreenTopBarIconButton } from "../../components/screen-top-bar";

// 設定のページはどれもタグの管理と同じ幅にする。広い画面でも1列のまま読む。
export const settingsPageClass = "mx-auto w-full max-w-3xl px-0 pb-10 sm:px-6 lg:px-10";

export const settingsPageBodyClass = "mt-4 px-4 sm:mt-6 sm:px-0";

// 目次から開くページの上部バー。戻る先は来た経路によらず目次にする。
export const SettingsSubpageTopBar = ({ title }: { title: string }) => {
  const navigate = useNavigate();

  return (
    <ScreenTopBar
      leading={
        <ScreenTopBarIconButton
          aria-label="設定へ戻る"
          onPress={() => {
            void navigate({ to: "/settings" });
          }}
        >
          <CaretLeft size={21} weight="bold" />
        </ScreenTopBarIconButton>
      }
      title={title}
    />
  );
};
