import { useCallback, useEffect, useMemo, useState } from "react";
import { formatIssues, type Issue, type Manifest } from "@gridwright/schema";
import {
  inferManifest, loadBlob, loadBundleFromBlobs, MemorySource,
  type BundleBlob, type DataSource,
} from "@gridwright/engine";
import { stringify } from "yaml";
import { Dashboard, injectStyles, styles } from "@gridwright/react";
import { Builder, builderStyles } from "@gridwright/builder";
import { appStyles } from "./styles.js";

/**
 * The playground: drop a manifest and its data, get a dashboard.
 *
 * Data files are streamed rather than read as text. A ten-million-row CSV is
 * about a gigabyte, and `File.text()` would need the whole thing as one string
 * before parsing could begin — which is where the tab dies. Only the manifest,
 * which is small, is read whole.
 *
 * Everything a user supplies here is untrusted: the manifest is validated
 * before anything renders, and its strings reach the DOM only as React text.
 */

type Loaded = {
  manifest: Manifest;
  source: DataSource;
  text: string;
  /** Present when the manifest was guessed rather than supplied. */
  inferred?: string[];
};

const MANIFEST_EXT = /\.(gw\.ya?ml|ya?ml|json)$/i;
const DATA_EXT = /\.(csv|tsv|txt)$/i;
/** A ceiling with a message, rather than an unexplained freeze. */
const MAX_ROWS = 20_000_000;

/**
 * A standalone build inlines the example files here, so the page needs no
 * network at all. When absent, they are fetched as normal.
 */
const embedded = (name: string): string | undefined =>
  (globalThis as { __GW_FILES__?: Record<string, string> }).__GW_FILES__?.[name];

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "build">("view");
  // A host page may have already stamped a theme; start from that rather than
  // resetting the viewer's choice the moment this mounts.
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => {
    const stamped = typeof document !== "undefined"
      ? document.documentElement.getAttribute("data-theme")
      : null;
    return stamped === "dark" || stamped === "light" ? stamped : "system";
  });
  const [dragging, setDragging] = useState(false);
  const [showManifest, setShowManifest] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    injectStyles();
    for (const [id, css] of [["gw-builder", builderStyles], ["gw-app", appStyles]] as const) {
      if (document.getElementById(id)) continue;
      const el = document.createElement("style");
      el.id = id;
      el.textContent = css;
      document.head.appendChild(el);
    }
  }, []);

  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Escape closes the manifest sheet. It covers the dashboard, so somebody who
  // opened it to look has to be able to get out the way every other dialog on
  // the web lets them.
  useEffect(() => {
    if (!showManifest) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowManifest(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showManifest]);

  const accept = useCallback(
    async (manifestText: string, data: readonly BundleBlob[], label: string) => {
      setIssues([]);
      setBusy(label);
      try {
        const result = await loadBundleFromBlobs(manifestText, data, { maxRows: MAX_ROWS });
        if (!result.ok) {
          setIssues(result.issues);
          return;
        }
        setLoaded({ manifest: result.manifest, source: result.source, text: manifestText });
      } catch (err) {
        setIssues([{ path: "(load)", message: (err as Error).message }]);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  /**
   * Builds a dashboard from data alone.
   *
   * Only the first table is used. Joining several needs declared relations,
   * and cardinality is what stops a join silently multiplying rows — that is
   * not a thing to guess on somebody's behalf.
   */
  const inferFrom = useCallback(
    async (files: readonly File[]) => {
      const [first, ...rest] = files;
      if (!first) return;
      setIssues([]);
      setBusy(`Reading ${first.name}…`);
      try {
        const table = await loadBlob(tableName(first.name), first, { maxRows: MAX_ROWS });
        const { manifest, notes } = inferManifest(table, { path: first.name });
        if (rest.length) {
          notes.push(
            `Used ${first.name}. ${rest.length} other file${rest.length === 1 ? "" : "s"} ` +
            "ignored — combining tables needs a manifest that says how they connect.",
          );
        }
        setLoaded({
          manifest,
          source: MemorySource.fromTables([table]),
          text: stringify(manifest, { lineWidth: 100 }),
          inferred: notes,
        });
      } catch (err) {
        setIssues([{ path: "(data)", message: (err as Error).message }]);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const openFiles = useCallback(
    async (list: FileList | null) => {
      const files = Array.from(list ?? []);
      if (!files.length) return;

      const manifestFile = files.find((f) => MANIFEST_EXT.test(f.name));
      if (!manifestFile) {
        // The common case for somebody new: they have a spreadsheet and have
        // never heard of a manifest. Guess one from the data rather than
        // sending them away to read the format first.
        const data = files.filter((f) => DATA_EXT.test(f.name));
        if (!data.length) {
          setIssues([{
            path: "(files)",
            message: "nothing to read — drop a .csv, or a .gw.yaml manifest with the files it names",
          }]);
          return;
        }
        await inferFrom(data);
        return;
      }
      // Only the manifest is read whole; the data files stay as streams.
      const manifestText = await manifestFile.text();
      const data: BundleBlob[] = files
        .filter((f) => f !== manifestFile && DATA_EXT.test(f.name))
        .map((f) => ({ name: f.name, blob: f }));

      const bytes = data.reduce((t, d) => t + d.blob.size, 0);
      await accept(manifestText, data, `Reading ${describeBytes(bytes)}…`);
    },
    [accept, inferFrom],
  );

  const loadExample = useCallback(
    async (manifestName: string, dataNames: readonly string[]) => {
      try {
        setBusy("Loading example…");
        const manifestText =
          embedded(manifestName) ?? (await fetch(`./${manifestName}`).then((r) => r.text()));
        const data = await Promise.all(
          dataNames.map(async (name) => {
            const inline = embedded(name);
            return {
              name,
              blob: inline !== undefined
                ? new Blob([inline])
                : await fetch(`./${name}`).then((r) => r.blob()),
            };
          }),
        );
        await accept(manifestText, data, "Loading example…");
      } catch (err) {
        setIssues([{ path: "(example)", message: (err as Error).message }]);
        setBusy(null);
      }
    },
    [accept],
  );

  const body = useMemo(() => {
    if (!loaded) return null;
    return mode === "build" ? (
      <Builder manifest={loaded.manifest} manifestText={loaded.text} source={loaded.source} />
    ) : (
      <Dashboard manifest={loaded.manifest} source={loaded.source} />
    );
  }, [loaded, mode]);

  return (
    <div className="pg-root">
      <header className="pg-head">
        <div className="pg-brand">
          <strong>Gridwright</strong>
          <span>playground</span>
        </div>
        <div className="pg-actions">
          {busy && <span className="pg-busy" role="status">{busy}</span>}
          {loaded && (
            <div className="pg-seg" role="group" aria-label="Mode">
              {(["view", "build"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? "pg-on" : ""}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                >
                  {m === "view" ? "View" : "Build"}
                </button>
              ))}
            </div>
          )}
          <select
            className="pg-select"
            aria-label="Theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as typeof theme)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <label className="pg-button">
            Open files…
            <input
              type="file"
              multiple
              accept=".yaml,.yml,.json,.csv,.tsv,.txt"
              onChange={(e) => void openFiles(e.target.files)}
            />
          </label>
          {loaded && (
            <button type="button" className="pg-button" onClick={() => setShowManifest(true)}>
              View manifest
            </button>
          )}
          {loaded && (
            <button
              type="button"
              className="pg-button"
              onClick={() => { setLoaded(null); setIssues([]); setShowManifest(false); }}
            >
              Start over
            </button>
          )}
        </div>
      </header>

      {issues.length > 0 && (
        <div className="pg-issues" role="alert">
          <strong>{issues.length} problem{issues.length === 1 ? "" : "s"} in that manifest</strong>
          {/* User content, rendered as text — never as markup. */}
          <pre>{formatIssues(issues)}</pre>
        </div>
      )}

      {loaded && showManifest && (
        <div className="pg-scrim" onClick={() => setShowManifest(false)} />
      )}
      {loaded && showManifest && (
        <div className="pg-sheet" role="dialog" aria-modal="true" aria-label="The manifest behind this dashboard">
          <header>
            <div>
              <strong>This dashboard, as a file</strong>
              <p>
                Everything above is this text. Save it as <code>dashboard.gw.yaml</code>{" "}
                beside your data and it reopens exactly as it is now.
              </p>
            </div>
            <div className="pg-sheet-actions">
              <button
                type="button"
                className="pg-button"
                onClick={() => {
                  void navigator.clipboard?.writeText(loaded.text).then(
                    () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
                    () => setCopied(false),
                  );
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" className="pg-button" onClick={() => setShowManifest(false)}>
                Close
              </button>
            </div>
          </header>
          {/* User content, rendered as text — never as markup. */}
          <textarea readOnly value={loaded.text} spellCheck={false} />
        </div>
      )}

      {loaded?.inferred && mode === "view" && (
        <div className="pg-guessed" role="status">
          <div>
            <strong>Guessed from your columns.</strong>{" "}
            {loaded.inferred.join(" ")}
          </div>
          <button type="button" className="pg-button" onClick={() => setMode("build")}>
            Change it
          </button>
        </div>
      )}

      {loaded ? (
        <main className="pg-body">{body}</main>
      ) : (
        <main
          className={`pg-drop${dragging ? " pg-dragging" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void openFiles(e.dataTransfer.files);
          }}
        >
          <div className="pg-drop-inner">
            <h1>Turn a spreadsheet into a dashboard</h1>
            <p className="pg-lede">
              Drop a CSV here. Gridwright reads the columns, works out what can be
              grouped and what can be counted, and builds you a dashboard you can
              click through — then edit, and export as a file you own.
            </p>

            <label className="pg-button pg-primary pg-cta">
              Choose a CSV
              <input
                type="file"
                multiple
                accept=".yaml,.yml,.json,.csv,.tsv,.txt"
                onChange={(e) => void openFiles(e.target.files)}
              />
            </label>
            <p className="pg-hint">
              …or drag it anywhere on this page. Nothing is uploaded — your file is
              read inside this tab and never leaves your machine.
            </p>

            <div className="pg-or"><span>or see one already built</span></div>

            <div className="pg-examples">
              <button
                type="button"
                className="pg-example"
                disabled={busy !== null}
                onClick={() => void loadExample("sales-overview.gw.yaml", ["sales.csv"])}
              >
                <strong>Sales overview</strong>
                <span>2,694 orders in one file. Revenue by month, channel and region.</span>
              </button>
              <button
                type="button"
                className="pg-example"
                disabled={busy !== null}
                onClick={() =>
                  void loadExample("orders-star.gw.yaml", ["orders.csv", "customers.csv", "products.csv"])
                }
              >
                <strong>Orders, customers and products</strong>
                <span>Three files joined together, so you can slice orders by things stored elsewhere.</span>
              </button>
              <button
                type="button"
                className="pg-example"
                disabled={busy !== null}
                onClick={() => void loadExample("chart-types.gw.yaml", ["sales.csv"])}
              >
                <strong>What each chart is for</strong>
                <span>Every panel type, laid out to show which one answers which question.</span>
              </button>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

/** A file name reduced to a legal table id: "Q3 Sales.csv" -> "q3_sales". */
function tableName(file: string): string {
  const base = file.replace(/\.[^.]+$/, "").trim().toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z_]/.test(base) && base ? base : `t_${base}`;
}

function describeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export { styles };
