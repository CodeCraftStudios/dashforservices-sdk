/**
 * Refills: what a customer's system needs next (filters, cartridges, salt)
 * and one-tap reorder. Covers buyers who are NOT on Subscribe & Save; their
 * subscriptions live in `sd.subscriptions`.
 *
 *   const { refills } = await me.refills.list();
 *   // [{ id, product: {id, name, slug, image}, size: {id, name}, due_date,
 *   //    status: "due"|"upcoming"|"overdue"|"subscribed", last_order_id,
 *   //    subscription_plans: [...] }]
 *   me.refills.addToCart(refills[0]);           // local cart, one-time
 *   me.refills.addToCart(refills[0], plan.id);  // or switch to subscription
 *
 * Needs a signed-in customer.
 *
 * Backend: NEW. /api/site/refills[/<id>/reorder|/<id>/dismiss]
 * (ServiceDash "subscriptions" module; due dates come from the product's
 * refill_schedule and the customer's orders and installs).
 */

import { seg } from "./_util.js";

export class RefillsModule {
  constructor(client) {
    this.client = client;
  }

  /** @returns {Promise<{refills: object[]}>} soonest first */
  async list() {
    return this.client._fetch("/api/site/refills", { auth: true });
  }

  /**
   * Server-side reorder of the last purchase on the saved card (one tap from a
   * reminder email). Returns the new order, or a checkout url when the card
   * needs confirming.
   * @returns {Promise<{order?: object, url?: string}>}
   */
  async reorder(refillId, { quantity } = {}) {
    return this.client._fetch(`/api/site/refills/${seg("refillId", refillId)}/reorder`, {
      method: "POST",
      auth: true,
      body: { quantity },
    });
  }

  /** Stop reminding about this one (customer replaced it elsewhere, etc.). */
  async dismiss(refillId, { reason } = {}) {
    return this.client._fetch(`/api/site/refills/${seg("refillId", refillId)}/dismiss`, {
      method: "POST",
      auth: true,
      body: { reason },
    });
  }

  /** Put a refill into the local cart (no network). */
  addToCart(refill, planId = null, quantity = 1) {
    return this.client.cart.add({
      productId: refill.product?.id,
      sizeId: refill.size?.id ?? null,
      quantity,
      planId,
      snapshot: {
        name: refill.product?.name,
        sizeName: refill.size?.name,
        image: refill.product?.image,
        slug: refill.product?.slug,
        price: refill.price,
      },
    });
  }
}

export default RefillsModule;
