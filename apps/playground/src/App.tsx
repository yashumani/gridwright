import { useCallback, useEffect, useMemo, useState } from "react";
import { formatIssues, type Issue, type Manifest } from "@gridwright/schema";
import { loadBundle, type BundleFile, type DataSource } from "@gridwright/engine";
import { Dashboard, injectStyles, styles } from "@gridwright/react";
import { Builder, builderStyles } from "@gridwright/builder";
import { appStyles } from "./styles.js";

/**
 * The playground: drop a manifest and its data, get a dashboard.
 *
 * Everything a user supplies here is untrusted — the manifest is validated
 * before anything renders, and its strings reach the DOM only as React text,
 * never as markup.
 */

type Loaded = { manifest: Manifest; source: DataSource };

const MAX_BYTES = 40 * 1024 * 1024;
const MANIFEST_EXT = /\.(gw\.ya?ml|ya?ml|json)$/i;
const DATA_EXT = /\.(csv|tsv|txt)$/i;

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [mode, setMode] = useState<"view" | "build">("view");
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
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

  const accept = useCallback((files: BundleFile[]) => {
    const manifestFile = files.find((f) => MANIFEST_EXT.test(f.name));
    if (!manifestFile) {
      setIssues([{
        path: "(files)",
        message: "no manifest found — include a .gw.yaml, .yaml or .json file",
      }]);
      return;
    }
    const data = files.filter((f) => f !== manifestFile && DATA_EXT.test(f.name));
    const result = loadBundle(manifestFile.text, data);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    setIssues([]);
    setLoaded({ manifest: result.manifest, source: result.source });
  }, []);

  const readFiles = useCallback(
    async (list: FileList | null) => {
      if (!list?.length) return;
      const files: BundleFile[] = [];
      let total = 0;
      for (const file of Array.from(list)) {
        total += file.size;
        if (total > MAX_BYTES) {
          setIssues([{
            path: "(files)",
            message: `those files total more than ${Math.round(MAX_BYTES / 1024 / 1024)}MB`,
          }]);
          return;
        }
        files.push({ name: file.name, text: await file.text() });
      }
      accept(files);
    },
    [accept],
  );

  const loadExample = useCallback(async () => {
    try {
      const [manifest, data] = await Promise.all([
        fetch("./sales-overview.gw.yaml").then((r) => r.text()),
        fetch("./sales.csv").then((r) => r.text()),
      ]);
      accept([
        { name: "sales-overview.gw.yaml", text: manifest },
        { name: "sales.csv", text: data },
      ]);
    } catch (err) {
      setIssues([{ path: "(example)", message: (err as Error).message }]);
    }
  }, [accept]);

  const body = useMemo(() => {
    if (!loaded) return null;
    return mode === "build" ? (
      <Builder manifest={loaded.manifest} source={loaded.source} />
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
              onChange={(e) => void readFiles(e.target.files)}
            />
          </label>
          {loaded && (
            <button type="button" className="pg-button" onClick={() => { setLoaded(null); setIssues([]); }}>
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
            void readFiles(e.dataTransfer.files);
          }}
        >
          <div className="pg-drop-inner">
            <h1>Drop a manifest and its data</h1>
            <p>
              A <code>.gw.yaml</code> manifest plus the CSV files it names. Nothing is uploaded —
              everything runs in this tab.
            </p>
            <button type="button" className="pg-button pg-primary" onClick={() => void loadExample()}>
              Load the example
            </button>
          </div>
        </main>
      )}
    </div>
  );
}

export { styles };
