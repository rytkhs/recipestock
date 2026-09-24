import { Check, Plus, Tag } from "@phosphor-icons/react";
import {
  type GetRecipeResponse,
  MAX_RECIPE_TAGS,
  MAX_TAG_NAME_LENGTH,
  type RecipeTag,
} from "@recipestock/schemas";
import { countTagNameLength, normalizeTagName } from "@recipestock/shared";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getRecipe, invalidateRecipeLists, recipesQueryKeys } from "../recipes";
import { listTags, RECIPE_TAGS_SAVE_TIMEOUT_MS, replaceRecipeTags } from "./api";
import { tagsQueryKeys } from "./query-keys";
import { STARTER_TAG_NAMES } from "./starter-tags";
import { tagChipClass } from "./tag-chip";

type TagCandidate = {
  id: string;
  name: string;
  recipeCount: number | null;
};

// 作ったばかりでまだidのないタグ。保存が返ったらAPIのidに置き換わる。
const pendingTagIdPrefix = "pending:";

export const isPendingTagId = (tagId: string) => tagId.startsWith(pendingTagIdPrefix);

const tagKey = (name: string) => normalizeTagName(name)?.normalizedName ?? "";

const recipeTagsMutationKey = (recipeId: string) => ["recipe-tags", recipeId] as const;

const tagSaveErrorToastId = (recipeId: string) => `recipe-tags-save-error:${recipeId}`;

// 組を丸ごと送るので、送り直しても結果は変わらない。届かなかった要求とサーバー側の失敗だけ送り直す。
const MAX_TAG_SAVE_RETRIES = 2;

const isRetryableTagSaveError = (error: unknown) =>
  error instanceof ApiClientError ? error.status >= 500 : true;

const hasSameTags = (left: readonly RecipeTag[], right: readonly RecipeTag[]) => {
  const leftKeys = new Set(left.map((tag) => tagKey(tag.name)));
  const rightKeys = new Set(right.map((tag) => tagKey(tag.name)));

  return leftKeys.size === rightKeys.size && [...rightKeys].every((key) => leftKeys.has(key));
};

// 保存中は最後に押した組を出す。詳細のキャッシュには保存の結果だけを書くので、
// 保存の途中で届いた取得が、付けたばかりのタグを消したり次に送る組の元になったりしない。
export const useDisplayedRecipeTags = (recipeId: string, savedTags: readonly RecipeTag[]) => {
  const pendingTags = useMutationState({
    filters: { mutationKey: recipeTagsMutationKey(recipeId), status: "pending" },
    select: (mutation) => mutation.state.variables as RecipeTag[],
  });

  return pendingTags.at(-1) ?? savedTags;
};

const candidateRowClass =
  "flex min-h-11 w-full items-center gap-3 rounded-[12px] px-2 text-left text-brand-ink text-sm outline-none transition-colors hover:bg-brand-paper-muted focus-visible:bg-brand-paper-muted disabled:opacity-50";

export const RecipeTagSheet = ({
  onOpenChange,
  open,
  recipeId,
  recipeTitle,
  tags,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  recipeId: string;
  recipeTitle: string;
  tags: readonly RecipeTag[];
}) => {
  const queryClient = useQueryClient();
  const inputId = useId();
  const [input, setInput] = useState("");
  const vocabulary = useQuery({
    queryKey: tagsQueryKeys.all(),
    queryFn: listTags,
    enabled: open,
  });

  const detailQueryKey = recipesQueryKeys.detail(recipeId);
  // 後に押した組が残っていれば、その組がこの組の変更も含めて送り直すので、途中の結果は当てない。
  const isLastTagSave = () =>
    queryClient.isMutating({ mutationKey: recipeTagsMutationKey(recipeId) }) === 1;

  const setDetailTags = (nextTags: RecipeTag[]) => {
    queryClient.setQueryData<GetRecipeResponse["recipe"]>(detailQueryKey, (current) =>
      current && !current.locked ? { ...current, tags: nextTags } : current,
    );
  };

  // 押すたびに組を丸ごと送る。同じRecipeの要求は順に送り、後から押した組が最後に届くようにする。
  const mutation = useMutation({
    mutationKey: recipeTagsMutationKey(recipeId),
    scope: { id: `recipe-tags:${recipeId}` },
    mutationFn: (nextTags: RecipeTag[]) =>
      replaceRecipeTags(
        recipeId,
        nextTags.map((tag) => tag.name),
      ),
    retry: (failureCount, error) =>
      failureCount < MAX_TAG_SAVE_RETRIES && isRetryableTagSaveError(error),
    onSuccess: async (savedTags) => {
      if (!isLastTagSave()) {
        return;
      }

      // 保存の途中で始まった取得は、保存より前の状態を読んでいることがあるので当てさせない。
      await queryClient.cancelQueries({ queryKey: detailQueryKey });
      setDetailTags(savedTags);
    },
    onError: async (error, attemptedTags) => {
      if (!isLastTagSave()) {
        return;
      }

      // 応答が届かなかっただけで、保存は済んでいることがある。読み直した組が押した組と同じなら失敗にしない。
      await queryClient.cancelQueries({ queryKey: detailQueryKey });
      const recipe = await queryClient
        .fetchQuery({
          queryKey: detailQueryKey,
          queryFn: () =>
            getRecipe(recipeId, { signal: AbortSignal.timeout(RECIPE_TAGS_SAVE_TIMEOUT_MS) }),
          staleTime: 0,
          retry: false,
        })
        .catch(() => undefined);

      // 読み直しの間に押された組があれば、その組の保存に任せる。
      if (!isLastTagSave()) {
        return;
      }

      if (!recipe || recipe.locked || !hasSameTags(recipe.tags, attemptedTags)) {
        showSaveError(attemptedTags, isRetryableTagSaveError(error));
      }
    },
    onSettled: () => {
      if (!isLastTagSave()) {
        return;
      }

      // 件数とタグの付いた一覧が変わるので取り直させる。取り直しを待つと、次に押した組の送信が遅れる。
      void queryClient.invalidateQueries({ queryKey: tagsQueryKeys.all() });
      void invalidateRecipeLists(queryClient);
    },
  });

  // 新しく押した組のほうが後の意図なので、失敗した組を送り直す知らせは消す。残すと古い組で上書きできてしまう。
  const saveTags = (nextTags: RecipeTag[]) => {
    toast.dismiss(tagSaveErrorToastId(recipeId));
    mutation.mutate(nextTags);
  };

  // 失敗が分かるのはシートを閉じた後や一覧へ戻った後のこともあるので、画面を移っても残るトーストで知らせる。
  // 付けたつもりのタグが画面から消えたのを見落とさないよう、閉じるまで出しておく。
  // 送り直しは画面を離れた後でも押した組をそのまま送る。送り直しても通らない失敗には出さない。
  const showSaveError = (attemptedTags: RecipeTag[], canRetry: boolean) => {
    toast.error("タグを保存できませんでした", {
      id: tagSaveErrorToastId(recipeId),
      description: recipeTitle,
      duration: Number.POSITIVE_INFINITY,
      classNames: { description: "line-clamp-1" },
      action: canRetry ? { label: "もう一度", onClick: () => saveTags(attemptedTags) } : undefined,
      cancel: { label: "閉じる", onClick: () => undefined },
    });
  };

  const normalizedInput = normalizeTagName(input);
  const selectedKeys = new Set(tags.map((tag) => tagKey(tag.name)));
  const isLimitReached = tags.length >= MAX_RECIPE_TAGS;
  const vocabularyTags = vocabulary.data ?? [];
  // 付けたばかりで語彙の取得に間に合っていないタグも候補に並べ、外せるようにする。
  const allCandidates: TagCandidate[] = [
    ...vocabularyTags,
    ...tags
      .filter(
        (tag) => !vocabularyTags.some((candidate) => tagKey(candidate.name) === tagKey(tag.name)),
      )
      .map((tag) => ({ ...tag, recipeCount: null })),
  ];
  const candidates = normalizedInput
    ? allCandidates.filter((candidate) =>
        tagKey(candidate.name).includes(normalizedInput.normalizedName),
      )
    : allCandidates;
  const exactCandidate = normalizedInput
    ? allCandidates.find((candidate) => tagKey(candidate.name) === normalizedInput.normalizedName)
    : undefined;
  const isInputTooLong = normalizedInput
    ? countTagNameLength(normalizedInput.name) > MAX_TAG_NAME_LENGTH
    : false;
  const newTagName =
    normalizedInput && !exactCandidate && !isInputTooLong ? normalizedInput.name : null;
  const starterNames =
    vocabulary.data?.length === 0 && tags.length === 0 && !normalizedInput ? STARTER_TAG_NAMES : [];

  const toggleTag = (candidate: TagCandidate) => {
    const key = tagKey(candidate.name);

    if (selectedKeys.has(key)) {
      saveTags(tags.filter((tag) => tagKey(tag.name) !== key));
      return;
    }

    if (!isLimitReached) {
      saveTags([...tags, { id: candidate.id, name: candidate.name }]);
    }
  };

  const addNewTag = (name: string) => {
    const normalized = normalizeTagName(name);

    if (!normalized || isLimitReached) {
      return;
    }

    saveTags([
      ...tags,
      { id: `${pendingTagIdPrefix}${normalized.normalizedName}`, name: normalized.name },
    ]);
    setInput("");
  };

  // Enterでは、同じ名前のタグがあればそれを付け、なければ作って付ける。
  const submitInput = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (exactCandidate) {
      if (!selectedKeys.has(tagKey(exactCandidate.name))) {
        toggleTag(exactCandidate);
      }
      setInput("");
      return;
    }

    if (newTagName) {
      addNewTag(newTagName);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="max-h-[85svh] gap-0 rounded-t-[20px] border-brand-line-soft bg-brand-paper"
        showCloseButton={false}
        side="bottom"
      >
        <div className="mx-auto flex max-h-[85svh] w-full max-w-lg flex-col pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="flex-row items-center justify-between gap-3 border-brand-line-soft border-b px-4 py-3">
            <div className="min-w-0">
              <SheetTitle className="font-semibold text-brand-ink">タグ</SheetTitle>
              <SheetDescription className="text-brand-muted text-xs">
                {`${tags.length} / ${MAX_RECIPE_TAGS}個`}
              </SheetDescription>
            </div>
            <SheetClose render={<Button size="sm" variant="outline" />}>完了</SheetClose>
          </SheetHeader>

          <form className="px-4 pt-3" onSubmit={submitInput}>
            <label className="sr-only" htmlFor={inputId}>
              タグを探す・作る
            </label>
            <InputGroup>
              <InputGroupAddon>
                <Tag weight="bold" />
              </InputGroupAddon>
              <InputGroupInput
                aria-invalid={isInputTooLong || undefined}
                enterKeyHint="done"
                id={inputId}
                placeholder="タグを探す・作る"
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
            </InputGroup>
            {isInputTooLong ? (
              <p className="mt-1.5 text-brand-danger text-xs">
                タグ名は{MAX_TAG_NAME_LENGTH}文字までです。
              </p>
            ) : null}
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {newTagName ? (
              <button
                className={candidateRowClass}
                disabled={isLimitReached}
                type="button"
                onClick={() => addNewTag(newTagName)}
              >
                <span className="flex size-5 items-center justify-center text-brand-orange">
                  <Plus weight="bold" />
                </span>
                <span className="min-w-0 flex-1 truncate">「{newTagName}」を作成</span>
              </button>
            ) : null}
            {candidates.length > 0 ? (
              <ul aria-label="タグの候補">
                {candidates.map((candidate) => {
                  const isSelected = selectedKeys.has(tagKey(candidate.name));

                  return (
                    <li key={candidate.id}>
                      <button
                        aria-pressed={isSelected}
                        className={candidateRowClass}
                        disabled={!isSelected && isLimitReached}
                        type="button"
                        onClick={() => toggleTag(candidate)}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-[6px] border [&_svg]:size-3.5",
                            isSelected
                              ? "border-brand-walnut bg-brand-walnut text-brand-paper"
                              : "border-brand-line bg-brand-paper",
                          )}
                        >
                          {isSelected ? <Check weight="bold" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                        {candidate.recipeCount !== null ? (
                          <span className="shrink-0 text-brand-muted text-xs">
                            {candidate.recipeCount}件
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {starterNames.length > 0 ? (
              <div className="px-2 pt-1 pb-2">
                <p className="text-brand-muted text-xs">よく使われるタグ</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {starterNames.map((name) => (
                    <button
                      className={tagChipClass()}
                      key={name}
                      type="button"
                      onClick={() => addNewTag(name)}
                    >
                      <Plus weight="bold" />
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {vocabulary.isError ? (
              <p className="px-2 py-2 text-brand-danger text-sm" role="alert">
                タグを読み込めませんでした。
              </p>
            ) : null}
          </div>

          {isLimitReached ? (
            <p className="px-4 pb-2 text-brand-muted text-xs">
              タグは1つのレシピに{MAX_RECIPE_TAGS}個までです。
            </p>
          ) : null}

          <SheetFooter className="border-brand-line-soft border-t px-4 py-2">
            <Link
              className={cn(
                buttonVariants({ size: "sm", variant: "ghost" }),
                "self-start no-underline",
              )}
              to="/tags"
            >
              タグを管理
            </Link>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
};
