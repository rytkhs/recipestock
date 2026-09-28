import { type ImportJobSummary } from "@recipestock/schemas";

export type ImportSourceKind = "youtube" | "instagram" | "tiktok" | "x" | "web" | "text";

export type ImportSource = {
  kind: ImportSourceKind;
  label: string;
};

const platformHosts: readonly [ImportSourceKind, readonly string[]][] = [
  ["youtube", ["youtube.com", "m.youtube.com", "youtu.be"]],
  ["instagram", ["instagram.com"]],
  ["tiktok", ["tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"]],
  ["x", ["x.com", "twitter.com", "mobile.twitter.com"]],
];

const readHost = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/**
 * どこから取り込んでいるかを、アイコンの種類と短いラベルにする。
 * URLはホスト名だけにし、テキストは原文の最初の行を出す。
 */
export const describeImportSource = (
  job: Pick<ImportJobSummary, "kind" | "url" | "textPreview">,
): ImportSource => {
  if (job.kind === "text") {
    return { kind: "text", label: job.textPreview ?? "貼り付けたテキスト" };
  }

  const host = job.url ? readHost(job.url) : null;

  if (!host) {
    return { kind: "web", label: job.url ?? "URL" };
  }

  const kind = platformHosts.find(([, hosts]) => hosts.includes(host))?.[0] ?? "web";

  return { kind, label: host };
};
