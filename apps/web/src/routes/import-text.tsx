import { CaretLeft, ClipboardText, X } from "@phosphor-icons/react";
import { IMPORT_TEXT_MAX_LENGTH, importTextRequestSchema } from "@recipestock/schemas";
import { extractFirstUrl } from "@recipestock/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ImportTextSkeleton } from "../components/loading";
import { ScreenTopBar, ScreenTopBarIconButton } from "../components/screen-top-bar";
import { PlanLink } from "../features/billing/plan-link";
import { isResolvedByUpgrade } from "../features/billing/plan-state";
import {
  createImportTextJob,
  fetchImportJob,
  getCreateImportTextJobErrorMessage,
  importJobQueryKeys,
  retryImportTextJob,
} from "../features/import-jobs";
import { ApiClientError } from "../lib/api";
import { useGoBack } from "../lib/navigation";
import { useViewer } from "../lib/viewer";

export type ImportTextSearch = {
  fromJob?: string;
};

const characterCount = new Intl.NumberFormat("ja-JP");
const maxLengthLabel = `${characterCount.format(IMPORT_TEXT_MAX_LENGTH)}文字`;

export const ImportTextRoute = ({ search = {} }: { search?: ImportTextSearch }) => {
  const retryJobId = search.fromJob;
  const retryJob = useQuery({
    queryKey: importJobQueryKeys.detail(retryJobId ?? ""),
    queryFn: () => fetchImportJob(retryJobId ?? ""),
    enabled: Boolean(retryJobId),
    retry: false,
  });

  if (retryJobId && retryJob.isPending) {
    return <ImportTextSkeleton />;
  }

  const initialText = retryJob.data?.sourceText ?? "";

  return (
    <ImportTextForm
      initialText={initialText}
      isSourceTextUnavailable={Boolean(retryJobId) && initialText === ""}
      retryJobId={retryJobId}
    />
  );
};

const ImportTextForm = ({
  initialText,
  isSourceTextUnavailable,
  retryJobId,
}: {
  initialText: string;
  isSourceTextUnavailable: boolean;
  retryJobId?: string;
}) => {
  const navigate = useNavigate();
  const goBack = useGoBack({ to: "/recipes" });
  const [text, setText] = useState(initialText);
  // 上限のエラーのうち、プランを変えれば直るものにだけプランのページへの入口を添える。
  // プランはviewerを読み終える前に送ることもあるので、描画のときに今のviewerで決める。
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const viewer = useViewer({ enabled: true });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textId = useId();
  const countId = useId();
  const trimmedText = text.trim();
  const isTooLong = trimmedText.length > IMPORT_TEXT_MAX_LENGTH;
  // URLだけのテキストからはレシピを読み取れず、AI利用回数だけが減る。URL取り込みへ案内する。
  const onlyUrl =
    trimmedText !== "" && extractFirstUrl(trimmedText) === trimmedText ? trimmedText : null;
  const canSubmit = !isSubmitting && trimmedText !== "" && !isTooLong && !onlyUrl;

  const updateText = (nextText: string) => {
    setText(nextText);
    setError(null);
  };

  const pasteText = async () => {
    if (!navigator.clipboard?.readText) {
      setError({ message: "クリップボードを読み取れませんでした。" });
      return;
    }

    try {
      updateText(await navigator.clipboard.readText());
    } catch {
      setError({ message: "クリップボードを読み取れませんでした。" });
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = importTextRequestSchema.safeParse({ text });

    if (!request.success || onlyUrl) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      if (retryJobId) {
        await retryImportTextJob({ jobId: retryJobId, text: request.data.text });
      } else {
        await createImportTextJob(request.data.text);
      }

      // 取り込み状況は一覧に出す。取り込みの画面は履歴から外し、一覧から戻っても着かないようにする。
      await navigate({ to: "/recipes", replace: true });
    } catch (submitError) {
      setError({
        message: getCreateImportTextJobErrorMessage(submitError),
        code: submitError instanceof ApiClientError ? submitError.code : undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-0 pb-10 sm:px-6 lg:px-10">
      <ScreenTopBar
        leading={
          <ScreenTopBarIconButton aria-label="戻る" onPress={goBack}>
            <CaretLeft size={21} weight="bold" />
          </ScreenTopBarIconButton>
        }
        title="テキストから取り込む"
      />

      <div className="mt-4 px-4 sm:mt-6 sm:px-0">
        <p className="text-brand-muted text-sm">
          レシピの文章を貼り付けると、AIが材料と作り方に整えて保存します
        </p>
        {isSourceTextUnavailable ? (
          <p className="mt-2 text-brand-muted text-sm">
            元のテキストを読み込めませんでした。もう一度貼り付けてください。
          </p>
        ) : null}
        <div className="mt-4 min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
          <form className="grid min-w-0 gap-4" onSubmit={submit}>
            <FieldGroup>
              <Field className="min-w-0">
                <div className="mb-1 flex min-w-0 items-center justify-between gap-3">
                  <FieldLabel htmlFor={textId}>テキスト</FieldLabel>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      aria-label="ペースト"
                      disabled={isSubmitting}
                      size="sm"
                      type="button"
                      variant="secondary"
                      onClick={pasteText}
                    >
                      <ClipboardText data-icon="inline-start" weight="bold" />
                      <span>ペースト</span>
                    </Button>
                    <Button
                      aria-label="クリア"
                      disabled={isSubmitting || text.length === 0}
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => updateText("")}
                    >
                      <X data-icon="inline-start" weight="bold" />
                      <span>クリア</span>
                    </Button>
                  </div>
                </div>
                <Textarea
                  aria-describedby={countId}
                  aria-invalid={isTooLong || undefined}
                  className="min-h-48"
                  id={textId}
                  placeholder="材料や作り方が書かれた文章"
                  value={text}
                  onChange={(event) => updateText(event.target.value)}
                />
                <p
                  className={cn(
                    "text-right text-xs",
                    isTooLong ? "text-brand-danger" : "text-brand-muted",
                  )}
                  id={countId}
                >
                  {`${characterCount.format(trimmedText.length)} / ${maxLengthLabel}`}
                </p>
              </Field>
            </FieldGroup>
            {isTooLong ? (
              <p className="text-brand-danger text-sm">{`${maxLengthLabel}以内にしてください。`}</p>
            ) : null}
            {onlyUrl ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-brand-paper-muted p-3">
                <p className="text-brand-muted text-sm">URLだけのときは、URLから取り込めます。</p>
                {/* 取り込み方法の切り替えなので、テキストの画面は履歴に残さない。 */}
                <Link
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }), "no-underline")}
                  replace
                  search={{ url: onlyUrl }}
                  to="/import/url"
                >
                  URLから取り込む
                </Link>
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button disabled={!canSubmit} type="submit">
                取り込む
              </Button>
            </div>
          </form>
          {error ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
              <p className="break-words text-brand-danger text-sm" role="alert">
                {error.message}
              </p>
              {isResolvedByUpgrade(error.code, viewer.data?.plan) ? <PlanLink /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};
