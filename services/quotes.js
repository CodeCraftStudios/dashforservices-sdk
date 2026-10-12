/**
 * Quotes: the install quote behind a checkout link (/q/<token>).
 *
 * A booking rep builds the quote in the DashForServices CRM (system size picked
 * from people in the home + zip hardness; Good, Better, Best, Ultimate) and
 * texts the link. The page reads it with the token alone: no sign-in, the
 * unguessable token is the credential, and it expires.
 *
 *   { token, status: "sent"|"viewed"|"accepted"|"expired"|"void",
 *     expires_at, customer: { first_name, city, state, zip },
 *     household_size, water_source, hardness_gpg,
 *     packages: [{ tier: "good"|"better"|"best"|"ultimate", name, system,
 *                  equipment_price, install_fee, features[], recommended }],
 *     selected_tier, can_change_tier,
 *     plumber: { company, license_number, license_state, rating },
 *     install: { price, proposed_date, fee_timing: "on_completion"|"at_booking" },
 *     agreements: {
 *       purchase_terms:    { key, version, title, body_html },
 *       install_agreement: { key, version, title, body_html } } }  // filled with plumber company, price, date
 *
 * Pay with `sd.checkout.fromQuote(token, {...})`.
 *
 * Backend: NEW. /api/site/quotes/<token>[/select|/viewed|/checkout]
 * (DashForServices "quotes" module).
 */

import { seg } from "./_util.js";

export const QUOTE_TIERS = Object.freeze(["good", "better", "best", "ultimate"]);

export class QuotesModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * Read a quote by its link token. Live (never cached). Marks it viewed
   * server-side, which stops the "quote sent, not opened" follow-up.
   * @returns {Promise<{quote: object}>}
   */
  async get(token) {
    return this.client._fetch(`/api/site/quotes/${seg("token", token)}`, { live: true });
  }

  /** Switch package before paying (only when quote.can_change_tier). */
  async select(token, tier) {
    if (!QUOTE_TIERS.includes(tier)) throw new Error(`quotes.select: tier must be one of ${QUOTE_TIERS.join(", ")}`);
    return this.client._fetch(`/api/site/quotes/${seg("token", token)}/select`, { method: "POST", body: { tier } });
  }

  /** Customer has a question: pings the rep and logs it on the lead timeline. */
  async ask(token, { message, preferredContact } = {}) {
    if (!message) throw new Error("quotes.ask: message is required");
    return this.client._fetch(`/api/site/quotes/${seg("token", token)}/questions`, {
      method: "POST",
      body: { message, preferred_contact: preferredContact },
    });
  }

  /** Pay for it. Shortcut for `sd.checkout.fromQuote(token, input)`. */
  async checkout(token, input) {
    return this.client.checkout.fromQuote(token, input);
  }
}

export default QuotesModule;
