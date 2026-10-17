/**
 * Build/deploy config, from the same variables the SDK runtime reads:
 *
 *   DASHFORSERVICES_SITE_KEY   the site's SECRET key (dfd-site-secret-...). Deploys
 *                              are a server-side act; the public key cannot deploy.
 *   DASHFORSERVICES_API_URL    defaults to https://api.dashfordevs.com
 *
 * The old SERVICEDASH_* names still work as a fallback. Reads process.env first,
 * then .env.local / .env in the working directory, `next dev`-style.
 */

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BASE_URL, ENV } from "../index.js";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[trimmed.slice(0, idx).trim()] = value;
  }
  return out;
}

export function loadConfig(cwd = process.cwd()) {
  const fileEnv = { ...parseEnvFile(path.join(cwd, ".env")), ...parseEnvFile(path.join(cwd, ".env.local")) };
  const read = (name) => process.env[name] || fileEnv[name] || "";
  const get = (name) => read(name) || read(name.replace("DASHFORSERVICES", "SERVICEDASH"));

  const apiKey = get(ENV.SITE_KEY);
  if (!apiKey) throw new Error(`${ENV.SITE_KEY} is not set (checked env, .env.local, .env)`);
  if (!apiKey.startsWith("dfd-site-secret-")) {
    throw new Error(`${ENV.SITE_KEY} must be the site's SECRET key; deploys can't run on the public key`);
  }

  return {
    cwd,
    apiKey,
    apiUrl: (get(ENV.API_URL) || DEFAULT_BASE_URL).replace(/\/$/, ""),
    buildDir: ".next",
    publicDir: "public",
  };
}
