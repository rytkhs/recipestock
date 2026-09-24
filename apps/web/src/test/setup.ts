import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdomに存在しないAPI。Base UIのポップアップ位置決めはFloating UIのautoUpdate経由で
// ResizeObserverを、メニューのハイライト移動はscrollIntoViewを呼ぶ。
globalThis.ResizeObserver ??= class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= vi.fn();
// トーストはスワイプで閉じられるよう、押したときにsetPointerCaptureを呼ぶ。
Element.prototype.setPointerCapture ??= vi.fn();
// 一覧の次ページ先読みが使う。jsdomには無いので、交差を通知しないstubを置く。
globalThis.IntersectionObserver ??= class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;
// 一覧のチップ列が、Webフォントの読み込み後に選んでいるチップの位置を見直す。jsdomにはフォントの読み込みが無い。
if (!("fonts" in document)) {
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
}

URL.createObjectURL = vi.fn(() => "blob:test-preview-url");
URL.revokeObjectURL = vi.fn();
window.scrollTo = vi.fn();
