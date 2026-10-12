/**
 * The org behind this site: the business facts a site shows in its header,
 * footer, contact page and JSON-LD. Name, email and domain come from the org;
 * phone, address and legal name from the dashboard's Settings > General.
 *
 *   const { org } = await sd.org.get();
 *   // { slug, name, short, legal_name, domain, email, phone, address, timezone, accent }
 *
 * Empty strings mean "not set yet": hide that line rather than invent one.
 *
 * Backend: EXISTS. /api/site/org (DashForServices orgs).
 */
export class OrgModule {
  constructor(client) {
    this.client = client;
  }

  /** @returns {Promise<{org: object}>} */
  async get() {
    return this.client._fetch("/api/site/org", { tags: ["servicedash:org"], revalidate: 300 });
  }
}
