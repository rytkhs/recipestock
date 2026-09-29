import { ArrowSquareOut, Check, Copy, WarningCircle } from "@phosphor-icons/react";
import { type ShortcutCredential } from "@recipestock/schemas";
import { type ReactNode, useId } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SectionHeader } from "../../components/section-header";
import { type IosDeviceName } from "../../pwa/platform";
import { SettingsNotice } from "../settings/settings-page";
import { type ShortcutRelinkReason } from "./api";
import { formatCredentialDay } from "./credential-dates";
import {
  ConnectionPermissionIllustration,
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

// `unauthorized`の原因（キーを貼っていない、使えなくなった）はショートカットの画面からは分からないので、どちらにも合う言い方にする。
const relinkNotice = (reason: ShortcutRelinkReason, deviceName: IosDeviceName) =>
  ({
    unauthorized: {
      title: "ショートカットのキーが使えません",
      body: `この${deviceName}のショートカットに、キーが入っていないか、使えなくなったキーが入っています。キーをコピーし直して、ショートカットを入れ直してください。`,
    },
    malformed_request: {
      title: "ショートカットを入れ直してください",
      body: `この${deviceName}のショートカットが、いまのRecipe Stockと合わなくなっています。キーをコピーし直して、ショートカットを入れ直してください。`,
    },
  })[reason];

const shortcutStepText =
  "ショートカットAppが開きます。キーを聞かれたら貼り付けて、「ショートカットを追加」を押してください。";
// 開き直したときは、もう追加したかどうか分からない。③で待ちながら、まだなら追加できるようにしておく。
const resumedShortcutStepText =
  "まだ追加していなければ、ショートカットAppで追加してください。キーを聞かれたら貼り付けます。";
// 同じ名前のショートカットがあると、iOSは置き換えるか追加するかを聞く。追加すると、古いキーのものと2つ並ぶ。
const replaceShortcutText = "同じ名前のショートカットがあると聞かれたら、置き換えてください。";

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

  // 発行したあと、この画面を開き直した。平文はもう無いので、貼っていなければ発行し直してもらう。
  // ほかの端末で発行したキーや何日も前のキーでも、発行した場所と日で気づいてやり直せる。
  if (resumableCredential) {
    const issuedDay = formatCredentialDay(resumableCredential.createdAt);

    return (
      <SetupStep number={1} status="done" title="キーを発行しました">
        <p className={guideTextClass}>
          {resumableCredential.name}で{issuedDay ? `${issuedDay}に` : ""}発行した、末尾{" "}
          {resumableCredential.tokenSuffix}
          のキーです。このキーをショートカットに貼っていなければ、発行し直してください。
        </p>
        <Button
          className="justify-self-start"
          disabled={isIssuing}
          variant="secondary"
          onClick={() => void setup.issueAndCopyKey()}
        >
          キーを発行し直す
        </Button>
        {issueError}
      </SetupStep>
    );
  }

  return (
    <SetupStep number={1} status="active" title="連携キーをコピー">
      <p className={guideTextClass}>
        ショートカットからあなたのレシピへ送るためのキーです。次の手順で貼り付けます。
      </p>
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
        {setup.isResumed ? resumedShortcutStepText : shortcutStepText}
        {mayHaveShortcut ? replaceShortcutText : null}
      </p>
      <ShortcutQuestionIllustration />
      {/* キーを持たずに追加すると、貼るものがない。キーを発行してコピーを終えるまでは押せなくしておく。 */}
      {isIssued || setup.isResumed ? (
        <a
          className={cn(
            buttonVariants({ variant: isIssued ? "default" : "secondary" }),
            primaryActionClass,
            "no-underline",
          )}
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

/**
 * 連携の設定を、アプリの外で起きることまで含めて順に見せる。ショートカットAppで追加したあと、
 * ここへ戻らずにSafariやInstagramへ行く人がいるので、③の中身は②を押す前から見せておく。
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
            InstagramやYouTube、Safariで見つけたレシピを、アプリを開かずにRecipe
            Stockへ送れます。設定は1分ほどです。
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
          <SetupStep
            isLast
            number={3}
            status={setup.isWaitingForShare ? "active" : "todo"}
            title="試しに共有する"
          >
            {setup.isWaitingForShare ? (
              <div
                className="flex items-center gap-3.5 rounded-[16px] border border-brand-orange-soft bg-brand-orange-soft/25 px-4 py-3.5"
                role="status"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 animate-pulse rounded-full bg-brand-orange motion-reduce:animate-none"
                />
                <div className="min-w-0">
                  <p className="font-bold text-brand-walnut text-sm">共有を待っています</p>
                  <p className="text-brand-muted text-xs leading-5">
                    届くと、ここが「連携できました」に変わります。
                  </p>
                </div>
              </div>
            ) : null}
            <p className={guideTextClass}>
              SafariでレシピのページやInstagramの投稿を開いて、共有 → いちばん下の「Recipe
              Stock」を選びます。
            </p>
            <ShareSheetIllustration />
            <p className={guideTextClass}>
              初回だけ、接続してよいか聞かれます。
              <strong className="font-bold text-brand-walnut">「常に許可」</strong>
              を選んでください。
            </p>
            <ConnectionPermissionIllustration host={window.location.host} />
            <p className="text-brand-muted text-xs leading-5">
              InstagramやYouTubeでは、アプリの共有画面で「その他」を押すと、このメニューが開きます。
            </p>
          </SetupStep>
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
