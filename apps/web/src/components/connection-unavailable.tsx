import { Button } from "@heroui/react";
import { ArrowClockwise, WifiSlash } from "@phosphor-icons/react";

export const ConnectionUnavailable = ({
  isRetrying,
  onRetry,
}: {
  isRetrying: boolean;
  onRetry: () => Promise<void>;
}) => (
  <section className="mx-auto flex min-h-[60vh] w-full max-w-[680px] items-center px-4 py-12 sm:px-6">
    <div className="w-full rounded-[24px] border border-brand-line-soft bg-brand-paper p-6 text-center shadow-pantry-sm sm:p-10">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-orange-soft text-brand-orange">
        <WifiSlash size={28} weight="bold" />
      </div>
      <h1 className="mt-5 font-bold text-2xl text-brand-ink">接続を確認できません</h1>
      <p className="mx-auto mt-3 max-w-md text-brand-muted text-sm leading-relaxed">
        表示に必要な情報を取得できませんでした。接続が戻ると自動で再確認します。
      </p>
      <Button
        className="mt-6 rounded-full font-semibold"
        isDisabled={isRetrying}
        type="button"
        variant="secondary"
        onPress={() => void onRetry()}
      >
        <ArrowClockwise size={16} weight="bold" />
        {isRetrying ? "再試行中" : "再試行"}
      </Button>
    </div>
  </section>
);
