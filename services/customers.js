/**
 * Customers and portal auth.
 *
 * Two different things share this module:
 *
 *  - `subscribe()`: newsletter / email capture. Public key, upserts by email
 *    into the platform's `site_customer` records. EXISTS today
 *    (POST /api/site/customers, module "customers").
 *
 *  - Portal sign-in: a customer JWT for the account area (orders, installs,
 *    refills, subscriptions). NEW: /api/site/auth/* (the platform has
 *    /api/platform/portal/login on platform keys; the site surface needs its
 *    own, scoped to the site's platform). Also available as `sd.auth`.
 *
 * Token storage: in memory on the client instance by default. In the browser
 * pass `{ persist: true }` to login() to keep it in localStorage, or (better)
 * set it in an httpOnly cookie from your own route handler and use
 * `sd.asCustomer(token)` server-side.
 */

import { createStorage, seg } from "./_util.js";

const TOKEN_KEY = "sd_customer_token";

export class CustomersModule {
  constructor(client) {
    this.client = client;
    this._storage = createStorage(client.storage);
    if (!client._customerToken) {
      const saved = this._storage.getItem(TOKEN_KEY);
      if (saved) client._customerToken = saved;
    }
  }

  /**
   * Subscribe an email address (footer newsletter, popup, store buyer capture).
   * @param {{email: string, name?: string, phone?: string, source?: string, zip?: string, meta?: object}} data
   * @param {{honeypot?: string}} [options]
   * @returns {Promise<{created: boolean, id: string}>}
   */
  async subscribe(data, { honeypot } = {}) {
    if (!data?.email) throw new Error("customers.subscribe: email is required");
    return this.client._fetch("/api/site/customers", { method: "POST", body: { data, _hp: honeypot || "" } });
  }

  // ─── Portal auth ────────────────────────────────────────────────────────

  get token() {
    return this.client._customerToken;
  }
  get isSignedIn() {
    return Boolean(this.client._customerToken);
  }

  /** Use a token you already hold (e.g. from a cookie). */
  setToken(token, { persist = false } = {}) {
    this.client.setCustomerToken(token);
    if (persist && token) this._storage.setItem(TOKEN_KEY, token);
    if (!token) this._storage.removeItem(TOKEN_KEY);
    return this;
  }

  /**
   * @param {{email: string, password: string}} credentials
   * @param {{persist?: boolean}} [options]
   * @returns {Promise<{token: string, customer: object}>}
   */
  async login({ email, password } = {}, { persist = false } = {}) {
    if (!email || !password) throw new Error("auth.login: email and password are required");
    const res = await this.client._fetch("/api/site/auth/login", { method: "POST", body: { email, password } });
    if (res?.token) this.setToken(res.token, { persist });
    return res;
  }

  /**
   * Create a portal account (or claim the one a checkout created).
   * @returns {Promise<{token: string, customer: object}>}
   */
  async register({ email, password, name, phone } = {}, { persist = false } = {}) {
    if (!email || !password) throw new Error("auth.register: email and password are required");
    const res = await this.client._fetch("/api/site/auth/register", {
      method: "POST",
      body: { email, password, name, phone },
    });
    if (res?.token) this.setToken(res.token, { persist });
    return res;
  }

  /** Email a one-time sign-in link (passwordless; for buyers who never set one). */
  async requestLoginLink(email, { redirectUrl } = {}) {
    if (!email) throw new Error("auth.requestLoginLink: email is required");
    return this.client._fetch("/api/site/auth/magic-link", { method: "POST", body: { email, redirect_url: redirectUrl } });
  }

  /** Exchange a sign-in link token for a session. */
  async verifyLoginLink(linkToken, { persist = false } = {}) {
    const res = await this.client._fetch("/api/site/auth/magic-link/verify", { method: "POST", body: { token: linkToken } });
    if (res?.token) this.setToken(res.token, { persist });
    return res;
  }

  /** Start a password reset (always answers ok; no account-enumeration oracle). */
  async requestPasswordReset(email) {
    return this.client._fetch("/api/site/auth/password-reset", { method: "POST", body: { email } });
  }

  /** @returns {Promise<{customer: object}>} */
  async me() {
    return this.client._fetch("/api/site/auth/me", { auth: true });
  }

  /** Update profile fields (name, phone, default address, marketing/SMS consent). */
  async updateMe(patch) {
    return this.client._fetch("/api/site/auth/me", { method: "PATCH", auth: true, body: patch });
  }

  /** Revoke the token server-side (best effort) and forget it locally. */
  async logout() {
    try {
      if (this.isSignedIn) await this.client._fetch("/api/site/auth/logout", { method: "POST", auth: true });
    } catch {
      /* the local sign-out still happens */
    } finally {
      this.setToken(null);
    }
    return { ok: true };
  }

  // ─── Portal: store orders ───────────────────────────────────────────────

  /** The customer's store orders, newest first. @returns {Promise<{orders: object[]}>} */
  async orders({ limit, offset } = {}) {
    return this.client._fetch("/api/site/orders", { auth: true, query: { limit, offset } });
  }

  /** One order with lines, shipments and tracking. @returns {Promise<{order: object}>} */
  async order(orderId) {
    return this.client._fetch(`/api/site/orders/${seg("orderId", orderId)}`, { auth: true });
  }
}

export default CustomersModule;
