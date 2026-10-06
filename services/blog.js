/**
 * Blog: published posts and categories.
 *
 * Backend: NEW. /api/site/blog/posts[/<slug>], /api/site/blog/categories
 * (ServiceDash "blog" module).
 */

import { seg, orNull } from "./_util.js";

export class BlogModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {Object} [options]
   * @param {number} [options.limit=20]
   * @param {number} [options.offset]
   * @param {number} [options.page]      1-based; converted to offset with limit
   * @param {string} [options.category]  category slug
   * @param {string} [options.tag]
   * @param {string} [options.search]
   * @param {boolean} [options.featured]
   * @param {string} [options.city]      posts tagged to a city page
   * @param {Object} [options.customFields]  sent as cf_<key>=value
   * @returns {Promise<{posts: object[], total: number, limit: number, offset: number}>}
   */
  async list(options = {}) {
    const limit = options.limit || 20;
    const offset = options.page && options.page > 1 ? (options.page - 1) * limit : options.offset;
    return this.client._fetch("/api/site/blog/posts", {
      query: {
        limit,
        offset,
        category: options.category,
        tag: options.tag,
        search: options.search,
        featured: options.featured ? "true" : undefined,
        city: options.city,
        cf: options.customFields,
      },
      tags: ["servicedash:blog"],
    });
  }

  /** One post by slug. @returns {Promise<{post: object}>} */
  async get(slug) {
    return this.client._fetch(`/api/site/blog/posts/${seg("slug", slug)}`, {
      tags: ["servicedash:blog", `servicedash:blog:${slug}`],
    });
  }

  /** The post, or null on 404. */
  async post(slug) {
    const res = await orNull(this.get(slug));
    return res?.post ?? null;
  }

  /** @returns {Promise<{categories: object[]}>} */
  async categories() {
    return this.client._fetch("/api/site/blog/categories", { tags: ["servicedash:blog"] });
  }

  /** Posts related to one post (same category/tags), excluding itself. */
  async related(slug, { limit = 3 } = {}) {
    return this.client._fetch(`/api/site/blog/posts/${seg("slug", slug)}/related`, {
      query: { limit },
      tags: ["servicedash:blog"],
    });
  }
}

export default BlogModule;
