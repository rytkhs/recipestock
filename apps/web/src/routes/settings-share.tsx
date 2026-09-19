import { LinkThisDevice } from "../features/ios-share/link-this-device";
import { LinkedDevices } from "../features/ios-share/linked-devices";
import { PushNotificationSettings } from "../features/push-notifications/settings-section";
import {
  SettingsSubpageTopBar,
  settingsPageBodyClass,
  settingsPageClass,
} from "../features/settings/settings-page";

// 完了通知はショートカットから始めた取り込みにしか届かないので、共有の連携と同じページに置く。
export const SettingsShareRoute = () => (
  <section className={settingsPageClass}>
    <SettingsSubpageTopBar title="共有から取り込む" />

    <div className={`${settingsPageBodyClass} grid gap-10`}>
      <p className="text-brand-muted text-sm leading-6">
        iPhoneやiPadの共有メニューから、レシピのページをRecipe Stockへ直接取り込めます。
      </p>
      <LinkedDevices />
      <LinkThisDevice />
      <PushNotificationSettings />
    </div>
  </section>
);
