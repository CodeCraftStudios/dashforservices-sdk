/**
 * Checkout: turn a cart (or an install quote) into a Stripe payment.
 *
 * Two transports, same request body:
 *
 *  1. PLATFORM (default). POST /api/site/checkout/sessions on Dash4Devs. The
 *     platform reprices the cart, reserves stock, creates the Stripe Checkout
 *     Session (or PaymentIntent) on the tenant's Stripe account, and turns the
 *     webhook into an order. Works with the PUBLIC key from the browser: the
 *     endpoint is `public_write` and trusts nothing but ids and quantities.
 *
 *  2. TENANT ROUTE. `endpoint: "/api/checkout"` posts the same body to the
 *     site's own Next.js route handler (same origin, no site key). That route
 *     can add server-only logic (captcha, a CRM hook, its own Stripe call) and
 *     then forward with the SECRET key: `createSiteClient().checkout.create(body)`.
 *     Use it when the site needs to own part of the flow; otherwise prefer 1.
 *
 *   const session = await sd.checkout.create({
 *     cart: sd.cart, customer: { email, name, phone },
 *     shippingAddress, successUrl: `${origin}/thanks?session={CHECKOUT_SESSION_ID}`,
 *     cancelUrl: `${origin}/cart`,
 *   });
 *   sd.checkout.redirect(session);
 *
 * Subscription lines in the cart make the platform create a Checkout Session
 * in `subscription` mode (or a mixed session with `setup_future_usage`) and
 * schedule the refills; the SDK does nothing different.
 *
 * Backend: NEW (DashForServices "checkout" module, needs a Django app for Stripe
 * webhooks and stock reservations; see docs/backend-modules.md).
 */

import { randomId, seg, hasWindow } from "./_util.js";

function toAddress(a) {
  if (!a) return undefined;
  return {
    name: a.name,
    company: a.company,
    line1: a.line1 ?? a.address1 ?? a.street,
    line2: a.line2 ?? a.address2,
    city: a.city,
    state: a.state,
    postal_code: a.postalCode ?? a.postal_code ?? a.zip,
    country: a.country || "US",
    phone: a.phone,
  };
}

export class CheckoutModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * Build the request body. Exposed so a tenant route can forward it verbatim.
   * @param {Object} input see create()
   */
  buildBody(input = {}) {
    const { cart, customer = {}, shippingAddress, billingAddress, successUrl, cancelUrl, mode, notes, attribution, code, metadata } = input;
    const source = cart ?? this.client.cart;
    const payload = typeof source?.toPayload === "function" ? source.toPayload() : source;
    if (!payload || !Array.isArray(payload.lines) || payload.lines.length === 0) {
      throw new Error("checkout: the cart is empty");
    }
    if (!successUrl || !cancelUrl) throw new Error("checkout: successUrl and cancelUrl are required");
    return {
      cart: payload,
      customer: {
        email: customer.email,
        name: customer.name,
        first_name: customer.firstName ?? customer.first_name,
        last_name: customer.lastName ?? customer.last_name,
        phone: customer.phone,
        customer_type: customer.type ?? customer.customer_type, // "homeowner" | "commercial"
        company: customer.company,
        accepts_marketing: customer.acceptsMarketing,
      },
      shipping_address: toAddress(shippingAddress),
      billing_address: toAddress(billingAddress),
      success_url: successUrl,
      cancel_url: cancelUrl,
      mode: mode || this.client.checkoutDefaults.mode || "session",
      notes,
      code: code ?? payload.code,
      attribution: attribution ?? this._attribution(),
      metadata,
    };
  }

  /**
   * Create a Stripe Checkout Session (mode "session", default) or a
   * PaymentIntent for an embedded Payment Element (mode "payment_intent").
   *
   * @param {Object} input
   * @param {object} [input.cart]  sd.cart (default), or a toPayload() shape
   * @param {{email: string, name?: string, phone?: string, type?: "homeowner"|"commercial", company?: string}} input.customer
   * @param {Object} [input.shippingAddress] { name, line1, line2, city, state, zip, country }
   * @param {Object} [input.billingAddress]
   * @param {string} input.successUrl  may contain {CHECKOUT_SESSION_ID}
   * @param {string} input.cancelUrl
   * @param {"session"|"payment_intent"} [input.mode]
   * @param {string} [input.endpoint]  tenant route (transport 2); defaults to options.checkout.endpoint
   * @param {string} [input.idempotencyKey]  defaults to a fresh id per call
   * @returns {Promise<{url?: string, session_id?: string, client_secret?: string, payment_intent_id?: string, order_id?: string}>}
   */
  async create(input = {}) {
    const body = this.buildBody(input);
    const idem = input.idempotencyKey || randomId("chk_");
    const endpoint = input.endpoint ?? this.client.checkoutDefaults.endpoint;

    if (endpoint) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idem },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error(json?.message || `Checkout failed (${res.status})`);
        err.status = res.status;
        err.code = json?.error;
        err.payload = json;
        throw err;
      }
      return json;
    }

    return this.client._fetch("/api/site/checkout/sessions", {
      method: "POST",
      body,
      headers: { "Idempotency-Key": idem },
    });
  }

  /**
   * Post an already-built body (from buildBody(), e.g. received by a tenant
   * route) to the platform endpoint. Server-side counterpart of transport 2.
   */
  async forward(body, { idempotencyKey } = {}) {
    if (!body?.cart?.lines?.length) throw new Error("checkout.forward: body.cart.lines is empty");
    return this.client._fetch("/api/site/checkout/sessions", {
      method: "POST",
      body,
      headers: { "Idempotency-Key": idempotencyKey || randomId("chk_") },
    });
  }

  /** Send the browser to Stripe's hosted page. */
  redirect(result) {
    const url = typeof result === "string" ? result : result?.url;
    if (!url) throw new Error("checkout.redirect: no url (did you use mode 'payment_intent'?)");
    if (hasWindow()) window.location.assign(url);
    return url;
  }

  /**
   * The order behind a finished session, for the thank-you page.
   * @returns {Promise<{status: "open"|"complete"|"expired", order?: object}>}
   */
  async get(sessionId) {
    return this.client._fetch(`/api/site/checkout/sessions/${seg("sessionId", sessionId)}`, { live: true });
  }

  /**
   * Check out an install quote from its checkout link (/q/<token>).
   *
   * Charges the equipment now to the tenant's Stripe account and saves the
   * card (setup_future_usage=off_session) for the install fee, which the
   * platform later charges as a direct charge on the plumber's Stripe Connect
   * account when the job is marked installed. In Florida (option 1) the
   * install fee is charged now with the system instead; the quote decides.
   *
   * Both agreements must be accepted; the platform records each agreement's
   * version, the signer name, time, IP and user agent as the signature.
   *
   * @param {string} token
   * @param {Object} input
   * @param {boolean} input.acceptPurchaseTerms
   * @param {boolean} input.acceptInstallAgreement
   * @param {string} [input.tier]           "good"|"better"|"best"|"ultimate" if the customer can still choose
   * @param {string} [input.signatureName]  typed signature
   * @param {{purchase_terms?: string, install_agreement?: string}} [input.agreementVersions]
   *   versions the customer was shown (from quotes.get); the server rejects a stale version
   * @param {string} input.successUrl
   * @param {string} input.cancelUrl
   * @returns {Promise<{url: string, session_id: string}>}
   */
  async fromQuote(token, input = {}) {
    const { acceptPurchaseTerms, acceptInstallAgreement, tier, signatureName, agreementVersions, successUrl, cancelUrl, smsConsent } = input;
    if (acceptPurchaseTerms !== true || acceptInstallAgreement !== true) {
      throw new Error("checkout.fromQuote: both the purchase terms and the install agreement must be accepted");
    }
    if (!successUrl || !cancelUrl) throw new Error("checkout.fromQuote: successUrl and cancelUrl are required");
    return this.client._fetch(`/api/site/quotes/${seg("token", token)}/checkout`, {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey || randomId("qchk_") },
      body: {
        accept_purchase_terms: true,
        accept_install_agreement: true,
        tier,
        signature_name: signatureName,
        agreement_versions: agreementVersions,
        sms_consent: smsConsent,
        success_url: successUrl,
        cancel_url: cancelUrl,
        attribution: this._attribution(),
      },
    });
  }

  _attribution() {
    try {
      return this.client.attribution?.snapshot?.() || undefined;
    } catch {
      return undefined;
    }
  }
}

export default CheckoutModule;
