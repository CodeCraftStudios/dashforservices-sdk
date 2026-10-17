/**
 * `npx dashforservices images`, cut the responsive ladder for public/ and stop.
 *
 * The same work `dashforservices build` does before compiling, on its own. Two uses:
 *
 *   1. `predev`, so `next dev` renders the same srcsets production will.
 *      Without it, dev serves originals and the responsive behaviour is first
 *      seen on the live site.
 *   2. Regenerating after dropping a new image in, without a full deploy.
 *
 * Needs NO API key, this is local encoding, not an upload, so it works in a
 * fresh clone and in CI.
 */

import { generateImageVariants } from "./images.js";
import { formatBytes } from "./uploader.js";

const step = (label, detail = "") =>
  console.log(`\n▸ ${label}${detail ? `  ${detail}` : ""}`);
const success = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);

export async function runImages(args = []) {
  const noLqip = args.includes("--no-lqip");
  const quality = readNumber(args, "--quality", 80);

  step("Image variants", "320/640/1024/1920 WebP" + (noLqip ? "" : " + LQIP"));
  const res = await report(
    generateImageVariants({
      cwd: process.cwd(),
      publicDir: "public",
      quality,
      lqip: !noLqip,
    }),
  );
  return res;
}

/**
 * Print the outcome. Shared with `dashforservices build`, and it SWALLOWS FAILURES on
 * purpose: variants are an optimisation layered onto a build that worked
 * without them, so a broken source or a missing sharp costs the srcset and
 * never the deploy.
 */
export async function report(promise) {
  let res;
  try {
    res = await promise;
  } catch (e) {
    warn(`Image variants skipped: ${e.message}`);
    warn("The site still builds, images serve at their original size.");
    return null;
  }

  if (res.skipped) {
    warn(`Image variants skipped: ${res.reason}`);
    return res;
  }

  success(
    `${res.images} images · ${res.generated} generated · ${res.cached} cached` +
      (res.pruned ? ` · ${res.pruned} pruned` : "") +
      ` · ${formatBytes(res.bytes)} of cuts`,
  );
  if (!res.modulePath) {
    warn("Could not write the manifest into node_modules/dashforservices-sdk , ");
    warn("images will render at their original size until that is writable.");
  }
  if (res.failures && res.failures.length) {
    warn(`${res.failures.length} image(s) could not be processed:`);
    for (const f of res.failures.slice(0, 10)) warn(`    ${f.key}, ${f.error}`);
  }
  return res;
}

function readNumber(args, flag, fallback) {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}
