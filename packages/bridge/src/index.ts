/**
 * The deterministic metadata bridge.
 *
 * Definition path only, so far: read bounded Excel configuration with cell
 * provenance (T05), and resolve explicit bindings from skeleton rows to a
 * business-data view (T07). Compiling a report definition and executing it
 * (T08, T09) are not here yet, and nothing in this package claims otherwise.
 */
export {
  ZipArchive,
  ZipError,
  DEFAULT_ZIP_LIMITS,
  type ZipLimits,
} from "./zip.js";

export {
  readWorkbook,
  parseAddress,
  XlsxError,
  DEFAULT_XLSX_LIMITS,
  type XlsxLimits,
  type Cell,
  type CellKind,
  type CellRef,
  type SheetRead,
  type WorkbookRead,
} from "./xlsx.js";

export {
  readSkeleton,
  readConfigTable,
  resolveBindings,
  type BindingOutcome,
  type BindingResolution,
  type BindingSpec,
  type BoundRow,
  type MetadataSnapshot,
  type MetricDefinition,
  type Problem,
  type ProblemCode,
  type RowBinding,
  type RowType,
  type SkeletonRow,
  type ViewColumn,
  type ViewDefinition,
} from "./bindings.js";
