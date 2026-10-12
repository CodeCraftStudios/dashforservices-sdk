/**
 * Server-only entry point.
 *
 *   import { createSiteClient } from "dashforservices-sdk/server";
 *   export const sd = createSiteClient();   // reads DASHFORSERVICES_SITE_KEY
 *
 * Importing this from a client component throws at module load, so a secret
 * key cannot be dragged into a browser bundle by an accidental import.
 */

import { SiteClient, ENV, DEFAULT_BASE_URL } from "./index.js";
import { attributionFromCookies } from "./services/attribution.js";

if (typeof window !== "undefined") {
  throw new Error(
    "\n\ndashforservices-sdk/server was imported in the browser.\n\n" +
      "This module carries your SECRET site key. Import it only from server code:\n" +
      "route handlers, server components, server actions.\n" +
      "In the browser, construct SiteClient with a PUBLIC key instead.\n"
  );
}

/**
 * @param {Object} [options]  any SiteClient option; key/baseURL default to env
 * @param {string} [options.key]       defaults to process.env.DASHFORSERVICES_SITE_KEY
 * @param {string} [options.baseURL]   defaults to process.env.DASHFORSERVICES_API_URL
 * @param {string} [options.platform]  expected platform slug (asserted on first call)
 */
export function createSiteClient(options = {}) {
  const key = options.key || process.env[ENV.SITE_KEY] || process.env.SERVICEDASH_SITE_KEY;
  if (!key) {
    throw new Error(`No site key. Set ${ENV.SITE_KEY} (NOT NEXT_PUBLIC_*) or pass { key }.`);
  }
  return new SiteClient({
    ...options,
    key,
    baseURL: options.baseURL || process.env[ENV.API_URL] || process.env.SERVICEDASH_API_URL || DEFAULT_BASE_URL,
    platform: options.platform || process.env.DASHFORSERVICES_PLATFORM || undefined,
  });
}

export * from "./index.js";
export { attributionFromCookies };
