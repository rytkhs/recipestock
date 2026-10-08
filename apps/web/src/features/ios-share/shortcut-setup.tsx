import { ArrowSquareOut, Check, Copy, Export, WarningCircle } from "@phosphor-icons/react";
import { type ShortcutCredential } from "@recipestock/schemas";
import { type ReactNode, useId } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SectionHeader } from "../../components/section-header";
import { type IosDeviceName } from "../../pwa/platform";
import { SettingsNotice } from "../settings/settings-page";
import { type ShortcutRelinkReason } from "./api";
import {
  SendPermissionIllustration,
  ShareSheetIllustration,
  ShortcutQuestionIllustration,
} from "./setup-illustrations";
import { ShareFlow } from "./share-flow";
import { guideTextClass, ShareIntro } from "./share-guide";
import { ShortcutTroubleshooting } from "./troubleshooting";
import { type ShortcutSetupState } from "./use-shortcut-setup";

type StepStatus = "todo" | "active" | "done";

const stepNumberClass: Record<StepStatus, string> = {
  todo: "border-[1.5px] border-brand-line bg-brand-paper text-brand-muted",
  active: "bg-brand-sage text-white",
  done: "bg-brand-sage-soft text-brand-sage-dark",
};

const stepStatusLabel: Record<StepStatus, string> = {
  todo: "",
  active: "（いまの手順）",
  done: "（済み）",
};

const SetupStep = ({
  children,
  isLast = false,
  number,
  status,
  title,
  trailing,
}: {
  children?: ReactNode;
  isLast?: boolean;
  number: number;
  status: StepStatus;
  title: string;
  trailing?: ReactNode;
}) => (
  <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3.5">
    <div aria-hidden="true" className="flex flex-col items-center">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full font-bold text-sm",
          stepNumberClass[status],
        )}
      >
        {status === "done" ? <Check size={16} weight="bold" /> : number}
      </span>
      {isLast ? null : <span className="my-1.5 w-0.5 flex-1 bg-brand-line-soft" />}
    </div>
    <div className={cn("grid min-w-0 content-start gap-3 pt-1", isLast ? "pb-0" : "pb-7")}>
      <div className="flex min-h-6 items-center gap-2">
        <h3 className="min-w-0 flex-1 font-bold text-base text-brand-ink leading-6">
          {title}
          <span className="sr-only">{stepStatusLabel[status]}</span>
        </h3>
        {trailing}
      </div>
      {children}
    </div>
  </li>
);

const primaryActionClass = "h-11 w-full text-base";

// `unusable_credential`には、解除したキーのほか、どのアカウントのものでもないキーも入る。解除したとは言い切らない。
const relinkNotice = (reason: ShortcutRelinkReason, deviceName: IosDeviceName) =>
  ({
    missing_credential: {
      title: "ショートカットにキーが入っていません",
      body: `この${deviceName}のショートカットに、連携キーが入っていないか、別のものが入っています。キーをコピーし直して、ショートカットを入れ直してください。`,
    },
    unusable_credential: {
      title: "ショートカットのキーが使えません",
      body: `この${deviceName}のショートカットに入っているキーは、解除されたなどで使えなくなっています。キーをコピーし直して、ショートカットを入れ直してください。`,
    },
    malformed_request: {
      title: "ショートカットを入れ直してください",
      body: `この${deviceName}のショートカットが、いまのKitchenCatと合わなくなっています。キーをコピーし直して、ショートカットを入れ直してください。`,
    },
  })[reason];

// 追加したあとはショートカットAppに残る。戻らないと、③で送信の確認を見ないまま、初めての共有で聞かれる。
const shortcutStepText = "キーを貼って追加したら、この画面に戻ります。";
// 同じ名前のショートカットがあると、iOSはキーを聞いたあとで置き換えるかを聞く。両方とも残すと、古いキーのものと2つ並ぶ。
const replaceShortcutText = "同じ名前があると聞かれたら、置き換えます。";

const KeyStep = ({
  resumableCredential,
  setup,
}: {
  resumableCredential: ShortcutCredential | null;
  setup: ShortcutSetupState;
}) => {
  const keyInputId = useId();
  const { key } = setup;
  const isIssuing = key.status === "issuing";
  const issueError =
    key.status === "none" && key.hasIssueError ? (
      <p className="text-brand-danger text-sm" role="alert">
        連携キーを発行できませんでした。時間をおいて再度お試しください。
      </p>
    ) : null;

  if (key.status === "issued" && !key.isCopied) {
    return (
      <SetupStep number={1} status="done" title="キーを発行しました">
        <p className="text-brand-danger text-sm" role="alert">
          コピーできませんでした。下のキーを選んでコピーしてください。
        </p>
        <label className="sr-only" htmlFor={keyInputId}>
          連携キー
        </label>
        <Input className="w-full min-w-0" id={keyInputId} readOnly value={key.token} />
      </SetupStep>
    );
  }

  if (key.status === "issued") {
    return (
      <SetupStep
        number={1}
        status="done"
        title="キーをコピーしました"
        trailing={
          <Button size="sm" variant="ghost" onClick={() => void setup.copyKeyAgain()}>
            もう一度コピー
          </Button>
        }
      >
        {key.isCopiedAgain ? (
          <p className="text-brand-sage-dark text-sm" role="status">
            もう一度コピーしました。
          </p>
        ) : null}
      </SetupStep>
    );
  }

  // 発行したあと、この画面を開き直した。平文はもう無く、どのキーを貼ったかは利用者にも分からない。
  // 覚えている「追加したか」で分け、まだならコピーからやり直してもらう。
  if (resumableCredential) {
    return (
      <SetupStep number={1} status="done" title="キーを発行しました">
        <p className={guideTextClass}>
          ショートカットを追加し終えていれば、③で試してください。まだなら、キーをコピーし直してください。
        </p>
        <Button
          className="justify-self-start"
          disabled={isIssuing}
          variant="secondary"
          onClick={() => void setup.issueAndCopyKey()}
        >
          キーをコピーし直す
        </Button>
        {issueError}
      </SetupStep>
    );
  }

  return (
    <SetupStep number={1} status="active" title="連携キーをコピー">
      <p className={guideTextClass}>②で貼り付けます。</p>
      <Button
        className={primaryActionClass}
        disabled={isIssuing}
        onClick={() => void setup.issueAndCopyKey()}
      >
        <Copy data-icon="inline-start" weight="bold" />
        キーをコピー
      </Button>
      {issueError}
    </SetupStep>
  );
};

const ShortcutStep = ({
  isRelink,
  mayHaveShortcut,
  setup,
}: {
  isRelink: boolean;
  mayHaveShortcut: boolean;
  setup: ShortcutSetupState;
}) => {
  const shortcutUrl = import.meta.env.VITE_IOS_SHARE_SHORTCUT_URL;
  const title = isRelink ? "ショートカットを入れ直す" : "ショートカットを追加";

  // 開いたあとに、キーを貼らずに追加したときの案内は出さない。つまずいた人には「うまくいかないとき」がある。
  if (setup.hasOpenedShortcut) {
    return (
      <SetupStep
        number={2}
        status="done"
        title={title}
        trailing={
          <a
            className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "no-underline")}
            href={shortcutUrl}
            rel="noreferrer"
            target="_blank"
          >
            もう一度開く
          </a>
        }
      />
    );
  }

  const content = (
    <>
      <ArrowSquareOut data-icon="inline-start" weight="bold" />
      ショートカットを追加
    </>
  );
  const isIssued = setup.key.status === "issued";

  return (
    <SetupStep number={2} status={isIssued ? "active" : "todo"} title={title}>
      <p className={guideTextClass}>
        {shortcutStepText}
        {mayHaveShortcut ? replaceShortcutText : null}
      </p>
      <ShortcutQuestionIllustration />
      {/* キーを持たずに追加すると、貼るものがない。キーを発行してコピーを終えるまでは押せなくしておく。
          開き直したときも、クリップボードにキーが残っているかは利用者に分からないので、コピーし直すまで押せない。 */}
      {isIssued ? (
        <a
          className={cn(buttonVariants(), primaryActionClass, "no-underline")}
          href={shortcutUrl}
          rel="noreferrer"
          target="_blank"
          onClick={setup.markShortcutOpened}
        >
          {content}
        </a>
      ) : (
        <Button className={primaryActionClass} disabled variant="secondary">
          {content}
        </Button>
      )}
    </SetupStep>
  );
};

const shareCheckBoxClass =
  "rounded-[16px] border border-brand-orange-soft bg-brand-orange-soft/25 px-4 py-3.5";

/**
 * 押したあとに出すもの。「届きませんでした」とは言わない。キーが入っていない・使えないときもrequestは届いていて、
 * 遅れて届けば完了に変わる。見つからないときも、選んでも変わらないときも、直し方はキーのコピーからやり直すことに
 * まとめる。②へは案内しない。開き直した画面では、キーをコピーし直すまで②を押せない。
 */
const ShareCheckFeedback = ({
  onRestart,
  setup,
}: {
  onRestart: () => void;
  setup: ShortcutSetupState;
}) => {
  if (setup.shareCheck === "checking") {
    return (
      <div className={cn(shareCheckBoxClass, "flex items-center gap-3.5")} role="status">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 animate-pulse rounded-full bg-brand-orange motion-reduce:animate-none"
        />
        <p className="font-bold text-brand-walnut text-sm">確かめています</p>
      </div>
    );
  }

  if (setup.shareCheck === "unconfirmed") {
    return (
      <div className={cn(shareCheckBoxClass, "grid gap-2")} role="status">
        <h4 className="font-bold text-brand-walnut text-sm">まだ確かめられていません</h4>
        <p className="text-brand-walnut text-sm leading-6">
          「表示を増やす」を押して、いちばん下まで見てください。なければ、または選んでも変わらないときは、キーのコピーからやり直してください。
        </p>
        <Button className="mt-1 justify-self-start" variant="secondary" onClick={onRestart}>
          最初からやり直す
        </Button>
      </div>
    );
  }

  if (setup.shareCheck === "failed") {
    return (
      <p className="text-brand-danger text-sm" role="alert">
        共有メニューを開けませんでした。
      </p>
    );
  }

  return null;
};

/**
 * ③は、この画面をKitchenCatへ共有して、その場で確かめる。②を開くか続きのキーがあるまでは押せない。
 * それまでに確かめても、ショートカットがないか、前のキーのままなので意味がない。押す前に共有メニューと送信の確認を図で見せておく。
 */
const ShareStep = ({ onRestart, setup }: { onRestart: () => void; setup: ShortcutSetupState }) => {
  const canOpen =
    setup.isWaitingForShare && setup.shareCheck !== "sharing" && setup.shareCheck !== "checking";

  return (
    <SetupStep
      isLast
      number={3}
      status={setup.isWaitingForShare ? "active" : "todo"}
      title="試しに共有する"
    >
      <p className={guideTextClass}>
        「表示を増やす」を押して、いちばん下の「KitchenCatで取り込む」を選びます。
      </p>
      <ShareSheetIllustration />
      {/* 選択肢が2つ（許可）のときと3つ（1度だけ許可・常に許可）のときがあり、出し分けは分かっていない。 */}
      <p className={guideTextClass}>送信してよいか聞かれたら、「許可」か「常に許可」を選びます。</p>
      <SendPermissionIllustration host={window.location.host} />
      {/* 押すとすること（共有メニューを開く）を書く。「共有する」だと、人に送るものと読める。 */}
      <Button
        className={primaryActionClass}
        disabled={!canOpen}
        variant={setup.isWaitingForShare ? "default" : "secondary"}
        onClick={setup.openShareSheet}
      >
        <Export data-icon="inline-start" weight="bold" />
        共有メニューを開く
      </Button>
      <ShareCheckFeedback setup={setup} onRestart={onRestart} />
    </SetupStep>
  );
};

/**
 * 連携の設定を、アプリの外で起きることまで含めて順に見せる。ショートカットAppで追加したあと、
 * ここへ戻らずにほかのアプリから共有する人もいるので、③の共有メニューと送信の確認は②を押す前から見せておく。
 * 何を出すかは、始まり方で決まった値（表1）と手順の段階（表2）だけから決める（docs/shortcut/ios-share.md）。
 */
export const ShortcutSetup = ({
  deviceName,
  mayHaveShortcut,
  onCancel,
  onRestart,
  relinkReason,
  resumableCredential,
  setup,
  showsIntro,
}: {
  deviceName: IosDeviceName;
  mayHaveShortcut: boolean;
  onCancel?: () => void;
  onRestart: () => void;
  relinkReason?: ShortcutRelinkReason;
  resumableCredential: ShortcutCredential | null;
  setup: ShortcutSetupState;
  showsIntro: boolean;
}) => {
  const headingId = useId();
  const notice = relinkReason ? relinkNotice(relinkReason, deviceName) : null;

  return (
    <div className="grid gap-10">
      {notice ? (
        <SettingsNotice
          icon={
            <WarningCircle
              aria-hidden="true"
              className="shrink-0 text-brand-orange-dark"
              size={18}
              weight="fill"
            />
          }
          title={notice.title}
          tone="warning"
        >
          {notice.body}
        </SettingsNotice>
      ) : null}

      {/* 連携するまで残す。発行した直後に上が消えると、押したところへ次のボタンが来てしまう。 */}
      {showsIntro ? (
        <ShareIntro>
          <p className="text-brand-walnut text-sm leading-6">
            InstagramやYouTube、Safariから送れます。設定は1分ほどです。
          </p>
          <ShareFlow before="見つける" />
        </ShareIntro>
      ) : null}

      <section aria-labelledby={headingId}>
        <SectionHeader id={headingId} title={`この${deviceName}で設定する`} />
        <ol className="mt-4">
          <KeyStep resumableCredential={resumableCredential} setup={setup} />
          <ShortcutStep
            isRelink={relinkReason !== undefined}
            mayHaveShortcut={mayHaveShortcut}
            setup={setup}
          />
          <ShareStep setup={setup} onRestart={onRestart} />
        </ol>
      </section>

      <ShortcutTroubleshooting deviceName={deviceName} onRestart={onRestart} />

      {onCancel ? (
        <Button className="justify-self-center" variant="ghost" onClick={onCancel}>
          やめる
        </Button>
      ) : null}
    </div>
  );
};
