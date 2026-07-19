import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerPushServiceWorker } from "./features/push-notifications/browser";
import { AppRouter } from "./routes/router";
import "./styles.css";

const queryClient = new QueryClient();
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found.");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void registerPushServiceWorker().catch((error: unknown) => {
      console.error("Service Worker registration failed.", error);
    });
  });
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  </StrictMode>,
);
