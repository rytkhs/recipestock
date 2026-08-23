import { Button } from "@heroui/react";
import { type ErrorComponentProps } from "@tanstack/react-router";

export const RouteChunkError = (_props: ErrorComponentProps) => (
  <section
    aria-label="画面を読み込めませんでした"
    className="mx-auto flex w-full max-w-[640px] flex-col items-center px-4 py-16 text-center sm:px-6"
    role="alert"
  >
    <h1 className="text-brand-ink font-bold text-2xl">画面を読み込めませんでした</h1>
    <p className="mt-3 text-brand-muted text-sm">
      通信状態を確認してから、もう一度お試しください。
    </p>
    <Button
      className="mt-6 rounded-full bg-brand-sage px-5 font-semibold text-white hover:bg-brand-sage-dark"
      variant="primary"
      onPress={() => window.location.reload()}
    >
      再読み込み
    </Button>
  </section>
);
