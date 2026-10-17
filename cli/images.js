/**
 * BUILD-TIME RESPONSIVE IMAGE GENERATION.
 *
 * Every raster image in public/ gets a 320/640/1024/1920 WebP ladder and a
 * tiny LQIP, written next to the build output and uploaded to the edge by the
 * same scanner that ships the rest of public/. The app reads the manifest this
 * emits and hands the ladder to <DashImage>, which is the only thing that ever
 * makes it emit a srcset.
 *
 *   WHY THIS RUNS HERE AND NOT ON THE SERVER
 *
 * The client SDK asks the API to do this (POST media/generate-variants), but
 * that endpoint only ever walks the MEDIA LIBRARY. A file committed to public/
 * is not in the library, it is copied to the CDN verbatim, so no amount of
 * server-side work will ever touch it. Platforms keep most of their art in
 * public/, which is exactly why nothing was being generated.
 *
 * Doing it locally also means no upload round-trip, no queue to wait on, and
 * no backend endpoint to ship first. The heavy work happens once per changed
 * file on the machine already running the build.
 *
 *   NEVER UPSCALE
 *
 * A width is only emitted when the source is at least that wide, plus the
 * source's own width as the top rung. Upscaling invents pixels, costs bytes,
 * and makes the largest srcset candidate a worse image than the original.
 *
 *   THE CACHE IS KEYED ON CONTENT
 *
 * `_gen/.cache.json` maps a source path to the sha256 it was generated from.
 * Re-running with nothing changed does no work. Change one image and only that
 * image is re-encoded, which matters when a platform has 88 of them.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/** The ladder. A source narrower than a rung simply does not get that rung. */
export const WIDTHS = [320, 640, 1024, 1920];

/**
 * Below this, a ladder is pointless: the file is already smaller than the
 * smallest rung would be, and generating one would mean uploading MORE bytes
 * than serving the original. Logos, icons and favicons live down here.
 */
const MIN_SOURCE_WIDTH = 420;

/** Where the generated cuts live, relative to publicDir. Uploaded as-is. */
const OUT_DIR = "_gen/img";

/** Manifest path relative to publicDir. The app imports this. */
const MANIFEST = "_gen/images.json";

const CACHE = "_gen/.cache.json";

const RASTER = new Set([".webp", ".png", ".jpg", ".jpeg"]);

/**
 * Directories under public/ that are never page art and must not be walked.
 * `_gen` above all: walking our own output would generate ladders of ladders.
 */
const SKIP_DIRS = new Set(["_gen", "tinymce", "docs", "fonts"]);

function* walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full, base);
    } else if (entry.isFile()) {
      if (RASTER.has(path.extname(entry.name).toLowerCase())) yield full;
    }
  }
}

/** public/a/b/c.webp → "a/b/c.webp", forward slashes on every platform. */
function relKey(pubDir, abs) {
  return path.relative(pubDir, abs).split(path.sep).join("/");
}

/**
 * Output stem for a source path: "images/a/b.webp" → "images/a/b-webp".
 *
 * THE EXTENSION IS FOLDED INTO THE NAME ON PURPOSE. Every cut is WebP whatever
 * went in, so stripping the extension would map `hero.png` and `hero.webp` onto
 * the same `hero-320.webp`, one silently overwrites the other, and the
 * manifest hands both sources the same URL. public/images/home currently holds
 * exactly that pair.
 *
 * MUST match `cutUrl` in react/imageManifest.js. The app derives these URLs
 * from the src string rather than reading them out of the manifest, so the two
 * encodings have to agree exactly or every srcset 404s.
 */
function outStem(key) {
  return key.replace(/\.([^./]+)$/, "-$1");
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Run `jobs` with a ceiling on how many are in flight.
 *
 * sharp decodes the whole source into memory, and a 4000px PNG is ~50MB
 * decoded. Firing 88 of those at once is how a build machine starts swapping.
 */
async function pool(jobs, limit) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Generate the ladder for every image in publicDir and write the manifest.
 *
 * Returns a summary for the CLI to print. NEVER THROWS: a missing sharp or a
 * corrupt source must degrade to "no variants for that file", never fail a
 * deploy. The site renders from the originals in that case, exactly as it did
 * before this existed.
 */
export async function generateImageVariants({ cwd, publicDir, quality = 80, lqip = true }) {
  const pubDir = path.isAbsolute(publicDir) ? publicDir : path.join(cwd, publicDir);
  if (!fs.existsSync(pubDir)) {
    return { skipped: true, reason: "no public directory", generated: 0, cached: 0, images: 0, bytes: 0 };
  }

  let sharp;
  try {
    ({ default: sharp } = await import("sharp"));
  } catch {
    return {
      skipped: true,
      reason: "sharp is not installed, `npm i -D sharp` to enable responsive images",
      generated: 0,
      cached: 0,
      images: 0,
      bytes: 0,
    };
  }

  const outRoot = path.join(pubDir, ...OUT_DIR.split("/"));
  fs.mkdirSync(outRoot, { recursive: true });

  const cachePath = path.join(pubDir, ...CACHE.split("/"));
  const cache = readJson(cachePath, {});
  const nextCache = {};
  const manifest = {};

  let generated = 0;
  let cached = 0;
  let bytes = 0;
  const failures = [];

  const sources = [...walk(pubDir)];

  const jobs = sources.map((abs) => async () => {
    const key = relKey(pubDir, abs);
    const hash = sha256(abs);
    const stem = outStem(key);

    let meta;
    try {
      meta = await sharp(abs).metadata();
    } catch (e) {
      failures.push({ key, error: e.message });
      return;
    }
    if (!meta.width || !meta.height) return;

    // Too small to be worth a ladder, the app keeps serving the original.
    if (meta.width < MIN_SOURCE_WIDTH) return;

    // The rungs this source can actually fill, plus its own width so the
    // largest candidate is always the real thing rather than a downscale.
    const widths = WIDTHS.filter((w) => w < meta.width);
    if (!widths.includes(meta.width)) widths.push(meta.width);

    const prev = cache[key];
    const outputsExist = widths.every((w) =>
      fs.existsSync(path.join(outRoot, ...`${stem}-${w}.webp`.split("/"))),
    );

    if (prev && prev.hash === hash && outputsExist && (!lqip || prev.lqip)) {
      cached++;
      nextCache[key] = prev;
      manifest[`/${key}`] = { w: meta.width, h: meta.height, widths, lqip: prev.lqip ?? null };
      return;
    }

    const outDirFor = path.join(outRoot, ...path.dirname(stem).split("/"));
    fs.mkdirSync(outDirFor, { recursive: true });

    for (const w of widths) {
      const dest = path.join(outRoot, ...`${stem}-${w}.webp`.split("/"));
      try {
        await sharp(abs)
          .resize({ width: w, withoutEnlargement: true })
          .webp({ quality })
          .toFile(dest);
        bytes += fs.statSync(dest).size;
      } catch (e) {
        failures.push({ key, error: e.message });
        return;
      }
    }

    /*
     * The LQIP is inlined into the manifest, so it is paid for in the JS
     * bundle by every page. 16px wide at quality 30 lands around 150-250
     * bytes, which is the whole reason it can be inlined at all; a 32px one is
     * four times that for a blur nobody can tell apart.
     */
    let lqipData = null;
    if (lqip) {
      try {
        const buf = await sharp(abs).resize({ width: 16 }).webp({ quality: 30 }).toBuffer();
        lqipData = `data:image/webp;base64,${buf.toString("base64")}`;
      } catch {
        lqipData = null;
      }
    }

    generated++;
    nextCache[key] = { hash, lqip: lqipData };
    manifest[`/${key}`] = { w: meta.width, h: meta.height, widths, lqip: lqipData };
  });

  await pool(jobs, 4);

  /*
   * Sorted so the manifest is byte-stable across runs. An unsorted object
   * reorders with filesystem iteration and shows up as a spurious diff in
   * every commit, which trains people to stop reading it.
   */
  const sortedManifest = {};
  for (const k of Object.keys(manifest).sort()) sortedManifest[k] = manifest[k];

  const manifestPath = path.join(pubDir, ...MANIFEST.split("/"));
  fs.writeFileSync(manifestPath, JSON.stringify(sortedManifest, null, 0));
  fs.writeFileSync(cachePath, JSON.stringify(nextCache, null, 0));
  const modulePath = writeManifestModule(sortedManifest);

  /*
   * Drop cuts whose source is gone. Without this, `_gen` only ever grows, and
   * every deleted image keeps costing upload time on every deploy forever.
   */
  const liveStems = new Set(Object.keys(sortedManifest).map((k) => outStem(k.slice(1))));
  let pruned = 0;
  for (const abs of walk(outRoot, outRoot)) {
    const stem = relKey(outRoot, abs).replace(/-\d+\.webp$/, "");
    if (!liveStems.has(stem)) {
      fs.unlinkSync(abs);
      pruned++;
    }
  }

  return {
    skipped: false,
    images: Object.keys(sortedManifest).length,
    generated,
    cached,
    pruned,
    bytes,
    failures,
    manifestPath,
    modulePath,
    manifestBytes: fs.statSync(manifestPath).size,
  };
}

/**
 * Write the manifest back into THIS INSTALLED SDK as a real ES module.
 *
 *   node_modules/dashforservices-sdk/react/manifest.generated.js
 *
 * WHY INTO node_modules, WHICH IS NORMALLY A CRIME.
 *
 * <DashImage> has to resolve a bare `src` against the manifest, and it is used
 * in both Server and Client Components across seven sites. That rules out a
 * React context (dead in a Server Component), a module-level setter called
 * from a root layout (never runs in the client bundle), and runtime fetching
 * (a network round-trip to learn the size of an image you are already
 * rendering). What is left is a static import the bundler can inline into
 * whichever graph needs it, and the SDK cannot import a file out of the app,
 * so the app's data has to come to the SDK.
 *
 * The alternative was editing the same adapter in seven separate repos and
 * keeping them in step forever. This way a site gets responsive images by
 * reinstalling, with no diff of its own.
 *
 * SAFE BECAUSE IT IS A BUILD ARTIFACT, NOT STATE. It is rewritten on every
 * `dashforservices images`/`dashforservices build`, which run BEFORE `next build`, so the
 * bundler always reads a file this build wrote. A checked-in default of `{}`
 * ships with the package, so the import resolves in a fresh clone that has
 * never run the generator, and every unknown path simply falls back to the
 * original file.
 */
function writeManifestModule(manifest) {
  try {
    const reactDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "react");
    if (!fs.existsSync(reactDir)) return null;
    const dest = path.join(reactDir, "manifest.generated.js");
    fs.writeFileSync(
      dest,
      "// GENERATED by `dashforservices images`. Do not edit; every build overwrites it.\n" +
        `export default ${JSON.stringify(manifest)};\n`,
    );
    return dest;
  } catch {
    // A read-only node_modules (some CI images) costs the srcset, not the build.
    return null;
  }
}
