/**
 * Attribution: where a visitor came from, carried to the lead, quote and order.
 *
 * On landing, `capture()` reads the URL and referrer:
 *   utm_source/medium/campaign/term/content, gclid/gbraid/wbraid (Google Ads),
 *   fbclid (Meta), msclkid (Microsoft), ttclid (TikTok), video id (?video= /
 *   ?v= / ?vid=, the city video that sent them), affiliate code (?ref=),
 *   landing page and referrer.
 *
 * First touch is stored once, last touch updates whenever a new source shows
 * up. Both live in localStorage (`sd_attr`) AND a compact first-party cookie
 * (`sd_attr`) so a server route can read them too; the affiliate code gets
 * its own cookie (`sd_ref`, 30 days by default, last referrer wins).
 *
 *   sd.attribution.capture();            // once per page load (DashForServicesProvider does it)
 *   const a = sd.attribution.snapshot(); // attach to anything you submit
 *   // server: attributionFromCookies(request.headers.get("cookie"))
 *
 * Capture is first-party and is only ever SENT when the visitor submits a
 * form, starts checkout or follows an affiliate link, so it does not depend
 * on Do Not Track; analytics events (insights.js) do.
 *
 * Backend: nothing of its own; rides on leads, checkout and affiliates.
 */

import { createStorage, readJSON, writeJSON, getCookie, setCookie, hasWindow } from "./_util.js";

const STORE_KEY = "sd_attr";
const COOKIE_ATTR = "sd_attr";
const COOKIE_REF = "sd_ref";
const CLICK_IDS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "li_fat_id"];
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id"];
const VIDEO_PARAMS = ["video", "vid", "v"];

const trim = (v, n = 300) => (typeof v === "string" ? v.slice(0, n) : v);

function currentTouch() {
  const url = new URL(window.location.href);
  const p = url.searchParams;
  const touch = { at: new Date().toISOString(), landing_page: trim(url.origin + url.pathname + url.search, 500) };
  for (const k of UTM) if (p.get(k)) touch[k.replace("utm_", "")] = trim(p.get(k), 200);
  for (const k of CLICK_IDS) if (p.get(k)) touch[k] = trim(p.get(k), 300);
  for (const k of VIDEO_PARAMS) {
    if (p.get(k)) {
      touch.video_id = trim(p.get(k), 100);
      break;
    }
  }
  const ref = p.get("ref") || p.get("aff") || p.get("affiliate");
  if (ref) touch.affiliate_code = trim(ref.trim(), 64);

  const referrer = document.referrer || "";
  if (referrer) {
    touch.referrer = trim(referrer, 500);
    try {
      const host = new URL(referrer).hostname.replace(/^www\./, "");
      if (host && host !== window.location.hostname.replace(/^www\./, "") && !touch.source) {
        touch.source = host;
        touch.medium = touch.medium || (/google|bing|duckduckgo|yahoo/.test(host) ? "organic" : "referral");
      }
    } catch {
      /* malformed referrer */
    }
  }
  if (!touch.source) {
    if (touch.gclid || touch.gbraid || touch.wbraid) Object.assign(touch, { source: "google", medium: touch.medium || "cpc" });
    else if (touch.fbclid) Object.assign(touch, { source: "facebook", medium: touch.medium || "paid_social" });
    else if (touch.msclkid) Object.assign(touch, { source: "bing", medium: touch.medium || "cpc" });
    else if (touch.ttclid) Object.assign(touch, { source: "tiktok", medium: touch.medium || "paid_social" });
    else if (touch.affiliate_code) Object.assign(touch, { source: "affiliate", medium: "affiliate" });
  }
  return touch;
}

/** A touch carries a real signal (not an internal navigation / direct load). */
const hasSignal = (t) => Boolean(t && (t.source || t.campaign || t.affiliate_code || CLICK_IDS.some((k) => t[k])));

/** Parse attribution cookies from a Cookie header (server routes, middleware). */
export function attributionFromCookies(cookieHeader) {
  let stored = null;
  try {
    stored = JSON.parse(getCookie(COOKIE_ATTR, cookieHeader || "") || "null");
  } catch {
    stored = null;
  }
  return {
    first_touch: stored?.ft || null,
    last_touch: stored?.lt || null,
    affiliate_code: getCookie(COOKIE_REF, cookieHeader || "") || stored?.lt?.affiliate_code || null,
  };
}

export class AttributionModule {
  /**
   * @param {object} client
   * @param {{storage?: object, cookieDays?: number, refCookieDays?: number, cookieDomain?: string}} [options]
   */
  constructor(client, options = {}) {
    this.client = client;
    this._storage = createStorage(options.storage);
    this._cookieDays = options.cookieDays ?? 90;
    this._refCookieDays = options.refCookieDays ?? 30;
    this._cookieDomain = options.cookieDomain;
    this._captured = false;
  }

  /**
   * Read this page load's touch and fold it into first/last touch. Idempotent
   * per page load. Browser only; a no-op on the server.
   * @param {{trackAffiliate?: boolean}} [options] also record the affiliate click (default true)
   */
  capture({ trackAffiliate = true } = {}) {
    if (!hasWindow() || this._captured) return this.get();
    this._captured = true;
    try {
      const touch = currentTouch();
      const stored = readJSON(this._storage, STORE_KEY, null) || {};
      if (!stored.ft) stored.ft = touch;
      if (hasSignal(touch) || !stored.lt) stored.lt = touch;
      writeJSON(this._storage, STORE_KEY, stored);
      setCookie(COOKIE_ATTR, JSON.stringify(this._compact(stored)), { days: this._cookieDays, domain: this._cookieDomain });

      if (touch.affiliate_code) {
        const previous = getCookie(COOKIE_REF);
        setCookie(COOKIE_REF, touch.affiliate_code, { days: this._refCookieDays, domain: this._cookieDomain });
        if (trackAffiliate && previous !== touch.affiliate_code && this.client.affiliates) {
          this.client.affiliates.recordClick(touch.affiliate_code, touch).catch(() => {});
        }
      }
    } catch {
      /* attribution must never break a page */
    }
    return this.get();
  }

  /** Stored { first_touch, last_touch, affiliate_code }. */
  get() {
    if (!hasWindow()) return { first_touch: null, last_touch: null, affiliate_code: null };
    const stored = readJSON(this._storage, STORE_KEY, null) || {};
    return {
      first_touch: stored.ft || null,
      last_touch: stored.lt || null,
      affiliate_code: getCookie(COOKIE_REF) || stored.lt?.affiliate_code || null,
    };
  }

  /** The affiliate code in effect (cookie), or null. */
  get affiliateCode() {
    return this.get().affiliate_code;
  }

  /**
   * Flat payload for a lead / quote / order. Last touch wins for the flat
   * fields; both touches ride along whole.
   */
  snapshot() {
    if (hasWindow() && !this._captured) this.capture();
    const { first_touch: ft, last_touch: lt, affiliate_code } = this.get();
    const t = lt || ft || {};
    let visitorId;
    try {
      visitorId = this.client.insights?.getVisitorId?.() || undefined;
    } catch {
      visitorId = undefined;
    }
    return {
      source: t.source,
      medium: t.medium,
      campaign: t.campaign,
      term: t.term,
      content: t.content,
      gclid: t.gclid || ft?.gclid,
      gbraid: t.gbraid,
      wbraid: t.wbraid,
      fbclid: t.fbclid || ft?.fbclid,
      msclkid: t.msclkid,
      ttclid: t.ttclid,
      video_id: t.video_id || ft?.video_id,
      affiliate_code: affiliate_code || undefined,
      landing_page: ft?.landing_page || t.landing_page,
      referrer: ft?.referrer || t.referrer,
      page: hasWindow() ? trim(window.location.href, 500) : undefined,
      visitor_id: visitorId,
      first_touch: ft || undefined,
      last_touch: lt || undefined,
    };
  }

  /** Forget everything (e.g. a "reset" in dev tools). */
  clear() {
    this._storage.removeItem(STORE_KEY);
    setCookie(COOKIE_ATTR, "", { days: -1, domain: this._cookieDomain });
    setCookie(COOKIE_REF, "", { days: -1, domain: this._cookieDomain });
  }

  _compact(stored) {
    const pick = (t) =>
      t && {
        at: t.at,
        source: t.source,
        medium: t.medium,
        campaign: t.campaign,
        term: trim(t.term, 100),
        gclid: trim(t.gclid, 120),
        fbclid: trim(t.fbclid, 120),
        video_id: t.video_id,
        affiliate_code: t.affiliate_code,
        landing_page: trim(t.landing_page, 200),
      };
    return { ft: pick(stored.ft), lt: pick(stored.lt) };
  }
}

export default AttributionModule;
