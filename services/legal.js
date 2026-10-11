/**
 * Legal pages: privacy policy, terms of sale, SMS terms, refund/return
 * policy, install agreement template, accessibility statement.
 *
 *   const { documents } = await sd.legal.list();
 *   const { document }  = await sd.legal.get("privacy-policy");
 *   // { slug, title, body_html, version, effective_at, updated_at }
 *
 * `version` is what agreements and SMS consent reference, so a lead or an
 * order can say exactly which text the customer accepted.
 *
 * Backend: EXISTS. /api/site/legal[/<slug>]: the live version of each published
 * ServiceDash legal document.
 */

import { seg, orNull } from "./_util.js";

export class LegalModule {
  constructor(client) {
    this.client = client;
  }

  /** @returns {Promise<{documents: {slug: string, title: string, version: string, updated_at: string}[]}>} */
  async list() {
    return this.client._fetch("/api/site/legal", { tags: ["servicedash:legal"] });
  }

  /**
   * @param {string} slug
   * @param {{version?: string}} [options] a specific past version (agreement audits)
   * @returns {Promise<{document: object}>}
   */
  async get(slug, { version } = {}) {
    return this.client._fetch(`/api/site/legal/${seg("slug", slug)}`, {
      query: { version },
      tags: ["servicedash:legal", `servicedash:legal:${slug}`],
    });
  }

  /** The document, or null on 404. */
  async document(slug) {
    const res = await orNull(this.get(slug));
    return res?.document ?? null;
  }
}

export default LegalModule;
