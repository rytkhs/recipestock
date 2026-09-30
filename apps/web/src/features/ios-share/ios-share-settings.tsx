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

// 共有はアプリの外で起きるので、数秒で気づければよい。
const sharePollIntervalMs = 3000;

const usedCredentialIds = (credentials: readonly ShortcutCredential[]): ReadonlySet<string> =>
  new Set(credentials.filter(isShortcutCredentialUsed).map(({ id }) => id));

/**
 * 1回分の設定。始めるたびに`id`を変え、手順の状態と完了の基準を作り直す。
 * 値は始まり方で決まる（docs/shortcut/ios-share.mdの表1）。
 */
type SetupSession = {
  id: number;
  /** 初回の案内を出すか。 */
  showsIntro: boolean;
  relinkReason?: ShortcutRelinkReason;
  /** この端末にショートカットがもうありうるか。ありうるなら、②で置き換えるよう添える。 */
  mayHaveShortcut: boolean;
  /** 発行したまま使われていないキーがあれば、その続きから出すか。 */
  resumesUnusedKey: boolean;
};

// 前にキーをすべて解除した人にはショートカットが残っているが、見分けられないのでiOSの確認に任せる。
const openedUnlinkedSession: SetupSession = {
  id: 0,
  showsIntro: true,
  mayHaveShortcut: false,
  resumesUnusedKey: true,
};

// 連携の管理を出している間に、最後の使ったキーが解除された。解除したキーのショートカットが残っている。
const becameUnlinkedSession: SetupSession = { ...openedUnlinkedSession, mayHaveShortcut: true };

const relinkSession = (relinkReason: ShortcutRelinkReason): SetupSession => ({
  id: 0,
  showsIntro: false,
  relinkReason,
  mayHaveShortcut: true,
  resumesUnusedKey: false,
});

// 連携の管理から、この端末で追加するか、最初からやり直す。iCloudで同期されて、もう入っていることがある。
const addHereSession: SetupSession = {
  id: 0,
  showsIntro: false,
  mayHaveShortcut: true,
  resumesUnusedKey: false,
};

// やり直しを案内するのは、ショートカットを追加したあとのつまずきだけ。導入と理由は元の設定のまま出す。
const restartSession = (current: SetupSession): SetupSession => ({
  ...current,
  id: current.id + 1,
  mayHaveShortcut: true,
  resumesUnusedKey: false,
});

/**
 * 設定を始めた時点の連携キーの一覧から、完了の基準と、続きから出すキーを決める。どちらもこの設定の間は変えないので、
 * この画面で発行したキーが一覧に入っても、続きのキーとは取り違えない。
 */
const ShortcutSetupSession = ({
  credentials,
  deviceName,
  onCancel,
  onRestart,
  session,
}: {
  credentials: ShortcutCredential[];
  deviceName: IosDeviceName;
  onCancel?: () => void;
  onRestart: () => void;
  session: SetupSession;
}) => {
  const [atStart] = useState(() => {
    const resumableCredential = session.resumesUnusedKey
      ? (credentials.find((credential) => !isShortcutCredentialUsed(credential)) ?? null)
      : null;

    return {
      // これ以外のキーが使われたら、どのキーでも連携できたとみなす。発行し直す前のキーや、
      // Safariで発行したキーで共有しても、ここで待っている人に完了を見せられる。
      usedIds: usedCredentialIds(credentials),
      resumableCredential,
      // 続きのキーがあれば、それを貼って追加し終えていることがある。
      mayHaveShortcut: session.mayHaveShortcut || resumableCredential !== null,
    };
  });
  const setup = useShortcutSetup({
    deviceName,
    resumableCredential: atStart.resumableCredential,
  });
  const hasNewlyUsedKey = credentials.some(
    (credential) => isShortcutCredentialUsed(credential) && !atStart.usedIds.has(credential.id),
  );
  // 一覧は親が読んでいる。ここでは、共有を待っている間の読み直しだけを足す。iPadのSplit ViewやStage Managerでは、
  // この画面が見えたまま共有するので、アプリへ戻ったときの読み直しが起きない。
  useQuery({
    queryKey: shortcutCredentialsQueryKey,
    queryFn: listShortcutCredentials,
    refetchOnMount: false,
    refetchInterval: setup.isWaitingForShare && !hasNewlyUsedKey ? sharePollIntervalMs : false,
  });

  if (hasNewlyUsedKey) {
    return <ShortcutSetupComplete />;
  }

  return (
    <ShortcutSetup
      deviceName={deviceName}
      mayHaveShortcut={atStart.mayHaveShortcut}
      relinkReason={session.relinkReason}
      resumableCredential={atStart.resumableCredential}
      setup={setup}
      showsIntro={session.showsIntro}
      onCancel={onCancel}
      onRestart={onRestart}
    />
  );
};

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
  const isLinked = isShortcutLinked(credentials);
  const [session, setSession] = useState<SetupSession | null>(() => {
    if (initialRelinkReason) {
      return relinkSession(initialRelinkReason);
    }
    return isLinked ? null : openedUnlinkedSession;
  });

  // 未連携なら、いつも設定の途中にいる。連携の管理で最後の連携キーを解除したときも、ここから設定を始める。
  if (session === null && !isLinked) {
    setSession(becameUnlinkedSession);
    return null;
  }

  const startSetupHere = () => {
    setSession(addHereSession);
  };

  if (session) {
    return (
      <ShortcutSetupSession
        credentials={credentials}
        deviceName={deviceName}
        key={session.id}
        session={session}
        onCancel={isLinked ? () => setSession(null) : undefined}
        onRestart={() => setSession((current) => current && restartSession(current))}
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
 * 設定の手順を、それ以外は連携の管理を出す。共有が届いたかどうかは、アプリへ戻ったときと、共有を待っている間の一覧の読み直しで知る。
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
