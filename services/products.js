/**
 * Products: the store catalog (softeners, RO systems, shower heads, filters,
 * cartridges, salt) and each size's Subscribe & Save plans.
 *
 * A product record's data:
 *   { slug, name, category, description, price, compare_at_price, main_image,
 *     images[], certification ("NSF"|"WQA"|...), kind ("system"|"store"),
 *     sizes: [{ id, name, sku, price, compare_at_price, stock_status,
 *               subscription_plans: [{ id, name, interval_length,
 *                 interval_unit: "days"|"months", discount_percent, price }] }],
 *     refill_schedule: { interval_length, interval_unit } }
 *
 * Plans belong to ONE size and carry ONE interval and ONE discount, so
 * "10-inch sediment cartridge every 3 months at 15% off" is a plan; moving
 * size or cadence means moving to a different plan (subscriptions.changePlan).
 *
 * Backend: list/get/categories EXIST today (/api/site/products, /api/site/categories,
 * module "inventory"). `search`, `sizes[]` and `subscription_plans` on the
 * payload are NEW (ServiceDash "subscriptions" + "inventory" extensions).
 */

import { seg, orNull } from "./_util.js";

export class ProductsModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {{category?: string, search?: string, kind?: string, limit?: number, offset?: number}} [query]
   * @returns {Promise<{products: object[], total: number, limit: number, offset: number}>}
   */
  async list(query = {}) {
    return this.client._fetch("/api/site/products", { query, tags: ["servicedash:products"] });
  }

  /** One product by slug. @returns {Promise<{product: object}>} */
  async get(slug) {
    return this.client._fetch(`/api/site/products/${seg("slug", slug)}`, {
      tags: ["servicedash:products", `servicedash:product:${slug}`],
    });
  }

  /** The product's data, or null on 404. */
  async data(slug) {
    const res = await orNull(this.get(slug));
    return res?.product?.data ?? null;
  }

  /** Free-text search. Live (uncached) because queries are unbounded. */
  async search(q, { limit = 20, category } = {}) {
    return this.client._fetch("/api/site/products", { query: { search: q, limit, category }, live: true });
  }

  /** @returns {Promise<{categories: object[]}>} */
  async categories() {
    return this.client._fetch("/api/site/categories", { tags: ["servicedash:categories"] });
  }

  /** One category by slug. @returns {Promise<{category: object}>} */
  async category(slug) {
    return this.client._fetch(`/api/site/categories/${seg("slug", slug)}`, { tags: ["servicedash:categories"] });
  }

  // ─── Pure helpers (no network) ──────────────────────────────────────────

  /**
   * A product's purchasable sizes. Reads `data.sizes`; falls back to the
   * legacy `variants[0].options` shape the existing inventory module serves.
   * Accepts a record ({data}) or its data.
   */
  sizes(product) {
    const data = product?.data ?? product ?? {};
    if (Array.isArray(data.sizes) && data.sizes.length) return data.sizes;
    const variant = Array.isArray(data.variants) ? data.variants[0] : null;
    if (!variant?.options) return [];
    return variant.options.map((o, i) => ({
      id: o.id || `${data.slug || "p"}-${i}`,
      name: o.name,
      price: o.price ?? data.price ?? null,
      subscription_plans: o.subscription_plans || [],
    }));
  }

  /** Subscribe & Save plans for one size (empty array when it has none). */
  subscriptionPlans(product, sizeId) {
    const size = this.sizes(product).find((s) => String(s.id) === String(sizeId));
    return size?.subscription_plans || [];
  }

  /** Does any size of this product sell on subscription? */
  isSubscribable(product) {
    return this.sizes(product).some((s) => (s.subscription_plans || []).length > 0);
  }

  /**
   * Per-cycle price of a plan for display. The server's figure (`plan.price`)
   * wins; otherwise base price less the plan's discount, rounded to cents.
   */
  planPrice(basePrice, plan) {
    if (plan?.price !== undefined && plan?.price !== null) return Number(plan.price);
    const base = Number(basePrice) || 0;
    const pct = Number(plan?.discount_percent) || 0;
    return Math.round(base * (100 - pct)) / 100;
  }

  /** "Every 3 months", "Every 30 days", "Monthly". */
  cadence(plan) {
    if (!plan) return "";
    const n = Number(plan.interval_length) || 1;
    const unit = plan.interval_unit === "days" ? "day" : "month";
    if (n === 1) return unit === "month" ? "Monthly" : "Daily";
    return `Every ${n} ${unit}s`;
  }
}

export default ProductsModule;
