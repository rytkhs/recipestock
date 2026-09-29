import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { pushSubscriptionsQueryKey } from "../features/push-notifications/api";
import { pushSubscriptionsFixture } from "../mocks/fixtures";

export type FrameSize = "phone" | "tablet";

// 中身は画面幅では変わらないので、iframeにせず、ページの余白だけを端末に合わせて当てる。
const frameSizeClass: Record<FrameSize, string> = {
  phone: "w-[390px] px-4",
  tablet: "w-[768px] px-6",
};

/**
 * 1つの画面。一覧を読む部品のために、枠ごとに別のQueryClientを持つ。読み込みは始めないので、
 * `seed`で入れた状態だけで描く。
 */
export const Frame = ({
  children,
  label,
  seed,
  size,
}: {
  children: ReactNode;
  label: string;
  seed?: (queryClient: QueryClient) => void;
  size: FrameSize;
}) => {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity } },
    });
    // 通知の設定は、ブラウザが通知に対応していれば、自分で読み込みを有効にして購読の一覧を読む。
    client.setQueryData(pushSubscriptionsQueryKey, pushSubscriptionsFixture());
    seed?.(client);
    return client;
  });

  return (
    <figure className="grid content-start gap-2">
      <figcaption className="font-medium text-brand-muted text-xs">{label}</figcaption>
      <div
        className={cn(
          "rounded-[20px] border border-brand-line bg-background py-5 shadow-pantry-sm",
          frameSizeClass[size],
        )}
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </div>
    </figure>
  );
};
