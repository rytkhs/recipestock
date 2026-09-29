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
import { ShortcutSetup, type ShortcutSetupVariant } from "./shortcut-setup";
import { ShortcutSyncNote } from "./shortcut-sync-note";
import { ShortcutTroubleshooting } from "./troubleshooting";
import { useShortcutSetup } from "./use-shortcut-setup";

const usedCredentialIds = (credentials: readonly ShortcutCredential[]): ReadonlySet<string> =>
  new Set(credentials.filter(isShortcutCredentialUsed).map(({ id }) => id));

/** 1回分の設定。始めるたびに`id`を変え、手順の状態と完了の基準を作り直す。 */
type SetupSession = {
  id: number;
  variant: ShortcutSetupVariant;
  relinkReason?: ShortcutRelinkReason;
  /** 開いたときや、未連携になったときに始まった設定。発行したまま使われていないキーがあれば、その続きから出す。 */
  resumesUnusedKey: boolean;
};

const firstSetupSession: SetupSession = { id: 0, variant: "first", resumesUnusedKey: true };

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
  const setup = useShortcutSetup({ deviceName });
  const [atStart] = useState(() => ({
    // これ以外のキーが使われたら、どのキーでも連携できたとみなす。発行し直す前のキーや、
    // Safariで発行したキーで共有しても、ここで待っている人に完了を見せられる。
    usedIds: usedCredentialIds(credentials),
    resumableCredential: session.resumesUnusedKey
      ? (credentials.find((credential) => !isShortcutCredentialUsed(credential)) ?? null)
      : null,
  }));
  const hasNewlyUsedKey = credentials.some(
    (credential) => isShortcutCredentialUsed(credential) && !atStart.usedIds.has(credential.id),
  );

  if (hasNewlyUsedKey) {
    return <ShortcutSetupComplete />;
  }

  return (
    <ShortcutSetup
      deviceName={deviceName}
      relinkReason={session.relinkReason}
      resumableCredential={atStart.resumableCredential}
      setup={setup}
      variant={session.variant}
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
      return {
        id: 0,
        variant: "relink",
        relinkReason: initialRelinkReason,
        resumesUnusedKey: false,
      };
    }
    return isLinked ? null : firstSetupSession;
  });

  // 未連携なら、いつも設定の途中にいる。連携の管理で最後の連携キーを解除したときも、ここから設定を始める。
  if (session === null && !isLinked) {
    setSession(firstSetupSession);
    return null;
  }

  // 設定の途中なら同じ始め方で、連携の管理からならこの端末で追加する設定として、最初から始める。
  const startSetupHere = () => {
    setSession((current) => ({
      id: (current?.id ?? 0) + 1,
      variant: current?.variant ?? "another",
      relinkReason: current?.relinkReason,
      resumesUnusedKey: false,
    }));
  };

  if (session) {
    return (
      <ShortcutSetupSession
        credentials={credentials}
        deviceName={deviceName}
        key={session.id}
        session={session}
        onCancel={isLinked ? () => setSession(null) : undefined}
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
