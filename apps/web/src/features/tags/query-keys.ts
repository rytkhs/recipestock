const tagsQueryRoot = "tags";

export const tagsQueryKeys = {
  all: () => [tagsQueryRoot] as const,
};

export const tagsUserScopedQueryRoots = [tagsQueryRoot] as const;
