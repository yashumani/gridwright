/**
 * The static file server the browser-evidence scripts run against.
 *
 * It exists as one module rather than three copies because the three copies
 * had the same defect: `join(root, urlPath)` puts whatever the request asks
 * for on the end of the build directory, so `/../../etc/passwd` walks out of
 * it and the server reads the file. CodeQL reports it as a path traversal and
 * is right to. Everything served here is a build artifact and the socket is on
 * loopback, but a repository should not contain a server that reads whatever
 * it is asked for, and the guard costs one comparison.
 *
 * `fileUnder` is the guard, and is exported so it can be tested without a
 * socket.
 */
import http from "node:http";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

/** Content types across all three scripts; a missing one would serve a build asset as a download. */
export const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".csv": "text/csv",
  ".yaml": "text/yaml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * Resolves a decoded URL path to a readable file inside `root`, or `undefined`.
 *
 * `undefined` covers every way the request does not name a file in the build:
 * it escaped the directory, it does not exist, it is a directory, or it is a
 * symlink out. The caller treats all of those the same way — serve
 * `index.html` — because a single-page build answers unknown paths with its
 * own entry point, and because a checker that distinguishes them would be
 * telling a caller which files exist outside the directory it serves.
 */
export function fileUnder(root, urlPath) {
  const base = resolve(root);
  const candidate = resolve(base, urlPath.replace(/^\/+/, ""));
  if (candidate !== base && !candidate.startsWith(base + sep)) return undefined;
  if (!existsSync(candidate) || statSync(candidate).isDirectory()) return undefined;
  // Containment of the path is not containment of the file: a symlink inside
  // the build can still point outside it.
  const real = realpathSync(candidate);
  const realBase = realpathSync(base);
  if (real !== realBase && !real.startsWith(realBase + sep)) return undefined;
  return real;
}

/**
 * Serves a built directory, optionally under a subpath.
 *
 * With a `prefix`, the root answers 404 rather than the build. That is the
 * point of it in `verify-a11.mjs`: an asset referenced absolutely works in
 * development and breaks under a project path, and only a server that refuses
 * the root will show it.
 */
export function serveDist({ root, port, prefix = "" }) {
  const base = resolve(root);
  const index = resolve(base, "index.html");
  const server = http.createServer((req, res) => {
    let url;
    try {
      url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad request — the path is not valid percent-encoding");
      return;
    }
    if (prefix && !url.startsWith(prefix)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`not found — this build is hosted under ${prefix}`);
      return;
    }
    const file = fileUnder(base, prefix ? url.slice(prefix.length) || "/" : url) ?? index;
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
