import { scenarios } from "./scenarios";

// アプリのz-indexは最大50、右下はFAB、下部中央は取り込みの島が占めている。
// パネルは左下に、どのレイヤーよりも手前に置く。
const panelStyle = [
  "position:fixed",
  "left:12px",
  "bottom:calc(12px + env(safe-area-inset-bottom))",
  "z-index:2147483000",
  "display:flex",
  "gap:6px",
  "align-items:center",
  "padding:6px 8px",
  "border-radius:10px",
  "background:rgba(24,22,20,0.88)",
  "color:#fff",
  "font:500 11px/1.4 system-ui,sans-serif",
  "box-shadow:0 4px 16px rgba(0,0,0,0.25)",
].join(";");

const selectStyle = [
  "background:#2c2926",
  "color:#fff",
  "border:1px solid rgba(255,255,255,0.2)",
  "border-radius:6px",
  "padding:3px 4px",
  "font:inherit",
  "max-width:180px",
].join(";");

const delayOptions = [0, 300, 1000, 3000];

const createSelect = (
  options: readonly { value: string; label: string }[],
  selected: string,
  onChange: (value: string) => void,
) => {
  const select = document.createElement("select");
  select.setAttribute("style", selectStyle);

  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    element.selected = option.value === selected;
    select.appendChild(element);
  }

  select.addEventListener("change", () => {
    onChange(select.value);
  });

  return select;
};

export const mountScenarioPanel = ({
  scenarioId,
  delayMs,
  onChange,
}: {
  scenarioId: string;
  delayMs: number;
  onChange: (next: { scenarioId: string; delayMs: number }) => void;
}) => {
  const panel = document.createElement("div");
  panel.setAttribute("style", panelStyle);
  panel.dataset.mockPanel = "true";

  const badge = document.createElement("span");
  badge.textContent = "MOCK";
  badge.setAttribute("style", "letter-spacing:0.08em;opacity:0.7");

  const scenarioSelect = createSelect(
    scenarios.map((scenario) => ({ value: scenario.id, label: scenario.label })),
    scenarioId,
    (value) => {
      onChange({ scenarioId: value, delayMs });
    },
  );
  const delaySelect = createSelect(
    delayOptions.map((value) => ({ value: String(value), label: `${value}ms` })),
    String(delayMs),
    (value) => {
      onChange({ scenarioId, delayMs: Number(value) });
    },
  );

  // ここで`append`を使わないのは、@cloudflare/workers-typesのHTMLRewriter Elementが
  // グローバルのElement.appendを上書きしているため。
  panel.appendChild(badge);
  panel.appendChild(scenarioSelect);
  panel.appendChild(delaySelect);
  document.body.appendChild(panel);
};
