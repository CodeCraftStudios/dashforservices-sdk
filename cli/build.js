/**
 * `npx dashforservices build`, build the Next.js site, upload changed static files
 * to the site's CDN namespace, activate atomically.
 *
 * Flow:
 *   1. GET /api/site/cdn/status → the site's asset prefix, BEFORE building.
 *      The prefix must be baked into the build: a runtime-only prefix makes
 *      the server emit CDN chunk URLs the client bundle never registered, and
 *      React silently never hydrates (a frozen page with zero errors).
 *   2. Cut responsive image variants for public/, BEFORE the build, because
 *      DashImage resolves committed paths against the manifest this writes.
 *      Generating afterwards ships the ladder to the edge and never uses it.
 *   3. `next build` with NEXT_PUBLIC_ASSET_PREFIX in the build env.
 *   3. Scan .next/static + public/ → manifest.
 *   4. POST manifest → deploy_id + signed PUT URLs for NEW files only.
 *   5. PUT each file in parallel (ACL + immutable cache ride the signature).
 *   6. POST activate → atomic flip. Write the prefix to .env.production.
 *
 * The CDN is an OPTIMISATION: no key, API down, or an upload failure must
 * degrade to a plain `next build` served from the origin, never a red deploy,
 * and never a build pointing at chunks that aren't on the edge.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.js";
import { createApi } from "./api.js";
import { scanBuild } from "./scanner.js";
import { uploadAll, formatBytes } from "./uploader.js";
import { generateImageVariants } from "./images.js";
import { report as reportImages } from "./imagesCommand.js";
import { SDK_VERSION as PKG_VERSION } from "../index.js";



const step = (label, detail = "") =>
  console.log(`\n▸ ${label}${detail ? `  ${detail}` : ""}`);
const success = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);

export async function run(args) {
  const skipBuild = args.includes("--skip-build");
  const dryRun = args.includes("--dry-run");
  const noActivate = args.includes("--no-activate");
  const noImages = args.includes("--no-images");

  console.log("dashforservices build");

  // A missing key must degrade to a plain `next build`, never break the site , 
  // CI won't have .env.local, and the deploy's build step must still go green.
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    warn(`CDN upload disabled: ${e.message}`);
    warn("Falling back to a plain `next build`, assets serve from the origin.");
    // Variants still run: local work needing no key, and the srcset is worth
    // just as much when the files come off the origin.
    if (!noImages) await reportImages(generateImageVariants({ cwd: process.cwd(), publicDir: "public" }));
    await runNextBuild(process.cwd());
    success("Built (no CDN upload)");
    return;
  }

  const api = createApi(cfg);
  step("Auth", `key ····${cfg.apiKey.slice(-4)} · ${cfg.apiUrl}`);

  // Resolve the asset prefix BEFORE building so build-time and runtime agree.
  let assetPrefix = null;
  if (!skipBuild) {
    try {
      const status = await api.status();
      assetPrefix = status.asset_prefix || null;
    } catch (e) {
      warn(`Could not resolve the CDN asset prefix: ${e.message}`);
      warn("Building without it, assets will serve from the origin.");
    }
  }

  if (assetPrefix) {
    writeAssetPrefix(cfg.cwd, assetPrefix);
    step("Asset prefix", assetPrefix);
  }

  // BEFORE the build: DashImage imports the manifest this writes.
  if (!noImages) {
    await reportImages(
      generateImageVariants({ cwd: cfg.cwd, publicDir: cfg.publicDir || "public" }),
    );
  }

  if (!skipBuild) {
    step("Building Next.js app");
    await runNextBuild(cfg.cwd, assetPrefix);
    success(`Built ${path.join(cfg.cwd, cfg.buildDir)}`);
  } else {
    warn("Skipping build (--skip-build)");
  }

  // The app has built. If the edge upload fails after we baked the prefix in,
  // the HTML points at chunks that aren't on the CDN, rebuild without it.
  try {
    await uploadToEdge({ cfg, api, dryRun, noActivate });
  } catch (e) {
    warn(`CDN upload failed: ${e.message}`);
    if (assetPrefix && !skipBuild) {
      warn("That build references the edge, rebuilding without the asset prefix.");
      clearAssetPrefix(cfg.cwd);
      await runNextBuild(cfg.cwd, null);
      success("Rebuilt without CDN, assets serve from the origin.");
    } else {
      warn("The app built fine and will deploy, assets serve from the origin.");
    }
  }
}

async function uploadToEdge({ cfg, api, dryRun, noActivate }) {
  step("Hashing static files");
  const entries = await scanBuild(cfg);
  const totalBytes = entries.reduce((n, e) => n + e.size, 0);
  success(`${entries.length} files · ${formatBytes(totalBytes)}`);

  step("Diffing against CDN");
  const manifestRes = await api.manifest({
    sdk_version: PKG_VERSION,
    next_version: readNextVersion(cfg.cwd),
    files: entries.map((e) => ({
      path: e.path,
      sha256: e.sha256,
      size: e.size,
      content_type: e.content_type,
    })),
  });

  const { deploy_id, needs_upload, stats } = manifestRes;
  const unchanged = stats.total_files - stats.new_files;
  success(
    `${stats.new_files} new · ${unchanged} cached · ${formatBytes(stats.new_bytes)} to upload`,
  );

  if (dryRun) {
    warn("Dry run, skipping upload + activation");
    return;
  }

  if (needs_upload.length === 0) {
    success("Nothing to upload, all assets already on CDN");
  } else {
    step(`Uploading to edge (${needs_upload.length} files)`);
    const { failures } = await uploadAll({ api, entries, needsUpload: needs_upload });
    if (failures.length) {
      throw new Error(`${failures.length} uploads failed. First: ${failures[0].error}`);
    }
    success("All files uploaded");
  }

  if (noActivate) {
    warn(`Deploy ${deploy_id} uploaded but not activated (--no-activate)`);
    return;
  }

  step(`Activating ${deploy_id}`);
  const activated = await api.activate(deploy_id);
  success(`Live at ${activated.asset_prefix}`);
  writeAssetPrefix(cfg.cwd, activated.asset_prefix);

  const savedBytes = stats.total_bytes - stats.new_bytes;
  console.log(
    `\nDeploy successful\n  deploy  ${activated.deploy_id}\n  prefix  ${activated.asset_prefix}\n  saved   ${formatBytes(savedBytes)} via dedup\n`,
  );
}

function runNextBuild(cwd, assetPrefix) {
  return new Promise((resolve, reject) => {
    // shell: true is required on Windows so Node can resolve `.cmd` shims
    // (npx.cmd, next.cmd). Harmless on POSIX.
    const env = { ...process.env };
    // NEXT_PUBLIC_ASSET_PREFIX is inlined into the client bundle at build
    // time, so it has to be in the env of the build itself.
    if (assetPrefix) env.NEXT_PUBLIC_ASSET_PREFIX = assetPrefix;
    else delete env.NEXT_PUBLIC_ASSET_PREFIX;

    const child = spawn("npx next build", { cwd, stdio: "inherit", env, shell: true });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`next build exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function readNextVersion(cwd) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    return (pkg.dependencies && pkg.dependencies.next) || (pkg.devDependencies && pkg.devDependencies.next) || "";
  } catch {
    return "";
  }
}

// Drop the prefix again, used when the build referenced the edge but the
// upload failed, so the rebuilt app serves from the origin instead of 404ing.
function clearAssetPrefix(cwd) {
  for (const name of [".env.production", ".env.local"]) {
    const p = path.join(cwd, name);
    if (!fs.existsSync(p)) continue;
    const lines = fs
      .readFileSync(p, "utf8")
      .split(/\r?\n/)
      .filter((l) => !l.startsWith("NEXT_PUBLIC_ASSET_PREFIX="));
    fs.writeFileSync(p, lines.join("\n"));
  }
}

function writeAssetPrefix(cwd, prefix) {
  // .env.production so `next build` picks it up but `next dev` never does , 
  // dev chunks are local-only and would 404 on the CDN.
  const envPath = path.join(cwd, ".env.production");
  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter(
      (l) => !l.startsWith("NEXT_PUBLIC_ASSET_PREFIX="),
    );
  }
  lines.push(`NEXT_PUBLIC_ASSET_PREFIX=${prefix}`);
  fs.writeFileSync(envPath, lines.join("\n"));

  // If the prefix is stuck in .env.local from an older run, remove it so dev
  // mode stops trying to hit the CDN.
  const localPath = path.join(cwd, ".env.local");
  if (fs.existsSync(localPath)) {
    const localLines = fs.readFileSync(localPath, "utf8").split(/\r?\n/);
    if (localLines.some((l) => l.startsWith("NEXT_PUBLIC_ASSET_PREFIX="))) {
      fs.writeFileSync(
        localPath,
        localLines.filter((l) => !l.startsWith("NEXT_PUBLIC_ASSET_PREFIX=")).join("\n"),
      );
    }
  }
}
