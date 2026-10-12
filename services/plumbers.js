/**
 * Plumbers: the public installer directory.
 *
 * Plumbing partners pay to be listed; the directory shows their public
 * profile only (company, licence, service area, rating, photo). It never
 * exposes rate cards, payouts or routing rules.
 *
 *   const { plumbers } = await sd.plumbers.search({ zip: "85004" });
 *   const { plumbers } = await sd.plumbers.search({ state: "AZ", county: "Maricopa" });
 *   const { plumber }  = await sd.plumbers.get("desert-flow-plumbing");
 *   await sd.plumbers.requestInstall({ plumber: "desert-flow-plumbing", name, phone, zip, smsConsent: true, ... });
 *
 * A plumber profile:
 *   { slug, company, logo, photo, bio, city, state, counties[], zips_served_count,
 *     license: { number, state, verified, expires_on }, insured: boolean,
 *     services: ["softener_install", "ro_install", "water_test", "repair"],
 *     rating: { average, count }, years_in_business, featured, badges[] }
 *
 * Backend: NEW. /api/site/plumbers[/<slug>], /api/site/plumbers/install-requests
 * (DashForServices "plumbers" module; install requests feed "dispatch").
 */

import { seg } from "./_util.js";

export class PlumbersModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * Search the directory. Give a zip (best: uses the service-area table), or
   * state + county/city.
   * @param {{zip?: string, state?: string, county?: string, city?: string, service?: string,
   *          featured?: boolean, limit?: number, offset?: number}} [query]
   * @returns {Promise<{plumbers: object[], total: number, area?: {city, county, state}}>}
   */
  async search(query = {}) {
    const { zip, state, county, city, service, featured, limit = 24, offset } = query;
    if (!zip && !state) throw new Error("plumbers.search: pass a zip, or a state (with county or city)");
    return this.client._fetch("/api/site/plumbers", {
      query: { zip, state, county, city, service, featured: featured ? "true" : undefined, limit, offset },
      tags: ["servicedash:plumbers"],
    });
  }

  /** One public profile by slug. @returns {Promise<{plumber: object}>} */
  async get(slug) {
    return this.client._fetch(`/api/site/plumbers/${seg("slug", slug)}`, {
      tags: ["servicedash:plumbers", `servicedash:plumber:${slug}`],
    });
  }

  /** Directory facets for browse pages: states -> counties -> cities with listing counts. */
  async areas({ state } = {}) {
    return this.client._fetch("/api/site/plumbers/areas", { query: { state }, tags: ["servicedash:plumbers"] });
  }

  /** Does anyone install in this zip? { covered, plumbers_count, lead_time_days }. */
  async coverage(zip) {
    if (!zip) throw new Error("plumbers.coverage: zip is required");
    return this.client._fetch("/api/site/plumbers/coverage", { query: { zip }, tags: ["servicedash:plumbers"] });
  }

  /**
   * Ask for an install (or water test) from the directory. Creates an install
   * lead in the CRM. With `plumber` it is a preference the dispatcher tries
   * first; without one the zip's dispatch rule decides.
   *
   * Same consent rules as leads.submit: `smsConsent` must be explicit.
   *
   * @param {Object} input  { plumber?, name, email?, phone, zip, address?, product?, orderId?,
   *                          service?, preferredDates?: string[], notes?, smsConsent, consentTextVersion? }
   * @param {{honeypot?: string}} [options]
   * @returns {Promise<{id: string, created: boolean}>}
   */
  async requestInstall(input = {}, { honeypot } = {}) {
    const { plumber, name, email, phone, zip, address, product, orderId, service = "softener_install", preferredDates, notes, smsConsent, consentTextVersion } = input;
    if (!zip) throw new Error("plumbers.requestInstall: zip is required");
    if (!phone && !email) throw new Error("plumbers.requestInstall: phone or email is required");
    if (typeof smsConsent !== "boolean") throw new Error("plumbers.requestInstall: smsConsent must be an explicit boolean");
    if (smsConsent && !consentTextVersion) throw new Error("plumbers.requestInstall: consentTextVersion is required when smsConsent is true");
    let attribution;
    try {
      attribution = this.client.attribution?.snapshot?.();
    } catch {
      attribution = undefined;
    }
    return this.client._fetch("/api/site/plumbers/install-requests", {
      method: "POST",
      body: {
        plumber,
        name,
        email,
        phone,
        zip,
        address,
        product,
        order_id: orderId,
        service,
        preferred_dates: preferredDates,
        notes,
        consent: { sms: smsConsent, sms_text_version: consentTextVersion || null, at: new Date().toISOString() },
        attribution,
        _hp: honeypot || "",
      },
    });
  }
}

export default PlumbersModule;
