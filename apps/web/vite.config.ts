import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";
import { validateAppShellManifest } from "./src/pwa/build-manifest";

export default defineConfig({
  envDir: "../..",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/pwa",
      filename: "sw.ts",
      injectRegister: null,
      manifest: false,
      injectManifest: {
        globPatterns: [
          "index.html",
          "manifest.webmanifest",
          "icons/icon-192.png",
          "assets/**/*.{js,css}",
        ],
        manifestTransforms: [validateAppShellManifest],
      },
    }),
  ],
  server: {
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
