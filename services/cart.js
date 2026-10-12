/**
 * Cart: local-first, with server sync.
 *
 * The cart lives in the visitor's browser (localStorage `sd_cart`) so adding
 * to cart is instant and works before the platform's cart endpoint exists.
 * `sync()` pushes it to the platform, which reprices every line (the browser's
 * prices are display snapshots and are never trusted), applies stock and
 * subscription rules and returns totals; the server's answer wins.
 *
 * A line is either one-time or a subscription:
 *   { key, productId, sizeId, quantity, purchase: "one_time"|"subscription",
 *     planId, snapshot: { name, sizeName, price, image, slug, planName, discountPercent } }
 *
 * A subscription line never merges with a one-time line for the same size, and
 * two cadences of one size stay separate; the same cadence merges.
 *
 *   sd.cart.add({ productId, sizeId, quantity: 2, snapshot: { name, price } });
 *   sd.cart.add({ productId, sizeId, planId: plan.id, snapshot: { name, price: plan.price } });
 *   const off = sd.cart.subscribe((state) => render(state));
 *   await sd.cart.sync();
 *
 * On the server the storage is in-memory and per client instance, so do not
 * hold a visitor's cart in a module-level server client; carts are a browser
 * concern (see react/useCart).
 *
 * Backend: NEW. POST /api/site/carts (upsert), GET /api/site/carts/<id>
 * (DashForServices "carts" module).
 */

import { createStorage, readJSON, writeJSON, seg, hasWindow } from "./_util.js";

const STORAGE_KEY = "sd_cart";
const EMPTY = Object.freeze({ id: null, lines: [], totals: null, warnings: [], updatedAt: null });

function lineKey(productId, sizeId, planId) {
  return `${productId}:${sizeId ?? ""}:${planId ? `plan-${planId}` : "once"}`;
}

export class CartModule {
  /**
   * @param {object} client
   * @param {{storage?: object, storageKey?: string, autoSync?: boolean, syncDelayMs?: number}} [options]
   */
  constructor(client, options = {}) {
    this.client = client;
    this._storage = createStorage(options.storage);
    this._storageKey = options.storageKey || STORAGE_KEY;
    this.autoSync = Boolean(options.autoSync);
    this._syncDelayMs = options.syncDelayMs ?? 800;
    this._listeners = new Set();
    this._syncTimer = null;
    this._onStorage = this._onStorage.bind(this);
    this._state = this._read();
  }

  // ─── Reading ────────────────────────────────────────────────────────────

  /** Snapshot of the whole cart. Treat as immutable. */
  get state() {
    return this._state;
  }
  get id() {
    return this._state.id;
  }
  get lines() {
    return this._state.lines;
  }
  /** Total units across lines. */
  get count() {
    return this._state.lines.reduce((n, l) => n + l.quantity, 0);
  }
  get isEmpty() {
    return this._state.lines.length === 0;
  }
  get hasSubscription() {
    return this._state.lines.some((l) => l.purchase === "subscription");
  }

  /**
   * Display subtotal. The server's figure after sync() when present,
   * otherwise the sum of snapshot prices. Never use this to charge.
   */
  get subtotal() {
    if (this._state.totals?.subtotal !== undefined) return Number(this._state.totals.subtotal);
    const cents = this._state.lines.reduce(
      (sum, l) => sum + Math.round((Number(l.snapshot?.price) || 0) * 100) * l.quantity,
      0
    );
    return cents / 100;
  }

  /** Server totals from the last sync: { subtotal, discount, shipping, tax, total, currency }. */
  get totals() {
    return this._state.totals;
  }

  line(key) {
    return this._state.lines.find((l) => l.key === key) || null;
  }

  // ─── Writing (local, synchronous) ───────────────────────────────────────

  /**
   * Add a line, or add quantity to a matching one.
   * @param {Object} item
   * @param {string} item.productId
   * @param {string} [item.sizeId]
   * @param {number} [item.quantity=1]
   * @param {string} [item.planId]   subscription plan id; omit for one-time
   * @param {Object} [item.snapshot] display data { name, sizeName, price, image, slug, planName, discountPercent }
   * @returns {object} the line
   */
  add({ productId, sizeId = null, quantity = 1, planId = null, snapshot = {} } = {}) {
    if (!productId) throw new Error("cart.add: productId is required");
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    const key = lineKey(productId, sizeId, planId);
    const lines = [...this._state.lines];
    const idx = lines.findIndex((l) => l.key === key);
    if (idx >= 0) {
      lines[idx] = { ...lines[idx], quantity: lines[idx].quantity + qty, snapshot: { ...lines[idx].snapshot, ...snapshot } };
    } else {
      lines.push({
        key,
        productId: String(productId),
        sizeId: sizeId === null ? null : String(sizeId),
        quantity: qty,
        purchase: planId ? "subscription" : "one_time",
        planId: planId ? String(planId) : null,
        snapshot,
      });
    }
    this._commit({ lines });
    return lines.find((l) => l.key === key);
  }

  /** Set a line's quantity; 0 or less removes it. */
  update(key, quantity) {
    const qty = Math.floor(Number(quantity) || 0);
    if (qty <= 0) return this.remove(key);
    this._commit({ lines: this._state.lines.map((l) => (l.key === key ? { ...l, quantity: qty } : l)) });
    return this.line(key);
  }

  /**
   * Switch a line between one-time and a subscription plan (or between plans).
   * Merges into an existing line with the same target key.
   */
  setPlan(key, planId, snapshot = {}) {
    const current = this.line(key);
    if (!current) return null;
    const rest = this._state.lines.filter((l) => l.key !== key);
    this._state = { ...this._state, lines: rest };
    return this.add({
      productId: current.productId,
      sizeId: current.sizeId,
      quantity: current.quantity,
      planId: planId || null,
      snapshot: { ...current.snapshot, ...snapshot },
    });
  }

  remove(key) {
    this._commit({ lines: this._state.lines.filter((l) => l.key !== key) });
    return null;
  }

  /** Empty the cart (keeps nothing, including the server cart id). */
  clear() {
    this._commit({ ...EMPTY, lines: [] }, { sync: false });
  }

  /** Attach an affiliate / promo code to the cart; sent on sync and checkout. */
  setCode(code) {
    this._commit({ code: code || null });
  }

  // ─── Server sync ────────────────────────────────────────────────────────

  /** The wire shape the platform cart and checkout endpoints take. */
  toPayload() {
    return {
      cart_id: this._state.id || undefined,
      code: this._state.code || undefined,
      lines: this._state.lines.map((l) => ({
        key: l.key,
        product_id: l.productId,
        size_id: l.sizeId,
        quantity: l.quantity,
        plan_id: l.planId,
      })),
    };
  }

  /**
   * Push the cart to the platform and adopt its answer: cart id, repriced
   * lines (matched by key), totals and warnings (out of stock, plan retired).
   * Lines the server dropped are dropped locally too.
   * @returns {Promise<object>} the new state
   */
  async sync() {
    clearTimeout(this._syncTimer);
    const res = await this.client._fetch("/api/site/carts", { method: "POST", body: this.toPayload() });
    this._adopt(res?.cart);
    return this._state;
  }

  /** Replace the local cart with a server cart (e.g. from a recovery link). */
  async load(cartId) {
    const res = await this.client._fetch(`/api/site/carts/${seg("cartId", cartId)}`, { live: true });
    this._adopt(res?.cart, { replace: true });
    return this._state;
  }

  /** Re-read storage (call after hydration, or when another tab changed it). */
  hydrate() {
    this._state = this._read();
    this._emit();
    return this._state;
  }

  /**
   * Listen to changes. Also follows other tabs via the `storage` event.
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this._listeners.add(listener);
    if (this._listeners.size === 1 && hasWindow()) window.addEventListener("storage", this._onStorage);
    return () => {
      this._listeners.delete(listener);
      if (this._listeners.size === 0 && hasWindow()) window.removeEventListener("storage", this._onStorage);
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  _read() {
    const saved = readJSON(this._storage, this._storageKey, null);
    if (!saved || !Array.isArray(saved.lines)) return { ...EMPTY, lines: [] };
    return { ...EMPTY, ...saved };
  }

  _commit(patch, { sync = true } = {}) {
    // Any local edit invalidates server totals until the next sync.
    this._state = { ...this._state, totals: null, warnings: [], ...patch, updatedAt: new Date().toISOString() };
    writeJSON(this._storage, this._storageKey, this._state);
    this._emit();
    if (sync && this.autoSync) {
      clearTimeout(this._syncTimer);
      this._syncTimer = setTimeout(() => this.sync().catch(() => {}), this._syncDelayMs);
    }
  }

  _adopt(cart, { replace = false } = {}) {
    if (!cart) return;
    const serverLines = Array.isArray(cart.lines) ? cart.lines : [];
    const local = new Map(this._state.lines.map((l) => [l.key, l]));
    const lines = serverLines.map((s) => {
      const key = s.key || lineKey(s.product_id, s.size_id, s.plan_id);
      const prev = replace ? null : local.get(key);
      return {
        key,
        productId: String(s.product_id),
        sizeId: s.size_id === null || s.size_id === undefined ? null : String(s.size_id),
        quantity: Number(s.quantity) || 1,
        purchase: s.plan_id ? "subscription" : "one_time",
        planId: s.plan_id ? String(s.plan_id) : null,
        snapshot: { ...(prev?.snapshot || {}), ...(s.snapshot || {}), ...(s.unit_price !== undefined ? { price: Number(s.unit_price) } : {}) },
      };
    });
    this._state = {
      ...this._state,
      id: cart.id || this._state.id,
      code: cart.code ?? this._state.code ?? null,
      lines,
      totals: cart.totals || null,
      warnings: cart.warnings || [],
      updatedAt: new Date().toISOString(),
    };
    writeJSON(this._storage, this._storageKey, this._state);
    this._emit();
  }

  _onStorage(e) {
    if (e.key === this._storageKey) this.hydrate();
  }

  _emit() {
    for (const fn of this._listeners) {
      try {
        fn(this._state);
      } catch {
        /* a listener must not break the cart */
      }
    }
  }
}

export default CartModule;
