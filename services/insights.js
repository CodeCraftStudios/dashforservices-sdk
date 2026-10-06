/**
 * Insights: first-party analytics (pageviews, CTA clicks, conversions).
 * Also available as `sd.tracking`.
 *
 *   sd.insights.init();                                   // pageviews + session, once in the root layout
 *   sd.insights.track("cta_click", { label: "Get my price", href: "/quote" });
 *   sd.insights.trackClick("cta_click", { label: "Call now", href: "tel:+16025550142" });
 *   sd.insights.pageview();                               // manual, if autoPageviews is off
 *
 * - Batched: events queue in memory and flush every few seconds, at 20
 *   events, and with navigator.sendBeacon when the tab hides or unloads
 *   (the key rides in ?k= because beacons cannot set headers).
 * - Visitor id: a random first-party id in localStorage (`sd_vid`); sessions
 *   roll after 30 idle minutes (`sd_ses`).
 * - Respects Do Not Track and Global Privacy Control by default: when either
 *   is on, nothing is stored and nothing is sent. `respectDNT: false` to opt out.
 * - Fire-and-forget: every failure is silent. Analytics never breaks a site.
 *
 * Backend contract (Dash4Devs platforms/insights_views.py, module "websites"):
 *   POST /api/site/insights?k=<site key>   body is JSON, any Content-Type
 *   {
 *     visitor_id, session_id,
 *     attribution: { ft: {source, medium, campaign, term, content, referrer, landing, at},
 *                    lt: {source, medium, campaign} },
 *     device: { type, browser, os, screen },
 *     events: [ { type: "pageview"|"click"|"session_start"|"custom", name, path,
 *                 referrer, title, ts (epoch ms), session_id,
 *                 el: {tag, text, href, id, outbound}, props: {...} } ]   // max 100
 *   }
 * The key rides in ?k= and the body is sent as text/plain, so neither fetch
 * nor sendBeacon needs a CORS preflight. A `session_start` event is what the
 * platform counts as a new session for the visitor. Reports read back through
 * GET /api/platform/sites/<website id>/insights?days=N (platform key).
 */

import { createStorage, doNotTrack, hasWindow, randomId } from "./_util.js";

const VISITOR_KEY = "sd_vid";
const SESSION_KEY = "sd_ses";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_QUEUE = 20;
/** The platform drops anything past 100 events in one batch. */
const MAX_BATCH = 100;
/** Bounded so an offline tab can't grow the queue forever. */
const MAX_PENDING = 200;
const ATTR_FIELDS = ["source", "medium", "campaign", "term", "content", "referrer"];

export class InsightsModule {
  /**
   * @param {object} client
   * @param {{storage?: object}} [options]
   */
  constructor(client, options = {}) {
    this.client = client;
    this._storage = createStorage(options.storage);
    this._queue = [];
    this._booted = false;
    this._started = false;
    this._timer = null;
    this._lastPath = null;
    this._visitorId = null;
    this._sessionId = null;
    this._opts = { autoPageviews: true, autoClicks: "tagged", flushIntervalMs: 5000, respectDNT: true };
    this._onClick = this._onClick.bind(this);
    this._onHide = this._onHide.bind(this);
    this._onPageHide = () => this.flush(true);
    this._onPop = () => setTimeout(() => this.notifyRouteChange(), 0);
    this._restoreHistory = null;
  }

  /** False when DNT/GPC is on (and respected) or on the server. */
  get enabled() {
    if (!hasWindow()) return false;
    return !(this._opts.respectDNT && doNotTrack());
  }

  /**
   * Start collecting. Idempotent; no-op on the server and under DNT.
   * @param {{autoPageviews?: boolean, autoClicks?: boolean|"tagged", flushIntervalMs?: number, respectDNT?: boolean}} [options]
   *   autoClicks: "tagged" (default) records clicks on elements with data-track="<event name>";
   *   true records every link/button click; false records none.
   */
  init(options = {}) {
    this._opts = { ...this._opts, ...options };
    if (!this.enabled) return { active: false };
    if (this._started) return { active: true };
    this._started = true;
    this._boot();
    try {
      this.client.attribution?.capture?.();
    } catch {
      /* optional */
    }
    if (this._opts.autoPageviews) {
      this._lastPath = this._path();
      this.pageview();
      this._patchHistory();
    }
    if (this._opts.autoClicks) document.addEventListener("click", this._onClick, true);
    return { active: true };
  }

  /** Stop collecting, remove listeners, flush what is queued. */
  destroy() {
    if (!hasWindow()) return;
    document.removeEventListener("click", this._onClick, true);
    document.removeEventListener("visibilitychange", this._onHide);
    window.removeEventListener("pagehide", this._onPageHide);
    if (this._restoreHistory) this._restoreHistory();
    clearInterval(this._timer);
    this._started = false;
    this._booted = false;
    this.flush(true);
  }

  // ─── Capture ────────────────────────────────────────────────────────────

  /** Record a pageview (automatic after init unless autoPageviews is false). */
  pageview(path) {
    if (!this.enabled) return;
    this._enqueue("pageview", {
      path: path || this._path(),
      referrer: document.referrer || "",
      title: document.title || "",
    });
  }

  /**
   * A named event: `track("cta_click", { label, href })`, `track("calculator_used", { household: 4 })`.
   * Events whose props carry an `href` are recorded as clicks so they land in
   * the click reports as well.
   */
  track(name, props = {}) {
    if (!name || !this.enabled) return;
    const p = props && typeof props === "object" ? props : {};
    if (p.href !== undefined) return this.trackClick(name, p);
    this._enqueue("custom", { name: String(name), path: this._path(), props: p });
  }

  /** A click on a CTA, link or phone number. */
  trackClick(name, { label = "", href = "", id = "", ...props } = {}) {
    if (!this.enabled) return;
    let outbound = false;
    if (href && /^https?:\/\//i.test(href)) {
      try {
        outbound = new URL(href, window.location.href).hostname !== window.location.hostname;
      } catch {
        /* ignore */
      }
    }
    this._enqueue("click", {
      name: String(name || label || href || "click").slice(0, 200),
      path: this._path(),
      el: { tag: String(props.tag || ""), text: String(label).slice(0, 300), href: String(href).slice(0, 600), id: String(id), outbound },
      props: { label, href, ...props },
    });
    // Outbound links and tel:/mailto: often leave the page at once.
    if (outbound || /^(tel|mailto|sms):/i.test(href)) this.flush(true);
  }

  /** A goal (lead sent, checkout started, purchase). Flushed immediately. */
  conversion(name = "conversion", props = {}) {
    if (!this.enabled) return;
    this._enqueue("custom", { name, path: this._path(), props: { ...props, conversion: true } });
    this.flush();
  }

  /** App Router hook: a pageview when the path actually changed. */
  notifyRouteChange(path) {
    if (!this.enabled) return;
    const next = path || this._path();
    if (next === this._lastPath) return;
    this._lastPath = next;
    this.pageview(next);
  }

  getVisitorId() {
    if (!this.enabled) return "";
    this._ensureVisitor();
    return this._visitorId;
  }

  getSessionId() {
    if (!this.enabled) return "";
    this._ensureSession();
    return this._sessionId;
  }

  // ─── Queue ──────────────────────────────────────────────────────────────

  /**
   * Send what is queued. Beacon when leaving the page, fetch keepalive
   * otherwise. Re-queues on network failure.
   */
  flush(useBeacon = false) {
    if (!hasWindow() || this._queue.length === 0 || !this.client?.key) return;
    while (this._queue.length) {
      const events = this._queue.splice(0, MAX_BATCH);
      this._send(events, useBeacon);
    }
  }

  _send(events, useBeacon) {
    const envelope = {
      visitor_id: this._visitorId || this.getVisitorId(),
      session_id: this._sessionId || "",
      attribution: this._attribution(),
      device: this._device(),
      events,
    };
    const url = `${this.client.baseURL}/api/site/insights?k=${encodeURIComponent(this.client.key)}`;
    const body = JSON.stringify(envelope);
    // text/plain keeps both transports "simple" requests: no preflight, and
    // sendBeacon never refuses the payload over its content type.
    const type = "text/plain;charset=UTF-8";
    try {
      if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        if (navigator.sendBeacon(url, new Blob([body], { type }))) return;
      }
      fetch(url, { method: "POST", headers: { "Content-Type": type }, body, keepalive: body.length < 60000, credentials: "omit" })
        .then((res) => {
          if (res.status === 429 || res.status >= 500) this._requeue(events);
        })
        .catch(() => this._requeue(events));
    } catch {
      this._requeue(events);
    }
  }

  _requeue(events) {
    this._queue.unshift(...events);
    if (this._queue.length > MAX_PENDING) this._queue.splice(0, this._queue.length - MAX_PENDING);
  }

  _enqueue(type, fields) {
    this._boot();
    // 30 idle minutes on an open tab roll the session; the platform only counts
    // a new session when it sees session_start.
    if (this._ensureSession()) this._queue.push({ type: "session_start", ts: Date.now(), session_id: this._sessionId });
    this._queue.push({ type, ts: Date.now(), session_id: this._sessionId, ...fields });
    if (this._queue.length > MAX_PENDING) this._queue.splice(0, this._queue.length - MAX_PENDING);
    if (this._queue.length >= MAX_QUEUE) this.flush();
  }

  /** Identity + unload listeners + flush timer; runs on first event or init(). */
  _boot() {
    if (this._booted || !hasWindow()) return;
    this._booted = true;
    this._ensureVisitor();
    if (this._ensureSession()) this._queue.push({ type: "session_start", ts: Date.now(), session_id: this._sessionId });
    document.addEventListener("visibilitychange", this._onHide);
    window.addEventListener("pagehide", this._onPageHide);
    this._timer = setInterval(() => this.flush(), this._opts.flushIntervalMs);
  }

  _onHide() {
    if (document.visibilityState === "hidden") this.flush(true);
  }

  _onClick(e) {
    try {
      const mode = this._opts.autoClicks;
      const selector = mode === "tagged" ? "[data-track]" : "a, button, [role=button], [data-track], input[type=submit]";
      const el = e.target?.closest?.(selector);
      if (!el || el.closest("[data-no-track]")) return;
      // <TrackClick> already records its own clicks.
      if (el.hasAttribute("data-sd-tracked")) return;
      const label = (el.getAttribute("data-track-label") || el.innerText || el.getAttribute("aria-label") || el.value || "")
        .trim()
        .slice(0, 200);
      this.trackClick(el.getAttribute("data-track") || "click", {
        label,
        href: el.getAttribute("href") || "",
        id: el.id || "",
        tag: (el.tagName || "").toLowerCase(),
      });
    } catch {
      /* never throw into a click handler */
    }
  }

  // ─── Identity ───────────────────────────────────────────────────────────

  _ensureVisitor() {
    if (this._visitorId) return;
    let id = this._storage.getItem(VISITOR_KEY);
    if (!id) {
      id = randomId("v_");
      this._storage.setItem(VISITOR_KEY, id);
    }
    this._visitorId = id;
  }

  /** @returns {boolean} true when a new session started */
  _ensureSession() {
    const now = Date.now();
    let s = null;
    try {
      s = JSON.parse(this._storage.getItem(SESSION_KEY) || "null");
    } catch {
      s = null;
    }
    let isNew = false;
    if (!s?.id || now - (s.ts || 0) > SESSION_IDLE_MS) {
      s = { id: randomId("s_"), ts: now };
      isNew = true;
    } else {
      s.ts = now;
    }
    this._sessionId = s.id;
    this._storage.setItem(SESSION_KEY, JSON.stringify(s));
    return isNew;
  }

  // ─── Env ────────────────────────────────────────────────────────────────

  /** Map the attribution module's touches onto the platform's ft/lt keys. */
  _attribution() {
    const pick = (t, full) => {
      if (!t || typeof t !== "object") return {};
      const out = {};
      for (const k of full ? ATTR_FIELDS : ATTR_FIELDS.slice(0, 3)) if (t[k]) out[k] = String(t[k]);
      if (full) {
        if (t.landing_page || t.landing) out.landing = String(t.landing_page || t.landing);
        if (t.at) out.at = t.at;
      }
      return out;
    };
    try {
      const a = this.client.attribution?.get?.();
      if (!a) return { ft: {}, lt: {} };
      return { ft: pick(a.first_touch, true), lt: pick(a.last_touch, false) };
    } catch {
      return { ft: {}, lt: {} };
    }
  }

  _path() {
    return hasWindow() ? window.location.pathname + window.location.search : "";
  }

  _patchHistory() {
    const fire = () => setTimeout(() => this.notifyRouteChange(), 0);
    const push = history.pushState;
    const replace = history.replaceState;
    history.pushState = function (...a) {
      push.apply(this, a);
      fire();
    };
    history.replaceState = function (...a) {
      replace.apply(this, a);
      fire();
    };
    window.addEventListener("popstate", this._onPop);
    this._restoreHistory = () => {
      history.pushState = push;
      history.replaceState = replace;
      window.removeEventListener("popstate", this._onPop);
      this._restoreHistory = null;
    };
  }

  _device() {
    if (typeof navigator === "undefined") return {};
    const ua = navigator.userAgent || "";
    let type = "desktop";
    if (/iPad|Tablet/i.test(ua)) type = "tablet";
    else if (/Mobi|Android|iPhone|iPod/i.test(ua)) type = "mobile";
    let browser = "other";
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
    else if (/Chrome\//.test(ua)) browser = "Chrome";
    else if (/Safari\//.test(ua)) browser = "Safari";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    let os = "other";
    if (/Windows/.test(ua)) os = "Windows";
    else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
    else if (/Mac OS X/.test(ua)) os = "macOS";
    else if (/Android/.test(ua)) os = "Android";
    else if (/Linux/.test(ua)) os = "Linux";
    const screen = window.screen ? `${window.screen.width}x${window.screen.height}` : "";
    return { type, browser, os, screen };
  }
}

export default InsightsModule;
