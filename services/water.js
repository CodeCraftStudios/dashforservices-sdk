/**
 * Tap water quality by ZIP code, from EWG's Tap Water Database by way of the
 * platform (which reads EWG, keeps the report, and refreshes it quarterly).
 *
 *   const w = await sd.water.byZip("33323");
 *   // { zip, city, state, county, status: "found" | "area" | "none",
 *   //   utilities: [{ pws, name, location, city, state, people_served, featured }],
 *   //   report: { pws, name, period: "2021-2023", compliance: { compliant, quarter, text },
 *   //             exceed_count, other_count, not_detected_count,
 *   //             contaminants: [{ name, effect, level, legal_limit, guideline, times, exceeds,
 *   //                              national_avg, state_avg, description, sources, filters }],
 *   //             not_detected: [...names], filters: { carbon: { exceed, other }, ro: { exceed, other } },
 *   //             source_url, fetched_at } | null,
 *   //   fetched_at }
 *
 * `report` is the featured utility's (the one EWG lists first for the ZIP).
 * Other utilities serving the ZIP are in `utilities`; load one with
 * `sd.water.system(pws)`. Levels, limits and guidelines come as
 * { value, unit, text }; `times` is how many times over EWG's health guideline.
 * `filters` on a contaminant are the technologies EWG lists as effective:
 * "carbon", "ro" (reverse osmosis), "ion" (ion exchange, a softener).
 *
 * Backend: EXISTS. GET /api/site/water?zip= and ?pws=. Orgs need the tap_water
 * table (dashboard Admin > Tables); without it the endpoint answers 404.
 */

export const WATER_FILTERS = Object.freeze({
  carbon: "Activated carbon",
  ro: "Reverse osmosis",
  ion: "Ion exchange",
  distillation: "Distillation",
});

export class WaterModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {string} zip 5-digit US ZIP
   * @param {{report?: boolean}} [options] report: false skips the featured utility's report
   */
  async byZip(zip, { report = true } = {}) {
    const z = String(zip || "").trim().slice(0, 5);
    if (!/^\d{5}$/.test(z)) throw new Error("water.byZip: a 5-digit ZIP code is required");
    return this.client._fetch("/api/site/water", { query: { zip: z, ...(report ? {} : { report: "0" }) }, tags: ["servicedash:water"], revalidate: 86400 });
  }

  /** One utility's report by its EWG/EPA PWS id, like FL4061408. */
  async system(pws) {
    const id = String(pws || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(id)) throw new Error("water.system: a utility id like FL4061408 is required");
    return this.client._fetch("/api/site/water", { query: { pws: id }, tags: ["servicedash:water"], revalidate: 86400 });
  }

  // ─── Pure helpers ───────────────────────────────────────────────────────

  /** Contaminants above EWG's health guideline, worst first. */
  exceeding(report) {
    return (report?.contaminants || []).filter((c) => c.exceeds).sort((a, b) => (b.times || 0) - (a.times || 0));
  }

  /** Detected contaminants under the guideline. */
  other(report) {
    return (report?.contaminants || []).filter((c) => !c.exceeds);
  }

  /** The filter technologies that clear at least one contaminant above the guideline, most useful first. */
  filtersFor(report) {
    const tally = {};
    for (const c of this.exceeding(report)) for (const f of c.filters || []) tally[f] = (tally[f] || 0) + 1;
    return Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, label: WATER_FILTERS[key] || key, count }));
  }
}

export default WaterModule;
