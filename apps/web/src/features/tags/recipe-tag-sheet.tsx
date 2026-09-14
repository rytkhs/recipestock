import { Check, Plus, Tag } from "@phosphor-icons/react";
import {
  type GetRecipeResponse,
  MAX_RECIPE_TAGS,
  MAX_TAG_NAME_LENGTH,
  type RecipeTag,
} from "@recipestock/schemas";
import { countTagNameLength, normalizeTagName } from "@recipestock/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
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
import { cn } from "@/lib/utils";
import { invalidateRecipeLists, recipesQueryKeys } from "../recipes";
import { listTags, replaceRecipeTags } from "./api";
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

const candidateRowClass =
  "flex min-h-11 w-full items-center gap-3 rounded-[12px] px-2 text-left text-brand-ink text-sm outline-none transition-colors hover:bg-brand-paper-muted focus-visible:bg-brand-paper-muted disabled:opacity-50";

export const RecipeTagSheet = ({
  onOpenChange,
  open,
  recipeId,
  tags,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  recipeId: string;
  tags: readonly RecipeTag[];
}) => {
  const queryClient = useQueryClient();
  const inputId = useId();
  const [input, setInput] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const vocabulary = useQuery({
    queryKey: tagsQueryKeys.all(),
    queryFn: listTags,
    enabled: open,
  });

  const setDetailTags = (nextTags: RecipeTag[]) => {
    queryClient.setQueryData<GetRecipeResponse["recipe"]>(
      recipesQueryKeys.detail(recipeId),
      (current) => (current && !current.locked ? { ...current, tags: nextTags } : current),
    );
  };

  // 押すたびに組を丸ごと送る。同じRecipeの要求は順に送り、後から押した組が最後に届くようにする。
  const mutation = useMutation({
    mutationKey: recipeTagsMutationKey(recipeId),
    scope: { id: `recipe-tags:${recipeId}` },
    mutationFn: (names: string[]) => replaceRecipeTags(recipeId, names),
    onSuccess: (savedTags) => {
      // 後に押した分が残っていれば、その結果で置き換わるので途中の結果は当てない。
      if (queryClient.isMutating({ mutationKey: recipeTagsMutationKey(recipeId) }) > 1) {
        return;
      }

      setDetailTags(savedTags);
    },
    onError: async () => {
      setSaveError("タグを保存できませんでした。");
      await queryClient.invalidateQueries({ queryKey: recipesQueryKeys.detail(recipeId) });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tagsQueryKeys.all() }),
        invalidateRecipeLists(queryClient),
      ]);
    },
  });

  const saveTags = (nextTags: RecipeTag[]) => {
    setSaveError(null);
    setDetailTags(nextTags);
    mutation.mutate(nextTags.map((tag) => tag.name));
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

          {isLimitReached || saveError ? (
            <div className="px-4 pb-2">
              {isLimitReached ? (
                <p className="text-brand-muted text-xs">
                  タグは1つのレシピに{MAX_RECIPE_TAGS}個までです。
                </p>
              ) : null}
              {saveError ? (
                <p className="text-brand-danger text-sm" role="alert">
                  {saveError}
                </p>
              ) : null}
            </div>
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
