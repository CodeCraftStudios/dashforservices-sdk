/**
 * Subscriptions: the customer portal's Subscribe & Save (filters, cartridges,
 * salt). Mirrors the LostTHC account flows: list, pause, resume, skip, cancel,
 * resubscribe, change plan, change payment and ship-to.
 *
 * Every call needs a signed-in customer: `sd.auth.login()` in the browser, or
 * `sd.asCustomer(token)` on the server. Subscriptions are started by checking
 * out a cart that holds subscription lines, not by a call here.
 *
 * A subscription:
 *   { id, status: "active"|"paused"|"cancelled"|"past_due",
 *     product: { id, name, slug, image }, size: { id, name },
 *     plan: { id, name, interval_length, interval_unit, discount_percent, price },
 *     quantity, next_billing_date, paused_until, last_order_id,
 *     shipping_address, payment_method: { brand, last4 }, created_at }
 *
 * Backend: NEW. /api/site/subscriptions/* (DashForServices "subscriptions"
 * module; billing schedule needs a Django app).
 */

import { seg } from "./_util.js";

export class SubscriptionsModule {
  constructor(client) {
    this.client = client;
  }

  _path(id, action) {
    return `/api/site/subscriptions${id ? `/${seg("subscriptionId", id)}` : ""}${action ? `/${action}` : ""}`;
  }

  _post(id, action, body) {
    return this.client._fetch(this._path(id, action), { method: "POST", auth: true, body: body || {} });
  }

  /** @returns {Promise<{subscriptions: object[]}>} newest first */
  async list({ status } = {}) {
    return this.client._fetch(this._path(), { auth: true, query: { status } });
  }

  /** @returns {Promise<{subscription: object, history: object[]}>} history: skips, pauses, failed charges, plan changes */
  async get(id) {
    return this.client._fetch(this._path(id), { auth: true });
  }

  /**
   * Pause billing, keeping the billing day. Optionally until a date, after
   * which it resumes on its own.
   * @param {string} id
   * @param {{until?: string}} [options] ISO date
   */
  async pause(id, { until } = {}) {
    return this._post(id, "pause", { until });
  }

  /** Resume a paused subscription. A pause past the old date moves the next charge forward, never fires it immediately. */
  async resume(id) {
    return this._post(id, "resume");
  }

  /** Skip the next delivery only. */
  async skip(id) {
    return this._post(id, "skip");
  }

  /**
   * Cancel for good. Terminal; resubscribe() starts a new one on the same plan.
   * @param {{reason?: string, feedback?: string}} [options]
   */
  async cancel(id, { reason, feedback } = {}) {
    return this._post(id, "cancel", { reason, feedback });
  }

  /** Start a new subscription from a cancelled one, same plan and saved card. */
  async resubscribe(id) {
    return this._post(id, "resubscribe");
  }

  /**
   * Move to a different plan (size, cadence, or both) and optionally quantity.
   * Plan ids come from `products.subscriptionPlans(product, sizeId)`.
   */
  async changePlan(id, planId, { quantity } = {}) {
    if (!planId) throw new Error("changePlan: planId is required");
    return this._post(id, "change-plan", { plan_id: planId, quantity });
  }

  /** Move the next refill date (within the plan's allowed window). */
  async reschedule(id, nextDate) {
    if (!nextDate) throw new Error("reschedule: nextDate is required");
    return this._post(id, "reschedule", { next_billing_date: nextDate });
  }

  /** Ship future refills somewhere else. Snapshotted onto the subscription. */
  async updateAddress(id, address) {
    return this._post(id, "update-address", { shipping_address: address });
  }

  /**
   * Point future charges at a different saved card. Returns a Stripe
   * SetupIntent client_secret when the card has to be collected first.
   */
  async updatePayment(id, { paymentMethodId } = {}) {
    return this._post(id, "update-payment", { payment_method_id: paymentMethodId });
  }
}

export default SubscriptionsModule;
