export * from "./registry.js";
export * from "./format.js";
export * from "./theme.js";
export * from "./rules.js";
export { kpiPanel, type KpiProps } from "./kpi.js";
export { tablePanel, type TableProps, type TableColumn, type TableRule } from "./table.js";
export { barPanel, type BarProps } from "./bar.js";
export { linePanel, type LineProps } from "./line.js";

import { PanelRegistry } from "./registry.js";
import { kpiPanel } from "./kpi.js";
import { tablePanel } from "./table.js";
import { barPanel } from "./bar.js";
import { linePanel } from "./line.js";

/** The panel types Gridwright ships with. Consumers may register more. */
export function defaultRegistry(): PanelRegistry {
  return new PanelRegistry()
    .register(kpiPanel)
    .register(tablePanel)
    .register(barPanel)
    .register(linePanel);
}
