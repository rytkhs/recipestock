import { cn } from "@/lib/utils";
import { type IosDeviceName } from "../../pwa/platform";

/** 誘いがこの端末（iPhone、iPad）での設定だと分かるよう、項目の名前に添える札。背景は置く場所に合わせて渡す。 */
export const DeviceBadge = ({
  className,
  deviceName,
}: {
  className: string;
  deviceName: IosDeviceName;
}) => (
  <span
    className={cn(
      "rounded-full border border-brand-line px-2 font-bold text-[11px] text-brand-muted leading-[18px]",
      className,
    )}
  >
    {deviceName}
  </span>
);
