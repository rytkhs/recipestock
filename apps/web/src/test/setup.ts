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

URL.createObjectURL = vi.fn(() => "blob:test-preview-url");
URL.revokeObjectURL = vi.fn();
window.scrollTo = vi.fn();
