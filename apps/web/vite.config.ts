import { fileURLToPath } from "node:url";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";
import { validateAppShellManifest } from "./src/pwa/build-manifest";

// source mapはSentryへ上げるときだけ作り、上げたあとdistから消す。distはそのまま公開されるため。
// tokenはdeploy scriptだけが渡すので、CIや手元のbuildは上げずに通る。
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

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
        // SWはSentryへ送らないのでsource mapは要らない。既定ではbuild.sourcemapを引き継ぐが、
        // SWのbuildはSentryのpluginがsource mapを消したあとに走るので、distに残って公開される。
        sourcemap: false,
      },
    }),
    sentryVitePlugin({
      org: "tkhs",
      project: "recipestock-web",
      authToken: sentryAuthToken,
      disable: !sentryAuthToken,
      release: { name: process.env.SENTRY_RELEASE },
      sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
      telemetry: false,
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    manifest: true,
    sourcemap: sentryAuthToken ? "hidden" : false,
  },
  server: {
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    maxWorkers: 4,
    setupFiles: ["./src/test/setup.ts"],
  },
});
