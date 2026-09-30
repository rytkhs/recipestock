import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AndroidShareGuide } from "../features/ios-share/android-share-guide";
import { DesktopShareGuide } from "../features/ios-share/desktop-share-guide";
import { IosShareSettings } from "../features/ios-share/ios-share-settings";
import {
  SettingsSubpageTopBar,
  settingsPageBodyClass,
  settingsPageClass,
} from "../features/settings/settings-page";
import { detectSharePlatform } from "../pwa/platform";

const shareRouteApi = getRouteApi("/_protected/settings/share");

// 共有から取り込む方法は端末ごとに違うので、開いた端末のやり方だけを出す。
// 完了通知はショートカットから始めた取り込みにしか届かないので、iPhoneとiPadの画面にだけ置く。
export const SettingsShareRoute = () => {
  const navigate = useNavigate();
  const search = shareRouteApi.useSearch();
  // 理由は開いたときに一度だけ読んで持ち、URLからは消す。再読み込みで古いお知らせを出さない。
  const [relinkReason] = useState(search.reason);
  const [platform] = useState(detectSharePlatform);

  useEffect(() => {
    if (search.reason) {
      void navigate({ to: "/settings/share", search: {}, replace: true });
    }
  }, [navigate, search.reason]);

  return (
    <section className={settingsPageClass}>
      <SettingsSubpageTopBar title="共有から取り込む" />

      <div className={settingsPageBodyClass}>
        {platform.kind === "ios" ? (
          <IosShareSettings deviceName={platform.deviceName} relinkReason={relinkReason} />
        ) : null}
        {platform.kind === "android" ? <AndroidShareGuide /> : null}
        {platform.kind === "other" ? <DesktopShareGuide /> : null}
      </div>
    </section>
  );
};
