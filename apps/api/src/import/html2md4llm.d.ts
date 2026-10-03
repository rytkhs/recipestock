declare module "html2md4llm" {
  export type Html2Md4LlmOptions = {
    outputFormat?: "markdown" | "json";
    strategy?: "list" | "article";
    unescapeHTML?: "auto" | boolean;
    removeAttributes?: boolean;
  };

  export function html2md4llm(htmlInput: string, options?: Html2Md4LlmOptions): string;

  export default html2md4llm;
}
