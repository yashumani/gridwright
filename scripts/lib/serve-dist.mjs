/**
 * The static file server the browser-evidence scripts run against.
 *
 * It exists as one module rather than three copies because the three copies
 * had the same defect: `join(root, urlPath)` puts whatever the request asks
 * for on the end of the build directory, so `/../../etc/passwd` walks out of
 * it and the server reads the file. CodeQL reports it as a path traversal and
 * is right to.
 *
 * The fix is not a check on the joined path. It is that the request never
 * reaches a path expression at all: the build directory is walked once at
 * startup and the request path is looked up in that index. A file the build
 * did not produce has no entry, so there is nothing to escape from — and a
 * later reader does not have to decide whether some `startsWith` guard is
 * airtight, because there is no guard to get wrong.
 */
import http from "node:http";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

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
 * Every file the build produced, keyed by the URL path that should serve it.
 *
 * Symlinks are followed only while they stay inside the build: a path inside
 * the directory can still name a file outside it, and a checker that reads
 * through such a link is the same defect wearing a different hat.
 */
export function indexBuild(root) {
  const base = realpathSync(resolve(root));
  const files = new Map();
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      const url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(absolute, url);
      } else if (entry.isFile()) {
        files.set(url, absolute);
      } else {
        let real;
        try {
          real = realpathSync(absolute);
        } catch {
          continue; // A link to nothing.
        }
        if (real !== base && !real.startsWith(base + sep)) continue;
        if (statSync(real).isFile()) files.set(url, real);
      }
    }
  };
  walk(base, "");
  return files;
}

/**
 * Serves a built directory, optionally under a subpath.
 *
 * With a `prefix`, the root answers 404 rather than the build. That is the
 * point of it in `verify-a11.mjs`: an asset referenced absolutely works in
 * development and breaks under a project path, and only a server that refuses
 * the root will show it.
 *
 * Anything the index does not hold is answered with the build's own
 * `index.html`, because a single-page build answers unknown paths with its
 * entry point — and because a server that distinguished "not in this build"
 * from "not on this disk" would be reporting what else is on the disk.
 */
export function serveDist({ root, port, prefix = "" }) {
  const files = indexBuild(root);
  const entry = files.get("/index.html");
  if (!entry) throw new Error(`no index.html in ${resolve(root)} — build it first`);
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
    const file = files.get(prefix ? url.slice(prefix.length) : url) ?? entry;
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
