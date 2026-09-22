import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isNotFoundError } from "./lib/api";
import { initMonitoring } from "./lib/monitoring";
import { registerAppServiceWorker } from "./pwa/browser";
import { AppRouter } from "./routes/router";
import "./styles.css";

// 見つからないものは読み直しても見つからないので、待たせずに結果を出す。回数はTanStack Queryの既定と同じ。
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !isNotFoundError(error) && failureCount < 3,
    },
  },
});
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found.");
}

// 描画より前に初期化し、最初の描画で起きた例外から送れるようにする。
const rootOptions = initMonitoring();

const renderApp = () => {
  createRoot(rootElement, rootOptions).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppRouter />
      </QueryClientProvider>
    </StrictMode>,
  );
};

// `pnpm dev:mock`(vite --mode mock)のときだけAPIをMSWに差し替える。
// DEVはビルド時にfalseへ置換されるので、この分岐ごと本番バンドルから消える。
if (import.meta.env.DEV && import.meta.env.MODE === "mock") {
  // MSWのworkerもアプリの/sw.jsもscopeは"/"。両方登録すると後勝ちで奪い合うので、
  // モック時はアプリ側のService Workerを登録しない。
  void import("./mocks/start")
    .then(({ startApiMocking }) => startApiMocking())
    .then(renderApp, (error: unknown) => {
      // 実APIへ黙って切り替えると、モックを見ているつもりで本物を触ってしまう。失敗は画面に出して止める。
      console.error("[mock] Failed to start API mocking.", error);
      const message = document.createElement("pre");
      message.setAttribute(
        "style",
        "margin:16px;padding:16px;white-space:pre-wrap;font:13px/1.6 ui-monospace,monospace;background:#fdecea;color:#611a15;border-radius:8px",
      );
      message.textContent = `モックAPIを起動できませんでした。詳細はコンソールを確認してください。\n\n${
        error instanceof Error ? error.message : String(error)
      }`;
      rootElement.appendChild(message);
    });
} else {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void registerAppServiceWorker().catch((error: unknown) => {
        console.error("Service Worker registration failed.", error);
      });
    });
  }

  renderApp();
}
