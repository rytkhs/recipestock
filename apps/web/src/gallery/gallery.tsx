import { useEffect, useRef, useState } from "react";
import { type ShortcutRelinkReason, shortcutRelinkReasonSchema } from "../features/ios-share/api";
import { type IosDeviceName } from "../pwa/platform";
import { IosShareGallery } from "./ios-share";

const deviceNames: IosDeviceName[] = ["iPhone", "iPad"];
const zoomOptions = [1, 0.75, 0.5];

const selectClass =
  "rounded-md border border-brand-line bg-brand-paper px-2 py-1 text-brand-ink text-sm";

const controlClass = "flex items-center gap-2 text-brand-muted text-sm";

/**
 * 画面のパターンを並べて見る開発用のページ（/gallery.html）。本物の部品に状態を直接渡して描くので、
 * 押して進む挙動は再現しない。文言だけが変わる違い（端末、連携し直しの理由）は、行を増やさず切り替えで見る。
 */
export const Gallery = () => {
  const [deviceName, setDeviceName] = useState<IosDeviceName>("iPhone");
  const [relinkReason, setRelinkReason] = useState<ShortcutRelinkReason>("missing_credential");
  const [opensDetails, setOpensDetails] = useState(false);
  const [zoom, setZoom] = useState(0.75);
  const contentRef = useRef<HTMLDivElement>(null);

  // 「うまくいかないとき」など、折りたたんだ中の文言も並べて読めるようにする。
  useEffect(() => {
    for (const details of contentRef.current?.querySelectorAll("details") ?? []) {
      details.open = opensDetails;
    }
  }, [opensDetails]);

  return (
    <div className="min-h-screen bg-brand-paper-muted pt-20">
      <header className="fixed inset-x-0 top-0 z-40 flex flex-wrap items-center gap-x-6 gap-y-2 border-brand-line border-b bg-background/95 px-6 py-3 backdrop-blur-md">
        <h1 className="font-bold text-base text-brand-ink">UIギャラリー</h1>
        <label className={controlClass}>
          端末
          <select
            className={selectClass}
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value as IosDeviceName)}
          >
            {deviceNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={controlClass}>
          連携し直しの理由
          <select
            className={selectClass}
            value={relinkReason}
            onChange={(event) =>
              setRelinkReason(shortcutRelinkReasonSchema.parse(event.target.value))
            }
          >
            {shortcutRelinkReasonSchema.options.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
        </label>
        <label className={controlClass}>
          <input
            checked={opensDetails}
            type="checkbox"
            onChange={(event) => setOpensDetails(event.target.checked)}
          />
          折りたたみを開く
        </label>
        <label className={controlClass}>
          表示
          <select
            className={selectClass}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          >
            {zoomOptions.map((option) => (
              <option key={option} value={option}>
                {option * 100}%
              </option>
            ))}
          </select>
        </label>
      </header>
      {/* 余白は縮小の外に取る。縮小すると、固定した上の操作の下に見出しが隠れる。 */}
      <div className="w-max px-6 pt-4 pb-16" ref={contentRef} style={{ zoom }}>
        <IosShareGallery deviceName={deviceName} relinkReason={relinkReason} />
      </div>
    </div>
  );
};
