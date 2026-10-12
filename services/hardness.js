/**
 * Water hardness by zip code: feeds the cost calculator, city pages and the
 * first-contact email. Public, cacheable reference data.
 *
 *   const h = await sd.hardness.byZip("85004");
 *   // { zip, city, state, county, gpg: 16.2, ppm: 277, band: "very_hard",
 *   //   source: "Phoenix Water 2025 CCR", source_url, updated_at,
 *   //   water_source: "city", notes }
 *
 * gpg = grains per gallon; ppm = mg/L as CaCO3 (1 gpg = 17.1 ppm).
 *
 * Backend: EXISTS. /api/site/hardness?zip=, ?city=&state= and /api/site/hardness/cities,
 * from the DashForServices zip water database (utility reports + our lab results).
 * A zip without its own data can be answered by a nearby known zip on the same
 * water supply (`match: "nearby"`, `nearby_zip`); otherwise `hardness` is null.
 */

export const HARDNESS_BANDS = Object.freeze([
  { band: "soft", label: "Soft", maxGpg: 1 },
  { band: "slightly_hard", label: "Slightly hard", maxGpg: 3.5 },
  { band: "moderately_hard", label: "Moderately hard", maxGpg: 7 },
  { band: "hard", label: "Hard", maxGpg: 10.5 },
  { band: "very_hard", label: "Very hard", maxGpg: Infinity },
]);

export class HardnessModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {string} zip 5-digit US zip
   * @returns {Promise<{hardness: object | null}>} null hardness when the zip has no data yet
   */
  async byZip(zip) {
    const z = String(zip || "").trim().slice(0, 5);
    if (!/^\d{5}$/.test(z)) throw new Error("hardness.byZip: a 5-digit zip is required");
    return this.client._fetch("/api/site/hardness", { query: { zip: z }, tags: ["servicedash:hardness"], revalidate: 86400 });
  }

  /** Hardness for a city page: { city, state, gpg_avg, gpg_min, gpg_max, zips: [...] }. */
  async byCity(city, state) {
    if (!city || !state) throw new Error("hardness.byCity: city and state are required");
    return this.client._fetch("/api/site/hardness", { query: { city, state }, tags: ["servicedash:hardness"], revalidate: 86400 });
  }

  /** Every city with data, for generateStaticParams(). */
  async cities({ state } = {}) {
    return this.client._fetch("/api/site/hardness/cities", { query: { state }, tags: ["servicedash:hardness"], revalidate: 86400 });
  }

  // ─── Pure helpers ───────────────────────────────────────────────────────

  /** gpg -> band object (USGS / WQA scale). */
  band(gpg) {
    const n = Number(gpg);
    if (!Number.isFinite(n)) return null;
    return HARDNESS_BANDS.find((b) => n <= b.maxGpg) || HARDNESS_BANDS[HARDNESS_BANDS.length - 1];
  }

  ppmToGpg(ppm) {
    return Math.round((Number(ppm) / 17.1) * 10) / 10;
  }

  gpgToPpm(gpg) {
    return Math.round(Number(gpg) * 17.1);
  }
}

export default HardnessModule;
