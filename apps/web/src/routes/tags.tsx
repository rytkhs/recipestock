import {
  ArrowDown,
  ArrowLineUp,
  ArrowUp,
  CaretLeft,
  DotsThreeVertical,
  PencilSimple,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  MAX_TAG_NAME_LENGTH,
  type RecipeTag,
  type TagWithCount,
  tagNameConflictDetailsSchema,
} from "@recipestock/schemas";
import { countTagNameLength, normalizeTagName } from "@recipestock/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScreenTopBar, ScreenTopBarIconButton } from "../components/screen-top-bar";
import { invalidateRecipeLists, recipesQueryKeys } from "../features/recipes";
import {
  deleteTag,
  listTags,
  mergeTag,
  moveTagTo,
  renameTag,
  reorderTags,
  tagsQueryKeys,
} from "../features/tags";
import { ApiClientError } from "../lib/api";
import { useGoBack } from "../lib/navigation";

type MergeRequest = {
  source: TagWithCount;
  target: RecipeTag;
};

const tagOrderMutationKey = ["tag-order"] as const;

export const TagsRoute = () => {
  // 消したタグで絞った一覧へ戻っても、一覧がタグ一覧を読み直してそのidを外す。
  const goBack = useGoBack({ to: "/settings" });
  const queryClient = useQueryClient();
  const tagsQuery = useQuery({ queryKey: tagsQueryKeys.all(), queryFn: listTags });
  const tags = tagsQuery.data;
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [mergeRequest, setMergeRequest] = useState<MergeRequest | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TagWithCount | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // タグの名前は一覧の絞り込みと詳細にも出るので、あわせて取り直す。
  const refreshTagViews = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: tagsQueryKeys.all() }),
      invalidateRecipeLists(queryClient),
      queryClient.invalidateQueries({ queryKey: recipesQueryKeys.details() }),
    ]);

  const renameMutation = useMutation({
    mutationFn: ({ tag, name }: { tag: TagWithCount; name: string }) => renameTag(tag.id, name),
    onSuccess: async () => {
      setEditingTagId(null);
      await refreshTagViews();
    },
    onError: (error, { tag }) => {
      // 別のタグが同じ名前を使っていれば、そのタグへまとめるかを確かめる。
      if (error instanceof ApiClientError && error.code === "tag_name_conflict") {
        const details = tagNameConflictDetailsSchema.safeParse(error.details);

        if (details.success) {
          setMergeRequest({ source: tag, target: details.data.tag });
          return;
        }
      }

      setActionError("タグの名前を変更できませんでした。");
    },
  });
  // 押すたびに並び全体を送る。同じ利用者の要求は順に送り、後から押した並びが最後に届くようにする。
  const reorderMutation = useMutation({
    mutationKey: tagOrderMutationKey,
    scope: { id: "tag-order" },
    mutationFn: (tagIds: string[]) => reorderTags(tagIds),
    onError: () => {
      setActionError("タグの並びを変えられませんでした。");
    },
    onSettled: async () => {
      // 後に押した分が残っていれば、その結果で置き換わるので途中では取り直さない。
      if (queryClient.isMutating({ mutationKey: tagOrderMutationKey }) > 1) {
        return;
      }

      await queryClient.invalidateQueries({ queryKey: tagsQueryKeys.all() });
    },
  });
  const mergeMutation = useMutation({
    mutationFn: ({ source, target }: MergeRequest) => mergeTag(source.id, target.id),
    onSuccess: async () => {
      setMergeRequest(null);
      setEditingTagId(null);
      await refreshTagViews();
    },
    onError: () => {
      setMergeRequest(null);
      setActionError("タグをまとめられませんでした。");
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (tag: TagWithCount) => deleteTag(tag.id),
    onSuccess: async () => {
      setDeleteTarget(null);
      await refreshTagViews();
    },
    onError: () => {
      setDeleteTarget(null);
      setActionError("タグを削除できませんでした。");
    },
  });

  const normalizedEditingName = normalizeTagName(editingName);
  const editingNameError = !normalizedEditingName
    ? "名前を入力してください。"
    : countTagNameLength(normalizedEditingName.name) > MAX_TAG_NAME_LENGTH
      ? `タグ名は${MAX_TAG_NAME_LENGTH}文字までです。`
      : null;

  const moveTag = (fromIndex: number, toIndex: number) => {
    if (!tags) {
      return;
    }

    setActionError(null);
    const nextTags = moveTagTo(tags, fromIndex, toIndex);
    queryClient.setQueryData<TagWithCount[]>(tagsQueryKeys.all(), nextTags);
    reorderMutation.mutate(nextTags.map((tag) => tag.id));
  };

  const startEditing = (tag: TagWithCount) => {
    setActionError(null);
    setEditingTagId(tag.id);
    setEditingName(tag.name);
  };

  const submitRename = (event: FormEvent<HTMLFormElement>, tag: TagWithCount) => {
    event.preventDefault();

    if (!normalizedEditingName || editingNameError) {
      return;
    }

    if (normalizedEditingName.name === tag.name) {
      setEditingTagId(null);
      return;
    }

    setActionError(null);
    renameMutation.mutate({ tag, name: normalizedEditingName.name });
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-0 pb-10 sm:px-6 lg:px-10">
      <ScreenTopBar
        leading={
          <ScreenTopBarIconButton aria-label="戻る" onPress={goBack}>
            <CaretLeft size={21} weight="bold" />
          </ScreenTopBarIconButton>
        }
        title="タグ"
      />

      <div className="mt-4 px-4 sm:mt-6 sm:px-0">
        {actionError ? (
          <div className="mb-4 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
            <p className="text-brand-danger text-sm" role="alert">
              {actionError}
            </p>
          </div>
        ) : null}
        {tagsQuery.isPending ? (
          <p className="text-brand-muted text-sm" role="status">
            タグを読み込み中
          </p>
        ) : null}
        {tagsQuery.error ? (
          <p className="text-brand-danger text-sm" role="alert">
            タグを読み込めませんでした。
          </p>
        ) : null}
        {tags?.length === 0 ? (
          <div className="mt-12 text-center">
            <p className="font-semibold text-brand-walnut text-lg">タグはまだありません</p>
            <p className="mt-2 text-brand-muted text-sm">レシピの詳細画面から付けられます。</p>
          </div>
        ) : null}
        {tags && tags.length > 0 ? (
          <ul
            aria-label="タグ"
            className="divide-y divide-brand-line-soft overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm"
          >
            {tags.map((tag, index) => (
              <li className="px-4 py-2.5" key={tag.id}>
                {editingTagId === tag.id ? (
                  <form className="grid gap-1.5" onSubmit={(event) => submitRename(event, tag)}>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        aria-invalid={Boolean(editingNameError) || undefined}
                        aria-label={`「${tag.name}」の新しい名前`}
                        autoFocus
                        className="min-w-0 flex-1"
                        enterKeyHint="done"
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setEditingTagId(null);
                          }
                        }}
                      />
                      <Button
                        disabled={renameMutation.isPending || Boolean(editingNameError)}
                        size="sm"
                        type="submit"
                      >
                        保存
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={() => setEditingTagId(null)}
                      >
                        取消
                      </Button>
                    </div>
                    {editingNameError ? (
                      <p className="text-brand-danger text-xs">{editingNameError}</p>
                    ) : null}
                  </form>
                ) : (
                  <div className="flex min-h-10 min-w-0 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-brand-ink text-sm sm:text-base">
                        {tag.name}
                      </p>
                      <p className="text-brand-muted text-xs">{tag.recipeCount}件</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`「${tag.name}」の操作メニュー`}
                        render={<Button size="icon-sm" variant="ghost" />}
                      >
                        <DotsThreeVertical weight="bold" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-36">
                        {tags.length > 1 ? (
                          <>
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                disabled={index === 0}
                                onClick={() => moveTag(index, 0)}
                              >
                                <ArrowLineUp weight="bold" />
                                <span>先頭に移動</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={index === 0}
                                onClick={() => moveTag(index, index - 1)}
                              >
                                <ArrowUp weight="bold" />
                                <span>上に移動</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={index === tags.length - 1}
                                onClick={() => moveTag(index, index + 1)}
                              >
                                <ArrowDown weight="bold" />
                                <span>下に移動</span>
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                          </>
                        ) : null}
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => startEditing(tag)}>
                            <PencilSimple weight="bold" />
                            <span>名前を変更</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => {
                              setActionError(null);
                              setDeleteTarget(tag);
                            }}
                          >
                            <Trash weight="bold" />
                            <span>削除</span>
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <AlertDialog
        open={Boolean(mergeRequest)}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setMergeRequest(null);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mergeRequest
                ? `「${mergeRequest.source.name}」を「${mergeRequest.target.name}」にまとめますか？`
                : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mergeRequest
                ? `「${mergeRequest.source.name}」が付いたレシピに「${mergeRequest.target.name}」を付け、「${mergeRequest.source.name}」は削除します。`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mergeMutation.isPending}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              disabled={mergeMutation.isPending}
              onClick={() => {
                if (mergeRequest) {
                  mergeMutation.mutate(mergeRequest);
                }
              }}
            >
              まとめる
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <WarningCircle weight="fill" />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {deleteTarget ? `「${deleteTarget.name}」を削除しますか？` : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.recipeCount > 0
                ? `付いている${deleteTarget.recipeCount}件のレシピから外れます。`
                : "付いているレシピはありません。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget);
                }
              }}
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
