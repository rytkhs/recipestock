import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

URL.createObjectURL = vi.fn(() => "blob:test-preview-url");
URL.revokeObjectURL = vi.fn();
window.scrollTo = vi.fn();
