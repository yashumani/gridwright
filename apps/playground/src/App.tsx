import { useCallback, useEffect, useMemo, useState } from "react";
import { formatIssues, type Issue, type Manifest } from "@gridwright/schema";
import { loadBundleFromBlobs, type BundleBlob, type DataSource } from "@gridwright/engine";
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

type Loaded = { manifest: Manifest; source: DataSource; text: string };

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

  const openFiles = useCallback(
    async (list: FileList | null) => {
      const files = Array.from(list ?? []);
      if (!files.length) return;

      const manifestFile = files.find((f) => MANIFEST_EXT.test(f.name));
      if (!manifestFile) {
        setIssues([{
          path: "(files)",
          message: "no manifest found — include a .gw.yaml, .yaml or .json file",
        }]);
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
    [accept],
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
            <button
              type="button"
              className="pg-button"
              onClick={() => { setLoaded(null); setIssues([]); }}
            >
              Close
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
            <h1>Drop a manifest and its data</h1>
            <p>
              A <code>.gw.yaml</code> manifest plus the CSV files it names. Nothing is uploaded —
              the data is streamed straight into this tab and never leaves it.
            </p>
            <div className="pg-examples">
              <button
                type="button"
                className="pg-button pg-primary"
                disabled={busy !== null}
                onClick={() => void loadExample("sales-overview.gw.yaml", ["sales.csv"])}
              >
                Load flat example
              </button>
              <button
                type="button"
                className="pg-button"
                disabled={busy !== null}
                onClick={() =>
                  void loadExample("orders-star.gw.yaml", ["orders.csv", "customers.csv", "products.csv"])
                }
              >
                Load star schema
              </button>
            </div>
            <p className="pg-hint">
              The star schema joins a fact table to two dimension tables.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}

function describeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export { styles };
