import {
  type ListShortcutCredentialsResponse,
  type ShortcutCredential,
} from "@recipestock/schemas";
import { type QueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";
import { AndroidShareGuide } from "../features/ios-share/android-share-guide";
import { type ShortcutRelinkReason, shortcutCredentialsQueryKey } from "../features/ios-share/api";
import { DesktopShareGuide } from "../features/ios-share/desktop-share-guide";
import { IosShareSettings } from "../features/ios-share/ios-share-settings";
import { ShortcutSetupComplete } from "../features/ios-share/setup-complete";
import { ShortcutSetup } from "../features/ios-share/shortcut-setup";
import {
  type ShortcutKeyPhase,
  type ShortcutSetupState,
} from "../features/ios-share/use-shortcut-setup";
import {
  linkedShortcutCredentialsFixture,
  shortcutCredentialFixture,
  shortcutCredentialsFixture,
} from "../mocks/fixtures";
import { type IosDeviceName } from "../pwa/platform";
import { Frame, type FrameSize } from "./frame";

const noop = () => {};
const asyncNoop = async () => {};

// 発行したまま共有が届いていないキー。設定の続きと、連携の管理の「使われていないキー」に出る。
const unusedCredential = shortcutCredentialFixture({
  id: "credential_unused",
  name: "iPhone",
  tokenSuffix: "c21d",
  createdAt: "2026-06-24T00:00:00.000Z",
  firstUsedAt: null,
  lastUsedAt: null,
});

// この画面で発行したキー。平文はコピーできなかったときだけ見える。
const issuedKey = (
  overrides: Partial<Extract<ShortcutKeyPhase, { status: "issued" }>> = {},
): ShortcutKeyPhase => ({
  status: "issued",
  credential: shortcutCredentialFixture({
    id: "credential_issued",
    tokenSuffix: "7f3a",
    firstUsedAt: null,
    lastUsedAt: null,
  }),
  token: "rssc_GalleryTokenForLocalDev7f3a",
  isCopied: true,
  isCopiedAgain: false,
  ...overrides,
});

/**
 * docs/shortcut/ios-share.mdの表1の始まり方。画面が同じになる始まり方は1行にまとめ、`sameAs`に書く。
 * 連携し直しの理由は、見出しの切り替えで選ぶ。
 */
type SetupStart = {
  label: string;
  sameAs?: string;
  showsIntro: boolean;
  isRelink: boolean;
  mayHaveShortcut: boolean;
  hasResumableKey: boolean;
  isLinked: boolean;
};

const setupStarts: SetupStart[] = [
  {
    label: "未連携で開いた（使われていないキーなし）",
    showsIntro: true,
    isRelink: false,
    mayHaveShortcut: false,
    hasResumableKey: false,
    isLinked: false,
  },
  {
    label: "未連携で開いた（使われていないキーあり）",
    sameAs: "連携の管理を出している間に未連携になった（使われていないキーあり）",
    showsIntro: true,
    isRelink: false,
    mayHaveShortcut: true,
    hasResumableKey: true,
    isLinked: false,
  },
  {
    label: "連携の管理を出している間に未連携になった",
    sameAs: "未連携で始めた設定を、途中の「うまくいかないとき」からやり直した",
    showsIntro: true,
    isRelink: false,
    mayHaveShortcut: true,
    hasResumableKey: false,
    isLinked: false,
  },
  {
    label: "連携し直しに来た（?reason=、連携済み）",
    sameAs: "その設定を途中からやり直した。未連携なら「やめる」が出ないだけ",
    showsIntro: false,
    isRelink: true,
    mayHaveShortcut: true,
    hasResumableKey: false,
    isLinked: true,
  },
  {
    label: "連携の管理で「この端末でショートカットを追加する」",
    sameAs: "連携の管理の「うまくいかないとき」からやり直した、その設定を途中からやり直した",
    showsIntro: false,
    isRelink: false,
    mayHaveShortcut: true,
    hasResumableKey: false,
    isLinked: true,
  },
];

/** 表2の段階。`withResumableKey`は、続きのキーがあるときだけ（true）か、ないときだけ（false）起きる段階。 */
type SetupStage = {
  label: string;
  key: ShortcutKeyPhase;
  hasOpenedShortcut?: boolean;
  withResumableKey?: boolean;
};

// 列は段階でそろえる。続きのキーがあるかどうかで入れ替わる段階は、同じ列に置く。
const noKey: ShortcutKeyPhase = { status: "none", hasIssueError: false };
const noKeyAfterIssueError: ShortcutKeyPhase = { status: "none", hasIssueError: true };

const setupColumns: SetupStage[][] = [
  [
    { label: "キーなし", key: noKey, withResumableKey: false },
    { label: "続きのキーがある", key: noKey, withResumableKey: true },
  ],
  [
    { label: "キーなし・発行できなかった", key: noKeyAfterIssueError, withResumableKey: false },
    {
      label: "続きのキーがある・発行し直せなかった",
      key: noKeyAfterIssueError,
      withResumableKey: true,
    },
  ],
  [{ label: "発行中", key: { status: "issuing" } }],
  [{ label: "発行してコピーできた", key: issuedKey() }],
  [{ label: "もう一度コピーした", key: issuedKey({ isCopiedAgain: true }) }],
  [{ label: "発行したがコピーできなかった", key: issuedKey({ isCopied: false }) }],
  [{ label: "②を開いた", key: issuedKey(), hasOpenedShortcut: true }],
  [
    {
      label: "続きのキーがある・②を開いた",
      key: noKey,
      hasOpenedShortcut: true,
      withResumableKey: true,
    },
  ],
];

const occursIn = (stage: SetupStage, start: SetupStart) =>
  stage.withResumableKey === undefined || stage.withResumableKey === start.hasResumableKey;

// useShortcutSetupと同じ決め方で、段階から手順の状態を作る。押しても進まない。
const setupStateAt = (
  stage: SetupStage,
  resumableCredential: ShortcutCredential | null,
): ShortcutSetupState => {
  const hasOpenedShortcut = stage.hasOpenedShortcut ?? false;
  const isResumed = stage.key.status === "none" && resumableCredential !== null;

  return {
    key: stage.key,
    hasOpenedShortcut,
    isResumed,
    isWaitingForShare: hasOpenedShortcut || isResumed,
    issueAndCopyKey: asyncNoop,
    copyKeyAgain: asyncNoop,
    markShortcutOpened: noop,
  };
};

const Fact = ({ label, value }: { label: string; value: string }) => (
  <span className="rounded-full border border-brand-line bg-brand-paper px-2.5 py-0.5 text-brand-walnut text-xs">
    {label}: {value}
  </span>
);

const SetupStartHeader = ({ start }: { start: SetupStart }) => (
  <div className="sticky left-6 col-span-full mt-10 grid justify-self-start gap-2 first:mt-0">
    <h3 className="font-bold text-base text-brand-ink">{start.label}</h3>
    {start.sameAs ? <p className="text-brand-muted text-xs">同じ画面: {start.sameAs}</p> : null}
    <div className="flex flex-wrap gap-1.5">
      <Fact
        label="導入"
        value={start.showsIntro ? "初回の案内" : start.isRelink ? "理由のお知らせ" : "なし"}
      />
      <Fact label="②の置き換え" value={start.mayHaveShortcut ? "添える" : "添えない"} />
      <Fact label="続きのキー" value={start.hasResumableKey ? "あり" : "なし"} />
      <Fact label="「やめる」" value={start.isLinked ? "出す" : "出さない"} />
    </div>
  </div>
);

const SetupScreens = ({
  deviceName,
  frameSize,
  relinkReason,
}: {
  deviceName: IosDeviceName;
  frameSize: FrameSize;
  relinkReason: ShortcutRelinkReason;
}) => (
  <div
    className="grid items-start gap-x-6 gap-y-4"
    style={{ gridTemplateColumns: `repeat(${setupColumns.length}, max-content)` }}
  >
    {setupStarts.map((start) => {
      const resumableCredential = start.hasResumableKey ? unusedCredential : null;

      return (
        <Fragment key={start.label}>
          <SetupStartHeader start={start} />
          {setupColumns.map((column) => {
            const columnKey = column.map(({ label }) => label).join("/");
            const stage = column.find((candidate) => occursIn(candidate, start));

            // 起きない段階は空けて、列をそろえる。
            if (!stage) return <div aria-hidden="true" key={columnKey} />;

            return (
              <Frame key={columnKey} label={stage.label} size={frameSize}>
                <ShortcutSetup
                  deviceName={deviceName}
                  mayHaveShortcut={start.mayHaveShortcut}
                  relinkReason={start.isRelink ? relinkReason : undefined}
                  resumableCredential={resumableCredential}
                  setup={setupStateAt(stage, resumableCredential)}
                  showsIntro={start.showsIntro}
                  onCancel={start.isLinked ? noop : undefined}
                  onRestart={noop}
                />
              </Frame>
            );
          })}
        </Fragment>
      );
    })}
  </div>
);

const seedCredentials =
  (response: ListShortcutCredentialsResponse) => (queryClient: QueryClient) => {
    queryClient.setQueryData(shortcutCredentialsQueryKey, response);
  };

const seedCredentialsError = (queryClient: QueryClient) => {
  queryClient
    .getQueryCache()
    .build(queryClient, { queryKey: shortcutCredentialsQueryKey })
    .setState({ status: "error", error: new Error("Gallery"), errorUpdatedAt: Date.now() });
};

const linkedCredentials = linkedShortcutCredentialsFixture();

/** 表3の、設定の外の画面。 */
const OutsideScreens = ({
  deviceName,
  frameSize,
}: {
  deviceName: IosDeviceName;
  frameSize: FrameSize;
}) => (
  <div className="flex items-start gap-6">
    <Frame label="一覧を読み込み中" size={frameSize}>
      <IosShareSettings deviceName={deviceName} />
    </Frame>
    <Frame label="一覧をまだ一度も読めていない" seed={seedCredentialsError} size={frameSize}>
      <IosShareSettings deviceName={deviceName} />
    </Frame>
    <Frame label="連携の管理" seed={seedCredentials(linkedCredentials)} size={frameSize}>
      <IosShareSettings deviceName={deviceName} />
    </Frame>
    <Frame
      label="連携の管理（使われていないキーもある）"
      seed={seedCredentials(
        shortcutCredentialsFixture({
          credentials: [unusedCredential, ...linkedCredentials.credentials],
        }),
      )}
      size={frameSize}
    >
      <IosShareSettings deviceName={deviceName} />
    </Frame>
    <Frame label="連携できました" size={frameSize}>
      <ShortcutSetupComplete />
    </Frame>
    <Frame label="Android" seed={seedCredentials(linkedCredentials)} size="phone">
      <AndroidShareGuide />
    </Frame>
    <Frame label="PC・Mac" seed={seedCredentials(linkedCredentials)} size="tablet">
      <DesktopShareGuide />
    </Frame>
  </div>
);

const GallerySection = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) => (
  <section className="grid gap-6">
    <div className="sticky left-6 grid justify-self-start gap-1">
      <h2 className="font-bold text-brand-ink text-xl">{title}</h2>
      <p className="text-brand-muted text-sm">{description}</p>
    </div>
    {children}
  </section>
);

/** 共有から取り込む画面のパターン。設定の手順は表1の始まり方を行に、表2の段階を列に並べる。 */
export const IosShareGallery = ({
  deviceName,
  relinkReason,
}: {
  deviceName: IosDeviceName;
  relinkReason: ShortcutRelinkReason;
}) => {
  const frameSize: FrameSize = deviceName === "iPad" ? "tablet" : "phone";

  return (
    <div className="grid gap-16">
      <GallerySection
        description="行は始まり方（表1）、列は段階（表2）。起きない組み合わせは空けている。"
        title="共有から取り込む：設定の手順"
      >
        <SetupScreens deviceName={deviceName} frameSize={frameSize} relinkReason={relinkReason} />
      </GallerySection>
      <GallerySection
        description="表3。Androidと、PC・Macの画面は端末の切り替えに関わらず同じ。"
        title="共有から取り込む：設定の外の画面"
      >
        <OutsideScreens deviceName={deviceName} frameSize={frameSize} />
      </GallerySection>
    </div>
  );
};
