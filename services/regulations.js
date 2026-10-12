/**
 * Regulations: local rules for installing a softener or RO system.
 *
 *   const { regulation } = await sd.regulations.lookup({ zip: "33101" });
 *   const { regulation } = await sd.regulations.lookup({ city: "Austin", state: "TX" });
 *
 * A regulation (the most specific jurisdiction wins: city > county > state):
 *   { jurisdiction: { level: "state"|"county"|"city", name, state },
 *     summary: "Florida does not require a plumbing licence for softener installs...",
 *     requirements: [{ key: "license_required", label, value: boolean|string, note }],
 *     // common keys: license_required, permit_required, backflow_required,
 *     // discharge_rules, salt_based_restricted, ro_waste_rules, inspection_required
 *     install_fee_timing: "on_completion" | "at_booking",   // FL = at_booking (spec section 6)
 *     sources: [{ title, url }], updated_at, disclaimer }
 *
 * Backend: NEW. /api/site/regulations[/<state>] (DashForServices "regulations" module).
 */

import { seg } from "./_util.js";

export class RegulationsModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {{zip?: string, city?: string, county?: string, state?: string}} where
   * @returns {Promise<{regulation: object | null}>}
   */
  async lookup(where = {}) {
    const { zip, city, county, state } = where;
    if (!zip && !state) throw new Error("regulations.lookup: pass a zip, or a state (with city or county)");
    return this.client._fetch("/api/site/regulations", {
      query: { zip, city, county, state },
      tags: ["servicedash:regulations"],
      revalidate: 86400,
    });
  }

  /** Every rule set for one state (state + its counties and cities), for a state guide page. */
  async state(state) {
    return this.client._fetch(`/api/site/regulations/${seg("state", String(state).toUpperCase())}`, {
      tags: ["servicedash:regulations"],
      revalidate: 86400,
    });
  }

  /** Requirement value by key from a lookup result (pure). */
  requirement(regulation, key) {
    return regulation?.requirements?.find((r) => r.key === key) ?? null;
  }
}

export default RegulationsModule;
