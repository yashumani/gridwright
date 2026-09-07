import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { injectStyles } from "@gridwright/react";
import { Workspace, type AnalysisSnapshot } from "@gridwright/workspace";
import snapshot from "../../../fixtures/support-ops/snapshot.json";
import { styles } from "./styles.js";

/**
 * A synthetic preview of the unified surface.
 *
 * The snapshot is precomputed by `fixtures/support-ops/build-snapshot.ts`,
 * because the workbook reader needs `node:zlib` and a browser has none. That
 * is not a shortcut around the real path — the numbers here came out of the
 * real bridge, through the real fill, and were serialised on the way. What the
 * page proves is what a reader sees, and that the answer and the report agree.
 *
 * Everything on it is synthetic. There is no network call after load, and no
 * credential reaches this bundle: it holds a JSON file and a renderer.
 */

injectStyles();

const sheet = document.createElement("style");
sheet.textContent = styles;
document.head.append(sheet);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Workspace snapshot={snapshot as unknown as AnalysisSnapshot} title="Closed cases by queue" />
  </StrictMode>,
);
