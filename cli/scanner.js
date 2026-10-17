/**
 * Walks .next/static + public/ and produces the manifest the server needs.
 *
 * Only `_next/static` is safe for a CDN. `.next/server` runs on the Node
 * server and `.next/cache` is build-local.
 *
 * Each entry: { path, absolute, sha256, size, content_type }
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MIME = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
};

function mimeFor(filename) {
  return MIME[path.extname(filename).toLowerCase()] || "application/octet-stream";
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export async function scanBuild({ cwd, buildDir, publicDir }) {
  const staticDir = path.join(cwd, buildDir, "static");
  const pubDir = path.join(cwd, publicDir);

  const entries = [];

  for (const abs of walk(staticDir)) {
    const rel = path.relative(path.join(cwd, buildDir), abs).split(path.sep).join("/");
    const stat = fs.statSync(abs);
    entries.push({
      path: `_next/${rel}`,
      absolute: abs,
      sha256: await hashFile(abs),
      size: stat.size,
      content_type: mimeFor(abs),
    });
  }

  for (const abs of walk(pubDir)) {
    const rel = path.relative(pubDir, abs).split(path.sep).join("/");
    const stat = fs.statSync(abs);
    entries.push({
      path: rel,
      absolute: abs,
      sha256: await hashFile(abs),
      size: stat.size,
      content_type: mimeFor(abs),
    });
  }

  return entries;
}
