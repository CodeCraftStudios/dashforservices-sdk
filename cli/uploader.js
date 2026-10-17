/**
 * Parallel uploader. Each file PUTs to its presigned URL; the public-read ACL
 * and immutable Cache-Control are BAKED INTO the signature, so both headers
 * must be echoed on the PUT or the signature check fails. Bodies are Buffers
 * (signed-URL PUTs need a Content-Length, not a chunked stream).
 */

import fs from "node:fs";

const DEFAULT_CONCURRENCY = 8;

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function uploadAll({ api, entries, needsUpload, concurrency = DEFAULT_CONCURRENCY }) {
  const bySha = new Map();
  for (const e of entries) {
    if (!bySha.has(e.sha256)) bySha.set(e.sha256, e);
  }

  let uploadedBytes = 0;
  let done = 0;
  let cursor = 0;
  const failures = [];

  const progress = () => {
    process.stdout.write(
      `\r    ${done}/${needsUpload.length} files · ${formatBytes(uploadedBytes)}   `,
    );
  };

  async function worker() {
    while (cursor < needsUpload.length) {
      const i = cursor++;
      const item = needsUpload[i];
      const entry = bySha.get(item.sha256);
      if (!entry) {
        failures.push({ sha256: item.sha256, error: "source file not found" });
        done++;
        progress();
        continue;
      }
      try {
        const body = fs.readFileSync(entry.absolute);
        const res = await fetch(item.upload_url, {
          method: "PUT",
          headers: {
            "Content-Type": entry.content_type || "application/octet-stream",
            "x-amz-acl": "public-read",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
          body,
        });
        if (!res.ok) throw new Error(`PUT ${res.status}`);
        await api.confirmUpload(item.sha256);
        uploadedBytes += entry.size;
      } catch (err) {
        failures.push({ sha256: item.sha256, path: entry.path, error: err.message });
      }
      done++;
      progress();
    }
  }

  progress();
  const workers = Array.from(
    { length: Math.min(concurrency, needsUpload.length) },
    () => worker(),
  );
  await Promise.all(workers);
  process.stdout.write("\n");

  return { uploadedBytes, failures };
}
