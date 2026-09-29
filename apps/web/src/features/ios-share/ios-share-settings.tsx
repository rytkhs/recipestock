import { type ShortcutCredential } from "@recipestock/schemas";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SkeletonBlock } from "../../components/loading";
import { type IosDeviceName } from "../../pwa/platform";
import { PushNotificationSettings } from "../push-notifications/settings-section";
import {
  isShortcutCredentialUsed,
  isShortcutLinked,
  listShortcutCredentials,
  type ShortcutRelinkReason,
  shortcutCredentialsQueryKey,
} from "./api";
import { ShortcutSetupComplete } from "./setup-complete";
import { ShareFlow } from "./share-flow";
import { ShortcutKeys } from "./shortcut-keys";
import { ShortcutSetup } from "./shortcut-setup";
import { ShortcutSyncNote } from "./shortcut-sync-note";
import { ShortcutTroubleshooting } from "./troubleshooting";
import { useShortcutSetup } from "./use-shortcut-setup";

const usedCredentialIds = (credentials: readonly ShortcutCredential[]): ReadonlySet<string> =>
  new Set(credentials.filter(isShortcutCredentialUsed).map(({ id }) => id));

/**
 * 画面は連携キーの一覧と、開いている間の操作だけで決める。ショートカットAppへ移っている間にアプリが
 * 閉じられても、Safariで設定を済ませても、どの入れ物で開き直しても同じ画面になる。
 */
const IosShareSettingsContent = ({
  credentials,
  deviceName,
  initialRelinkReason,
}: {
  credentials: ShortcutCredential[];
  deviceName: IosDeviceName;
  initialRelinkReason?: ShortcutRelinkReason;
}) => {
  const setup = useShortcutSetup({ deviceName });
  const [relinkReason, setRelinkReason] = useState(initialRelinkReason);
  const [isSettingUpHere, setIsSettingUpHere] = useState(false);
  // 設定を始めた時点で使われていたキー。これ以外のキーが使われたら、どのキーでも連携できたとみなす。
  // 発行し直す前のキーや、Safariで発行したキーで共有しても、ここで待っている人に完了を見せられる。
  const [usedAtStart, setUsedAtStart] = useState(() => usedCredentialIds(credentials));
  const isLinked = isShortcutLinked(credentials);
  const isSettingUp = relinkReason !== undefined || isSettingUpHere || usedAtStart.size === 0;
  const hasNewlyUsedKey = credentials.some(
    (credential) => isShortcutCredentialUsed(credential) && !usedAtStart.has(credential.id),
  );

  const startSetupHere = () => {
    setup.startOver();
    setUsedAtStart(usedCredentialIds(credentials));
    setIsSettingUpHere(true);
  };

  if (isSettingUp && hasNewlyUsedKey) {
    return <ShortcutSetupComplete />;
  }

  if (relinkReason || isSettingUpHere || !isLinked) {
    return (
      <ShortcutSetup
        deviceName={deviceName}
        relinkReason={relinkReason}
        // 未連携のまま発行してあったキー。開き直したときは、これに共有が届くのを待つところから続ける。
        resumableCredential={
          relinkReason || isSettingUpHere
            ? null
            : (credentials.find((credential) => !isShortcutCredentialUsed(credential)) ?? null)
        }
        setup={setup}
        variant={relinkReason ? "relink" : isLinked ? "another" : "first"}
        onCancel={
          isLinked
            ? () => {
                setup.startOver();
                setRelinkReason(undefined);
                setIsSettingUpHere(false);
              }
            : undefined
        }
        onRestart={startSetupHere}
      />
    );
  }

  return (
    <div className="grid gap-10">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ShareFlow />
        <p className="text-brand-muted text-sm">で取り込めます</p>
      </div>
      <ShortcutKeys />
      <div className="grid gap-4">
        <ShortcutSyncNote />
        <Button className="h-11 w-full text-base" variant="secondary" onClick={startSetupHere}>
          この{deviceName}でショートカットを追加する
        </Button>
      </div>
      <PushNotificationSettings />
      <ShortcutTroubleshooting deviceName={deviceName} onRestart={startSetupHere} />
    </div>
  );
};

/**
 * iPhoneとiPadの「共有から取り込む」。まだ連携していないか、連携し直しに来たか、この端末で追加するときは
 * 設定の手順を、それ以外は連携の管理を出す。共有が届いたかどうかは、アプリへ戻ったときの一覧の読み直しで知る。
 */
export const IosShareSettings = ({
  deviceName,
  relinkReason,
}: {
  deviceName: IosDeviceName;
  relinkReason?: ShortcutRelinkReason;
}) => {
  const credentialsQuery = useQuery({
    queryKey: shortcutCredentialsQueryKey,
    queryFn: listShortcutCredentials,
  });

  // 一度読めたあとは、読み直しに失敗しても手順を出したままにする。コピーできずに出したキーも消さない。
  if (credentialsQuery.data) {
    return (
      <IosShareSettingsContent
        credentials={credentialsQuery.data.credentials}
        deviceName={deviceName}
        initialRelinkReason={relinkReason}
      />
    );
  }

  if (credentialsQuery.isError) {
    return (
      <div className="grid justify-items-start gap-3">
        <p className="text-brand-danger text-sm" role="alert">
          連携の状態を読み込めませんでした。
        </p>
        <Button
          disabled={credentialsQuery.isFetching}
          variant="secondary"
          onClick={() => void credentialsQuery.refetch()}
        >
          もう一度読み込む
        </Button>
      </div>
    );
  }

  return (
    <div aria-label="連携の状態を読み込み中" className="grid gap-3" role="status">
      <SkeletonBlock className="h-6 w-2/3 max-w-sm" />
      <SkeletonBlock className="h-4 w-full max-w-md" />
      <SkeletonBlock className="mt-2 h-11 w-full" />
    </div>
  );
};
