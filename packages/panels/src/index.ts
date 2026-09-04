export * from "./registry.js";
export * from "./format.js";
export * from "./theme.js";
export * from "./palette.js";
export * from "./rules.js";
export { kpiPanel, type KpiProps } from "./kpi.js";
export { tablePanel, type TableProps, type TableColumn, type TableRule } from "./table.js";
export { barPanel, type BarProps } from "./bar.js";
export { dotPanel, type DotProps } from "./dot.js";
export { linePanel, type LineProps } from "./line.js";
export { stackPanel, type StackProps } from "./stack.js";
export { heatmapPanel, type HeatmapProps } from "./heatmap.js";

import { PanelRegistry } from "./registry.js";
import { kpiPanel } from "./kpi.js";
import { tablePanel } from "./table.js";
import { barPanel } from "./bar.js";
import { dotPanel } from "./dot.js";
import { linePanel } from "./line.js";
import { stackPanel } from "./stack.js";
import { heatmapPanel } from "./heatmap.js";

/** The panel types Gridwright ships with. Consumers may register more. */
export function defaultRegistry(): PanelRegistry {
  return new PanelRegistry()
    .register(kpiPanel)
    .register(tablePanel)
    .register(barPanel)
    .register(dotPanel)
    .register(linePanel)
    .register(stackPanel)
    .register(heatmapPanel);
}
