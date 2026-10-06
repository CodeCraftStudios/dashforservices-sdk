/**
 * Affiliates: influencer codes and links (?ref=CODE).
 *
 *   sd.affiliates.track("JESSWATER");   // set the sd_ref cookie + record the click
 *   const { affiliate } = await sd.affiliates.get("JESSWATER");
 *   // { code, display_name, avatar, discount: { type: "percent", value: 10 } | null }
 *
 * `attribution.capture()` calls track() on its own when the landing URL has
 * ?ref=, so most sites never call it directly. Call it for a code typed into
 * a form ("Have a creator code?").
 *
 * The code then rides on every lead, cart and checkout via attribution, and
 * the platform credits the sale after the return window.
 *
 * Backend: NEW. POST /api/site/affiliates/clicks, GET /api/site/affiliates/<code>
 * (ServiceDash "affiliates" module).
 */

import { seg, setCookie, hasWindow } from "./_util.js";

export class AffiliatesModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * Adopt an affiliate code for this visitor and record the click.
   * Never throws; returns false when the click could not be recorded.
   * @param {string} code
   * @param {{days?: number}} [options] cookie lifetime (default 30)
   */
  async track(code, { days = 30 } = {}) {
    const c = String(code || "").trim();
    if (!c) return false;
    if (hasWindow()) setCookie("sd_ref", c, { days });
    try {
      this.client.cart?.setCode?.(c);
    } catch {
      /* cart is optional */
    }
    try {
      await this.recordClick(c);
      return true;
    } catch {
      return false;
    }
  }

  /** Record a click without touching cookies. Public key. */
  async recordClick(code, touch = {}) {
    let visitorId;
    try {
      visitorId = this.client.insights?.getVisitorId?.() || undefined;
    } catch {
      visitorId = undefined;
    }
    return this.client._fetch("/api/site/affiliates/clicks", {
      method: "POST",
      body: {
        code,
        landing_page: touch.landing_page || (hasWindow() ? window.location.href : undefined),
        referrer: touch.referrer || (hasWindow() ? document.referrer : undefined),
        video_id: touch.video_id,
        visitor_id: visitorId,
      },
    });
  }

  /** Public profile of a code, for a "referred by" banner. Null on 404. */
  async get(code) {
    try {
      return await this.client._fetch(`/api/site/affiliates/${seg("code", code)}`, { live: true });
    } catch (err) {
      if (err?.status === 404) return { affiliate: null };
      throw err;
    }
  }
}

export default AffiliatesModule;
