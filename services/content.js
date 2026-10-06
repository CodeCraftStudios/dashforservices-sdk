/**
 * Content: the managed copy a site renders (hero text, section blurbs, FAQs).
 *
 * Rows of the platform's `site_content` type: slug, optional section, title,
 * HTML/markdown body, image and extras. The API returns this site's rows plus
 * the platform-wide shared pool; a site-specific row wins under one slug.
 *
 * Backend: EXISTS today (/api/site/content, module "pages").
 */

import { seg, orNull } from "./_util.js";

export class ContentModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {{section?: string, limit?: number, offset?: number}} [query]
   * @returns {Promise<{content: object[], total: number, limit: number, offset: number}>}
   */
  async list(query = {}) {
    return this.client._fetch("/api/site/content", { query, tags: ["servicedash:content"] });
  }

  /** One row by slug. @returns {Promise<{content: object}>} */
  async get(slug) {
    return this.client._fetch(`/api/site/content/${seg("slug", slug)}`, {
      tags: ["servicedash:content", `servicedash:content:${slug}`],
    });
  }

  /** The row's data, or null on 404, so a page can render a fallback. */
  async data(slug) {
    const res = await orNull(this.get(slug));
    return res?.content?.data ?? null;
  }

  /** Every row of one section keyed by slug: `{ "hero-title": {...data}, ... }`. */
  async section(section) {
    const { content = [] } = await this.list({ section, limit: 200 });
    const out = {};
    for (const row of content) {
      const slug = row?.data?.slug;
      if (slug) out[slug] = row.data;
    }
    return out;
  }
}

export default ContentModule;
