#!/usr/bin/env node
/**
 * `npx dashforservices <command>` (also `npx servicedash`): the site CLI.
 *
 *   dashforservices build     build + CDN deploy (cli/build.js); needs the SECRET key
 *     --skip-build            upload the existing .next without rebuilding
 *     --dry-run               diff only; no upload, no activation
 *     --no-activate           upload but don't flip the active deployment
 *     --no-images             skip the responsive cuts for public/
 *   dashforservices images    cut responsive WebP variants + LQIP for public/ (no key)
 *     --quality <n>           WebP quality (default 80)
 *     --no-lqip               skip the blur-up placeholders
 *   dashforservices cdn       the site's active CDN deployment and asset prefix
 *   dashforservices status    whoami: site, platform, key kind/environment, enabled modules
 *     --json                  raw JSON
 *
 * Reads DASHFORSERVICES_SITE_KEY (falling back to NEXT_PUBLIC_DASHFORSERVICES_SITE_KEY)
 * and DASHFORSERVICES_API_URL from the environment, then .env.local / .env in the
 * working directory. Any site key works for status; nothing is written.
 */

import fs from "node:fs";
import path from "node:path";
import { SiteClient, ENV, DEFAULT_BASE_URL, SDK_VERSION } from "../index.js";
import { run as runBuild } from "./build.js";
import { runImages } from "./imagesCommand.js";
import { loadConfig as loadDeployConfig } from "./config.js";
import { createApi } from "./api.js";
import { formatBytes } from "./uploader.js";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, idx).trim()] = value;
  }
  return out;
}

function loadConfig(cwd = process.cwd()) {
  const fileEnv = { ...parseEnvFile(path.join(cwd, ".env")), ...parseEnvFile(path.join(cwd, ".env.local")) };
  const get = (name) => process.env[name] || fileEnv[name] || process.env[name.replace("DASHFORSERVICES", "SERVICEDASH")] || fileEnv[name.replace("DASHFORSERVICES", "SERVICEDASH")] || "";
  const key = get(ENV.SITE_KEY) || get(ENV.PUBLIC_SITE_KEY);
  if (!key) throw new Error(`${ENV.SITE_KEY} is not set (checked env, .env.local, .env)`);
  return { key, baseURL: get(ENV.API_URL) || DEFAULT_BASE_URL, platform: get("DASHFORSERVICES_PLATFORM") || undefined };
}

async function status(args) {
  const cfg = loadConfig();
  // The CLI is a server process; don't trip the NEXT_PUBLIC_* secret guard on
  // the developer's own .env by passing values through process.env.
  const sd = new SiteClient({ key: cfg.key, baseURL: cfg.baseURL, platform: cfg.platform });
  let who;
  try {
    who = await sd.whoami();
  } catch (err) {
    if (err?.status) throw err;
    throw new Error(`could not reach ${cfg.baseURL} (${err?.cause?.code || err?.message || err})`);
  }
  if (args.includes("--json")) {
    console.log(JSON.stringify(who, null, 2));
    return;
  }
  const modules = Array.isArray(who?.modules) ? who.modules : [];
  console.log(`dashforservices-sdk ${SDK_VERSION}  ->  ${cfg.baseURL}`);
  console.log(`site          ${who?.site?.name || "(unnamed)"}  ${who?.site?.domain || ""}  [${who?.site?.id || "?"}]`);
  console.log(`platform      ${who?.platform?.name || "?"} (${who?.platform?.slug || "?"})`);
  console.log(`key           ${who?.key?.kind || sd.kind} / ${who?.key?.environment || sd.environment}`);
  console.log(`customer      ${who?.customer || "-"}`);
  console.log(`modules (${modules.length})${modules.length ? "" : "  none enabled"}`);
  for (const m of [...modules].sort()) console.log(`  - ${m}`);
}

async function cdn() {
  const api = createApi(loadDeployConfig());
  const res = await api.status();
  console.log(`asset prefix  ${res.asset_prefix}`);
  if (!res.active) {
    console.log("no active deployment yet: run `npx dashforservices build`");
    return;
  }
  const a = res.active;
  console.log(`active        ${a.deploy_id} · ${a.total_files} files · ${formatBytes(a.total_bytes)} · activated ${a.activated_at}`);
  for (const d of res.recent ?? []) if (d.deploy_id !== a.deploy_id) console.log(`  ${d.status.padEnd(10)} ${d.deploy_id} · ${d.created_at}`);
}

const [, , command, ...args] = process.argv;
try {
  if (command === "status") await status(args);
  else if (command === "build" || command === "deploy") await runBuild(args);
  else if (command === "images") await runImages(args);
  else if (command === "cdn") await cdn();
  else {
    console.log("Usage: npx dashforservices <build|images|cdn|status> [--skip-build --dry-run --no-activate --no-images --json]");
    process.exit(command ? 1 : 0);
  }
} catch (e) {
  console.error(`error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
