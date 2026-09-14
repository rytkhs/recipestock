import { setupWorker } from "msw/browser";
import { createHandlers } from "./handlers";
import { mountScenarioPanel } from "./panel";
import { findScenario } from "./scenarios";

const SCENARIO_STORAGE_KEY = "recipestock:mock-scenario";
const DELAY_STORAGE_KEY = "recipestock:mock-delay";

const readStored = (key: string) => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStored = (key: string, value: string) => {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // プライベートウィンドウなどでsessionStorageが使えなくても、URLだけで切り替えられる。
  }
};

// TanStack Routerの画面遷移でクエリが落ちるので、一度指定されたらsessionStorageで引き継ぐ。
const resolveSelection = () => {
  const params = new URLSearchParams(window.location.search);
  const scenarioFromUrl = params.get("scenario");
  const delayFromUrl = params.get("delay");
  const scenario = findScenario(scenarioFromUrl ?? readStored(SCENARIO_STORAGE_KEY));
  const delayMs = Number(delayFromUrl ?? readStored(DELAY_STORAGE_KEY) ?? "0");

  writeStored(SCENARIO_STORAGE_KEY, scenario.id);
  writeStored(DELAY_STORAGE_KEY, String(Number.isFinite(delayMs) ? delayMs : 0));

  return { scenario, delayMs: Number.isFinite(delayMs) ? delayMs : 0 };
};

// ハンドラを差し替えるのではなくリロードする。
// TanStack Queryのキャッシュが前のシナリオのまま残ると、状態が混ざって読めなくなる。
const applySelection = ({ scenarioId, delayMs }: { scenarioId: string; delayMs: number }) => {
  writeStored(SCENARIO_STORAGE_KEY, scenarioId);
  writeStored(DELAY_STORAGE_KEY, String(delayMs));

  const url = new URL(window.location.href);
  url.searchParams.delete("scenario");
  url.searchParams.delete("delay");
  window.location.replace(url.toString());
};

export const startApiMocking = async () => {
  const { scenario, delayMs } = resolveSelection();
  const worker = setupWorker(...createHandlers(scenario.build(), { delayMs }));

  await worker.start({ onUnhandledRequest: "warn" });

  console.info(
    `[mock] scenario=${scenario.id} delay=${delayMs}ms / 切り替え: ?scenario=<id>`,
    scenario.label,
  );
  mountScenarioPanel({ scenarioId: scenario.id, delayMs, onChange: applySelection });
};
