import { Button } from "@heroui/react";
import { DownloadSimple } from "@phosphor-icons/react";
import { useState } from "react";

export const IosShareInstallGuide = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-5 rounded-[16px] border border-brand-sage-soft bg-brand-sage-soft/20 p-4">
      <div className="flex items-start gap-3">
        <DownloadSimple className="mt-0.5 shrink-0 text-brand-sage-dark" size={20} weight="bold" />
        <div className="min-w-0">
          <p className="font-semibold text-brand-walnut">次回からRecipe StockをPWAで開く</p>
          <p className="mt-1 text-brand-muted text-sm">
            ホーム画面に追加すると、共有したURLをRecipe Stockアプリで開けます。
          </p>
          <Button
            className="mt-3 rounded-full font-semibold"
            size="sm"
            variant="secondary"
            onPress={() => setIsOpen((value) => !value)}
          >
            {isOpen ? "追加方法を閉じる" : "追加方法を見る"}
          </Button>
          {isOpen ? (
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-brand-muted text-sm">
              <li>Safariの共有ボタンをタップ</li>
              <li>「ホーム画面に追加」を選択</li>
              <li>「Web Appとして開く」をオンにして追加</li>
              <li>追加したRecipe Stockを開いてログイン</li>
            </ol>
          ) : null}
          <p className="mt-3 text-brand-muted text-xs">
            追加済みの場合は、Recipe Stockを一度開いてログイン状態を確認してください。
          </p>
        </div>
      </div>
    </div>
  );
};
