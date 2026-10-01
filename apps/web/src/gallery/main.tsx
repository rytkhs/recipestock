import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Gallery } from "./gallery";
import "../styles.css";

// 画面の部品にはリンクがあるので、ルーターの中で描く。押してもこのページから移らないよう、履歴はメモリに持つ。
const router = createRouter({
  routeTree: createRootRoute({ component: Gallery }),
  history: createMemoryHistory(),
});
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
