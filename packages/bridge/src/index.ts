/**
 * The deterministic metadata bridge.
 *
 * Definition path only, so far: read bounded Excel configuration with cell
 * provenance. Binding, validation and report-definition compilation (T07, T08)
 * are not here yet, and nothing in this package claims otherwise.
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
