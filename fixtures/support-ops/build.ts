/**
 * Regenerates `skeleton.xlsx` from `skeleton.ts`.
 *
 * The workbook is committed so a person can open it, and generated so the code
 * stays the reviewable source of truth. Run:
 *
 *   node --experimental-strip-types fixtures/support-ops/build.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeWorkbook } from "../../packages/bridge/test/support/write-xlsx.ts";
import { SHEETS } from "./skeleton.ts";

const out = fileURLToPath(new URL("./skeleton.xlsx", import.meta.url));
writeFileSync(out, writeWorkbook(SHEETS));
console.log(`wrote ${out}`);
