/**
 * Page groups: structured content collections edited in the ServiceDash
 * dashboard under Website -> Page groups. Service pages, city pages, cost
 * calculator pages, water-quality reports per city, FAQs, team.
 *
 * Each group has a slug and published items. An item carries title, slug,
 * content (HTML), excerpt, featured_image, custom_fields, metadata and seo.
 *
 *   const { items } = await sd.pageGroup("cities").all();
 *   const { item }  = await sd.pageGroup("cities").get("phoenix-az");
 *   const az        = await sd.pageGroup("cities").filter({ state: "AZ" });
 *
 * Backend: EXISTS. /api/site/page-groups/<group>[/<item>] (module "pages"): the
 * org's published page_item records from the dashboard's Website > Pages.
 */

import { seg } from "./_util.js";

function matches(item, spec) {
  for (const [key, want] of Object.entries(spec)) {
    const got = item?.[key] ?? item?.metadata?.[key] ?? item?.custom_fields?.[key];
    if (Array.isArray(want) ? !want.includes(got) : got !== want) return false;
  }
  return true;
}

/** Fluent builder for one group. Get it from `sd.pageGroup(slug)`. */
export class PageGroup {
  constructor(client, slug) {
    if (!slug || typeof slug !== "string") {
      throw new Error("pageGroup(slug): slug must be a non-empty string");
    }
    this.client = client;
    this.slug = slug;
  }

  get _tags() {
    return ["servicedash:page-groups", `servicedash:page-group:${this.slug}`];
  }

  /**
   * Every published item (paged).
   * @param {{limit?: number, offset?: number, sort?: string}} [options]
   * @returns {Promise<{group: object, items: object[], total: number}>}
   */
  async all(options = {}) {
    return this.client._fetch(`/api/site/page-groups/${seg("slug", this.slug)}`, {
      query: { limit: options.limit, offset: options.offset, sort: options.sort },
      tags: this._tags,
    });
  }

  /** One item by slug. @returns {Promise<{item: object}>} */
  async get(itemSlug) {
    return this.client._fetch(`/api/site/page-groups/${seg("slug", this.slug)}/${seg("itemSlug", itemSlug)}`, {
      tags: [...this._tags, `servicedash:page-group:${this.slug}:${itemSlug}`],
    });
  }

  /**
   * Filter client-side by predicate, or by an object spec matched against top
   * level fields, then metadata, then custom_fields. An array value means
   * "any of". Fine for groups up to a few hundred items.
   */
  async filter(predicate, options = {}) {
    const { items = [] } = await this.all({ limit: 500, ...options });
    if (typeof predicate === "function") return items.filter(predicate);
    if (predicate && typeof predicate === "object") return items.filter((item) => matches(item, predicate));
    return items;
  }

  /** First match or null. */
  async find(predicate) {
    const found = await this.filter(predicate);
    return found[0] ?? null;
  }

  /** Item count without fetching every item. */
  async count() {
    const { total = 0 } = await this.all({ limit: 1 });
    return total;
  }

  /** Every item slug, for generateStaticParams(). */
  async slugs() {
    const { items = [] } = await this.all({ limit: 1000 });
    return items.map((i) => i.slug).filter(Boolean);
  }
}

export class PageGroupsModule {
  constructor(client) {
    this.client = client;
  }

  /** Every published group (metadata + item_count, not items). */
  async list() {
    return this.client._fetch("/api/site/page-groups", { tags: ["servicedash:page-groups"] });
  }

  group(slug) {
    return new PageGroup(this.client, slug);
  }
}

export default PageGroupsModule;
