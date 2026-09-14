export const importJobQueryKeys = {
  recent: () => ["importJobs", "recent"] as const,
  detail: (jobId: string) => ["importJobs", "detail", jobId] as const,
};
