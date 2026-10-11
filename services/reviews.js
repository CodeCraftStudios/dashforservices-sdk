/**
 * Reviews: product reviews and plumber (installer) reviews.
 *
 *   const { reviews, summary } = await sd.reviews.list({ product: "hydra-48k" });
 *   // summary: { average: 4.8, count: 212, distribution: { 5: 180, 4: 22, ... } }
 *   await sd.reviews.submit({ product: "hydra-48k", rating: 5, title, body, name, email });
 *
 * Submissions are held for moderation and are never live on submit. A review
 * tied to a real order or job (orderId / jobId, or a signed-in customer) is
 * marked verified. Public key OK.
 *
 * Backend: EXISTS for list and summary (/api/site/reviews, /summary): published
 * `review` records. Submitting and "helpful" votes are not built yet.
 */

export class ReviewsModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {Object} query  exactly one of product (slug) / plumber (slug)
   * @param {string} [query.product]
   * @param {string} [query.plumber]
   * @param {number} [query.rating]  only this star rating
   * @param {"recent"|"rating_desc"|"rating_asc"|"helpful"} [query.sort]
   * @param {boolean} [query.withPhotos]
   * @param {number} [query.limit=20]
   * @param {number} [query.offset]
   * @returns {Promise<{reviews: object[], summary: {average: number, count: number, distribution: Record<string, number>}, total: number}>}
   */
  async list(query = {}) {
    const { product, plumber, rating, sort, withPhotos, limit = 20, offset } = query;
    if (!product && !plumber) throw new Error("reviews.list: pass product or plumber");
    return this.client._fetch("/api/site/reviews", {
      query: { product, plumber, rating, sort, with_photos: withPhotos ? "true" : undefined, limit, offset },
      tags: ["servicedash:reviews", `servicedash:reviews:${product || plumber}`],
    });
  }

  /** Rating summary only (cheap; for product cards and JSON-LD). */
  async summary({ product, plumber } = {}) {
    if (!product && !plumber) throw new Error("reviews.summary: pass product or plumber");
    return this.client._fetch("/api/site/reviews/summary", {
      query: { product, plumber },
      tags: ["servicedash:reviews"],
    });
  }

  /**
   * Submit a review (moderated).
   * @param {Object} input
   * @param {string} [input.product]  slug
   * @param {string} [input.plumber]  slug
   * @param {number} input.rating     1-5
   * @param {string} [input.title]
   * @param {string} input.body
   * @param {string} input.name       display name
   * @param {string} [input.email]    never shown; used to verify
   * @param {string} [input.city]
   * @param {string} [input.orderId]
   * @param {string} [input.jobId]
   * @param {string[]} [input.photos] URLs from an upload
   * @param {{honeypot?: string}} [options]
   * @returns {Promise<{id: string, status: "pending"}>}
   */
  async submit(input = {}, { honeypot } = {}) {
    const { product, plumber, rating, title, body, name, email, city, orderId, jobId, photos } = input;
    if (!product && !plumber) throw new Error("reviews.submit: pass product or plumber");
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) throw new Error("reviews.submit: rating must be an integer 1-5");
    if (!body || !name) throw new Error("reviews.submit: body and name are required");
    return this.client._fetch("/api/site/reviews", {
      method: "POST",
      auth: this.client.customerToken ? true : false,
      body: {
        product,
        plumber,
        rating: r,
        title,
        body,
        name,
        email,
        city,
        order_id: orderId,
        job_id: jobId,
        photos,
        _hp: honeypot || "",
      },
    });
  }

  /** "Was this helpful?" One vote per visitor (server dedupes by visitor id + IP hash). */
  async markHelpful(reviewId) {
    let visitorId;
    try {
      visitorId = this.client.insights?.getVisitorId?.();
    } catch {
      visitorId = undefined;
    }
    return this.client._fetch(`/api/site/reviews/${encodeURIComponent(reviewId)}/helpful`, {
      method: "POST",
      body: { visitor_id: visitorId },
    });
  }
}

export default ReviewsModule;
