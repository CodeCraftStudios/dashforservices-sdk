/**
 * servicedash-sdk: the ServiceDash public-site SDK.
 *
 * Solution by CodeCraft Studios (https://www.codecraftstudios.net)
 *
 * What a ServiceDash tenant's public website runs on: the landing page, the
 * blog and service pages, the store (products, cart, Stripe checkout, filter
 * subscriptions), reviews, the plumber directory, the local regulations
 * lookup, quote/lead forms and first-party click tracking.
 *
 * It talks to the Dash4Devs SITE surface (/api/site/*) with a per-site key
 * issued from the ServiceDash dashboard (Website -> API keys):
 *
 *   import { SiteClient } from "servicedash-sdk";
 *
 *   const sd = new SiteClient({ key: process.env.NEXT_PUBLIC_SERVICEDASH_SITE_KEY });
 *   const { products } = await sd.products.list({ category: "softeners" });
 *
 * Unlike localplug-sdk this package is not hardwired to one platform slug:
 * ServiceDash runs several tenants, each of which may be its own Dash4Devs
 * platform. Pass `platform: "<slug>"` and the first call verifies the key
 * belongs to it; omit it and any valid site key is accepted.
 */

import { ContentModule } from "./services/content.js";
import { FilesModule, FileFolder, matchFile } from "./services/files.js";
import { PageGroupsModule, PageGroup } from "./services/pageGroups.js";
import { BlogModule } from "./services/blog.js";
import { ProductsModule } from "./services/products.js";
import { CategoriesModule, toCategory } from "./services/categories.js";
import { CartModule } from "./services/cart.js";
import { CheckoutModule } from "./services/checkout.js";
import { SubscriptionsModule } from "./services/subscriptions.js";
import { CustomersModule } from "./services/customers.js";
import { ReviewsModule } from "./services/reviews.js";
import { PlumbersModule } from "./services/plumbers.js";
import { RegulationsModule } from "./services/regulations.js";
import { LeadsModule } from "./services/leads.js";
import { InsightsModule } from "./services/insights.js";
import { LegalModule } from "./services/legal.js";
import { FormsModule } from "./services/forms.js";
import { JobsModule, JOB_STEPS, CUSTOMER_JOB_STEPS } from "./services/jobs.js";
import { RefillsModule } from "./services/refills.js";
import { QuotesModule, QUOTE_TIERS } from "./services/quotes.js";
import { HardnessModule, HARDNESS_BANDS } from "./services/hardness.js";
import { AffiliatesModule } from "./services/affiliates.js";
import { AttributionModule, attributionFromCookies } from "./services/attribution.js";
import { LEAD_KINDS, CUSTOMER_TYPES, WATER_CONCERNS, WATER_PROBLEMS, TIMELINES, BUSINESS_TYPES } from "./services/leads.js";
import { buildQuery } from "./services/_util.js";

export const SDK_NAME = "servicedash-sdk";
export const SDK_VERSION = "0.1.0-alpha";
export const PRODUCT_NAME = "ServiceDash";
export const DEFAULT_BASE_URL = "https://api.dashfordevs.com";

/** Environment variable names the SDK (and its CLI) read. */
export const ENV = Object.freeze({
  /** Secret OR public key, server-side. Never NEXT_PUBLIC_* when secret. */
  SITE_KEY: "SERVICEDASH_SITE_KEY",
  /** Public key, inlined into the browser bundle by Next.js. */
  PUBLIC_SITE_KEY: "NEXT_PUBLIC_SERVICEDASH_SITE_KEY",
  /** API host override (local dev / staging). */
  API_URL: "SERVICEDASH_API_URL",
});

export const KEY_PATTERN = /^dfd-site-(public|secret)-key-(live|test)-[A-Za-z0-9_-]{20,}$/;

// The platform allows 30 requests a minute per key. A static build can ask for
// more than that in a burst, so a 429 on a GET is waited out, not thrown.
const RATE_LIMIT_WINDOW_MS = 61_000;
const RATE_LIMIT_ATTEMPTS = 4;
const DEFAULT_REVALIDATE_SECONDS = 300;

/** Error thrown by every SDK call that reached the API and failed. */
export class ServiceDashError extends Error {
  constructor(message, { status, code, payload, retryAfterMs } = {}) {
    super(message);
    this.name = "ServiceDashError";
    this.status = status;
    this.code = code;
    this.payload = payload;
    if (retryAfterMs) this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Split a site key into its parts, or null when it is not one.
 * @param {string} key
 * @returns {{kind: "public"|"secret", environment: "live"|"test"} | null}
 */
export function parseSiteKey(key) {
  const match = typeof key === "string" ? KEY_PATTERN.exec(key) : null;
  return match ? { kind: match[1], environment: match[2] } : null;
}

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

function readEnv(name) {
  try {
    if (typeof process !== "undefined" && process.env) return process.env[name] || undefined;
  } catch {
    /* no process in this runtime */
  }
  return undefined;
}

// Next.js only inlines NEXT_PUBLIC_* when the expression is written literally,
// so the browser fallback cannot go through readEnv(name).
function readPublicKeyEnv() {
  try {
    return process.env.NEXT_PUBLIC_SERVICEDASH_SITE_KEY || undefined;
  } catch {
    return undefined;
  }
}
function readPublicApiUrlEnv() {
  try {
    return process.env.NEXT_PUBLIC_SERVICEDASH_API_URL || undefined;
  } catch {
    return undefined;
  }
}

function securityError(lines) {
  return new Error(`\n\nSERVICEDASH SECURITY ERROR\n\n${lines.join("\n")}\n`);
}

export class SiteClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.key]       dfd-site-<public|secret>-key-<live|test>-<random>.
   *   Defaults to SERVICEDASH_SITE_KEY (server) / NEXT_PUBLIC_SERVICEDASH_SITE_KEY.
   * @param {string} [options.baseURL]   API host. Defaults to SERVICEDASH_API_URL or https://api.dashfordevs.com
   * @param {string} [options.platform]  Expected Dash4Devs platform slug. Asserted against
   *   /api/site/whoami on the first call, only when given.
   * @param {number} [options.revalidate=300] Server GET cache lifetime (seconds) under a production Next build.
   * @param {string[]} [options.cacheTags]   Extra Next cache tags on every cached GET.
   * @param {string} [options.customerToken] A signed-in customer's JWT (portal calls).
   * @param {{endpoint?: string, mode?: "session"|"payment_intent"}} [options.checkout]
   *   Default checkout transport; see services/checkout.js.
   * @param {Object} [options.storage]   getItem/setItem/removeItem store for the cart and
   *   the visitor id. Defaults to localStorage in the browser, memory on the server.
   * @param {{cookieDays?: number, refCookieDays?: number, cookieDomain?: string}} [options.attribution]
   *   Attribution cookie settings (sd_attr / sd_ref).
   * @param {Function} [options.fetch]   fetch implementation (tests).
   */
  constructor(options = {}) {
    const {
      key = isBrowser() ? readPublicKeyEnv() : readEnv(ENV.SITE_KEY) || readPublicKeyEnv(),
      baseURL = readEnv(ENV.API_URL) || readPublicApiUrlEnv() || DEFAULT_BASE_URL,
      platform,
      revalidate = DEFAULT_REVALIDATE_SECONDS,
      cacheTags = [],
      customerToken,
      checkout,
      storage,
      attribution,
      fetch: fetchImpl,
    } = options;

    if (!key) {
      throw new Error(
        "A site key is required. Pass { key } or set " +
          `${ENV.SITE_KEY} (server) / ${ENV.PUBLIC_SITE_KEY} (browser). ` +
          "Issue one in the ServiceDash dashboard: Website -> API keys."
      );
    }

    const parsed = parseSiteKey(key);
    if (!parsed) {
      throw new Error(
        "Invalid site key.\n\n" +
          "Expected: dfd-site-<public|secret>-key-<live|test>-<random>\n" +
          "This is NOT a dfd-platform-* key. Those belong to the dashboard, never to a website."
      );
    }

    // A secret key in a browser bundle bypasses the origin allowlist and can
    // write. Fail at construction rather than leak quietly at runtime.
    if (parsed.kind === "secret" && isBrowser()) {
      throw securityError([
        "A SECRET site key is being used in the browser.",
        "Use it only in server code (route handlers, server components, server actions).",
        "In the browser, use a PUBLIC key with an allowed origin.",
        "If this key was exposed, revoke it: ServiceDash dashboard -> Website -> API keys.",
      ]);
    }

    // A secret key in NEXT_PUBLIC_* is the same leak, one build step later.
    if (typeof process !== "undefined" && process.env && !isBrowser()) {
      for (const [name, value] of Object.entries(process.env)) {
        if (name.startsWith("NEXT_PUBLIC_") && typeof value === "string" && value.startsWith("dfd-site-secret-key-")) {
          throw securityError([
            `A secret site key is in ${name}.`,
            "NEXT_PUBLIC_ variables are inlined into the browser bundle.",
            `Move it to ${ENV.SITE_KEY} and use it server-side only.`,
          ]);
        }
      }
    }

    this.key = key;
    this.kind = parsed.kind;
    this.environment = parsed.environment;
    this.baseURL = String(baseURL).replace(/\/+$/, "");
    this.platform = platform || null;
    this.revalidate = revalidate;
    this.cacheTags = cacheTags;
    this.checkoutDefaults = checkout || {};
    this.storage = storage || null;
    this.attributionOptions = attribution || {};
    this._fetchImpl = fetchImpl || null;
    this._customerToken = customerToken || null;
    this._root = this; // derived clients (asCustomer) share pairing state with the root
    this._pairing = null;

    this._mountModules();
  }

  _mountModules() {
    // Attribution first: leads, checkout, forms and insights read it.
    this.attribution = new AttributionModule(this, { storage: this.storage, ...this.attributionOptions });
    this.content = new ContentModule(this);
    this.files = new FilesModule(this);
    this.pageGroups = new PageGroupsModule(this);
    this.blog = new BlogModule(this);
    this.products = new ProductsModule(this);
    this.categories = new CategoriesModule(this);
    this.cart = new CartModule(this, { storage: this.storage });
    this.checkout = new CheckoutModule(this);
    this.subscriptions = new SubscriptionsModule(this);
    this.customers = new CustomersModule(this);
    this.auth = this.customers; // same module; reads better at call sites: sd.auth.login()
    this.reviews = new ReviewsModule(this);
    this.plumbers = new PlumbersModule(this);
    this.regulations = new RegulationsModule(this);
    this.leads = new LeadsModule(this);
    this.insights = new InsightsModule(this, { storage: this.storage });
    this.tracking = this.insights;
    this.legal = new LegalModule(this);
    this.forms = new FormsModule(this);
    this.quotes = new QuotesModule(this);
    this.hardness = new HardnessModule(this);
    this.affiliates = new AffiliatesModule(this);
    this.jobs = new JobsModule(this);
    this.refills = new RefillsModule(this);
  }

  get isServerSide() {
    return !isBrowser();
  }

  /** Fluent shortcut: `sd.pageGroup("services").all()`. */
  pageGroup(slug) {
    return new PageGroup(this, slug);
  }

  // ─── Customer identity ──────────────────────────────────────────────────

  /** The signed-in customer's JWT, or null. */
  get customerToken() {
    return this._customerToken;
  }

  /** Set (or clear with null) the customer JWT used by portal calls. */
  setCustomerToken(token) {
    this._customerToken = token || null;
    return this;
  }

  /**
   * A client that acts as one signed-in customer, sharing this client's key,
   * settings and pairing check. Use this on the server, where a module-level
   * client is shared across requests and must never hold one person's token:
   *
   *   const me = sd.asCustomer(cookies().get("sd_customer")?.value);
   *   const { subscriptions } = await me.subscriptions.list();
   */
  asCustomer(token) {
    const derived = Object.create(SiteClient.prototype);
    Object.assign(derived, this, { _customerToken: token || null, _root: this._root });
    derived._mountModules();
    return derived;
  }

  // ─── Transport ──────────────────────────────────────────────────────────

  /**
   * Verify the key's platform when `platform` was given. Memoized on the root
   * client: one extra round-trip on cold start, then free. Without `platform`
   * this resolves immediately and costs nothing.
   */
  async _assertPaired() {
    const root = this._root;
    if (!root.platform) return null;
    if (!root._pairing) {
      root._pairing = root._rawFetch("/api/site/whoami").then((who) => {
        const slug = who?.platform?.slug;
        if (slug && slug !== root.platform) {
          throw new ServiceDashError(
            `This key belongs to the '${slug}' platform, but this client was configured ` +
              `for '${root.platform}'. Check ${ENV.SITE_KEY} and the platform option.`,
            { code: "platform_mismatch", status: 403 }
          );
        }
        return who;
      });
      // A failure (transient or mismatch) must not poison every future call.
      root._pairing.catch(() => {
        root._pairing = null;
      });
    }
    return root._pairing;
  }

  /**
   * Send, retrying idempotent GETs that hit the per-key rate limit. A static
   * build that fails a loader on 429 can prerender a 404 and cache it, so the
   * window is waited out. Writes are never replayed.
   */
  async _rawFetch(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const attempts = method === "GET" ? RATE_LIMIT_ATTEMPTS : 1;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this._sendOnce(path, options);
      } catch (err) {
        if (i === attempts - 1 || err?.status !== 429) throw err;
        const wait = err.retryAfterMs || RATE_LIMIT_WINDOW_MS;
        console.warn(
          `[${SDK_NAME}] rate limited on ${path}; waiting ${Math.round(wait / 1000)}s (attempt ${i + 1}/${attempts})`
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    return undefined;
  }

  async _sendOnce(path, options = {}) {
    const { live, tags, revalidate, query, auth, body, headers: extraHeaders, ...init } = options;
    const method = (init.method || "GET").toUpperCase();

    const headers = { "X-Site-Key": this.key, Accept: "application/json", ...extraHeaders };
    let payloadBody = body;
    if (body !== undefined && body !== null && typeof body !== "string") {
      payloadBody = JSON.stringify(body);
    }
    if (payloadBody !== undefined) headers["Content-Type"] = "application/json";

    if (auth) {
      if (!this._customerToken) {
        throw new ServiceDashError("Not signed in. Call sd.auth.login() or pass a customer token.", {
          status: 401,
          code: "not_signed_in",
        });
      }
      headers.Authorization = `Bearer ${this._customerToken}`;
    }

    // Server-side GETs under a production Next build use ISR fetch caching:
    // `no-store` there turns static pages dynamic and hammers the rate limit.
    // Per-customer (auth) calls and `live` reads are never cached, and
    // browsers ignore the `next` option entirely.
    const isProd = readEnv("NODE_ENV") === "production";
    const cacheable = method === "GET" && this.isServerSide && isProd && !live && !auth;
    const caching = cacheable
      ? { next: { revalidate: revalidate ?? this.revalidate, tags: ["servicedash", ...this.cacheTags, ...(tags || [])] } }
      : { cache: "no-store" };

    const doFetch = this._fetchImpl || globalThis.fetch;
    let response;
    try {
      response = await doFetch(`${this.baseURL}${path}${buildQuery(query)}`, {
        ...init,
        method,
        headers,
        ...(payloadBody !== undefined ? { body: payloadBody } : {}),
        ...caching,
      });
    } catch (err) {
      // Caller-initiated aborts stay AbortErrors; everything else (DNS, refused,
      // TLS, offline) becomes a ServiceDashError so callers catch one type.
      if (err?.name === "AbortError") throw err;
      throw new ServiceDashError(`Couldn't reach the ServiceDash API at ${this.baseURL} (${method} ${path}): ${err?.message || err}`, {
        status: 0,
        code: "network_error",
        payload: null,
      });
    }

    if (response.status === 204) return { ok: true };

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Non-JSON body (proxy error page, Django HTML 404) falls through.
    }

    if (!response.ok) {
      let message = payload?.message || `Site API error (${response.status}) on ${method} ${path}`;
      const code = payload?.error;
      if (code === "origin_not_allowed") {
        message += "\n-> Add this domain to the key's allowed origins in the ServiceDash dashboard.";
      } else if (code === "secret_key_required") {
        message += "\n-> Public keys are read-only here. Make this call from your server with the secret key.";
      } else if (code === "key_revoked") {
        message += "\n-> This site's key was revoked. Issue a new one from the dashboard.";
      } else if (code === "module_not_enabled") {
        message += "\n-> This capability isn't enabled for the platform yet (see README: Backend status).";
      } else if (response.status === 404 && payload === null) {
        message += "\n-> The endpoint does not exist on this API host yet (see README: Backend status).";
      }
      let retryAfterMs;
      const retryAfter = Number(response.headers?.get?.("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        retryAfterMs = Math.min(retryAfter * 1000, RATE_LIMIT_WINDOW_MS * 2);
      }
      throw new ServiceDashError(message, { status: response.status, code, payload, retryAfterMs });
    }

    return payload;
  }

  /** Every service call goes through here: pairing check, then the request. */
  async _fetch(path, options = {}) {
    await this._assertPaired();
    return this._rawFetch(path, options);
  }

  /** The site this key belongs to: site, customer, platform, key kind/environment, modules. */
  async whoami() {
    if (this._root.platform) return this._assertPaired();
    return this._rawFetch("/api/site/whoami", { live: true });
  }
}

export {
  PageGroup,
  toCategory,
  FileFolder,
  matchFile,
  attributionFromCookies,
  JOB_STEPS,
  CUSTOMER_JOB_STEPS,
  QUOTE_TIERS,
  HARDNESS_BANDS,
  LEAD_KINDS,
  CUSTOMER_TYPES,
  WATER_CONCERNS,
  WATER_PROBLEMS,
  TIMELINES,
  BUSINESS_TYPES,
};
export default SiteClient;
