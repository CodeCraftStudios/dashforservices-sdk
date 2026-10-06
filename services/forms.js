/**
 * Forms: dashboard-built forms the site renders and collects (warranty
 * registration, commercial survey intake, careers, plumber applications).
 *
 * The definition lives in the platform's `form` type; submissions land as
 * `form_submission` records, validated against the form's own required
 * fields, throttled per IP and honeypotted. Public key OK.
 *
 * Backend: EXISTS today (/api/site/forms/<key>[/submissions], module "forms").
 */

import { seg } from "./_util.js";

export class FormsModule {
  constructor(client) {
    this.client = client;
  }

  /** @returns {Promise<{form: {data: {key, name, fields, success_message}}}>} */
  async get(formKey) {
    return this.client._fetch(`/api/site/forms/${seg("formKey", formKey)}`, { tags: ["servicedash:forms"] });
  }

  /**
   * @param {string} formKey
   * @param {Record<string, unknown>} values
   * @param {{honeypot?: string, meta?: object, attribution?: boolean}} [options]
   *   attribution (default true) adds the attribution snapshot to meta
   */
  async submit(formKey, values, { honeypot, meta, attribution = true } = {}) {
    let attr;
    if (attribution) {
      try {
        attr = this.client.attribution?.snapshot?.();
      } catch {
        attr = undefined;
      }
    }
    return this.client._fetch(`/api/site/forms/${seg("formKey", formKey)}/submissions`, {
      method: "POST",
      body: { values, _hp: honeypot || "", meta: { ...(meta || {}), ...(attr ? { attribution: attr } : {}) } },
    });
  }
}

export default FormsModule;
