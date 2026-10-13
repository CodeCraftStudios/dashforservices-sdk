/**
 * Jobs: install tracking in the customer portal.
 *
 * A job is one install, water test, site survey or repair. The customer sees
 * where it is in the 12-step flow (spec section 3) and the facts they need:
 * when the system shipped and arrived, the install date and arrival window,
 * and who the plumber is. They never see margins, payouts or other jobs.
 *
 *   { id, number, type: "install"|"water_test"|"site_survey"|"repair",
 *     status: "new_lead"|"contacted"|"water_test_needed"|"quoted"|"booked"|
 *             "sent_to_plumber"|"plumber_accepted"|"shipped"|"delivered"|
 *             "installed"|"paid"|"closed"|"cancelled",
 *     steps: [{ key, label, done, at }],
 *     system: { name, tier }, address: {...},
 *     shipment: { carrier, tracking_number, tracking_url, shipped_at, delivered_at, eta },
 *     install: { date, window_start, window_end },
 *     plumber: { company, first_name, license_number, license_state, phone, rating },
 *     photos: [{ url, kind }], sign_off: { required, signed_at } }
 *
 * Needs a signed-in customer (see customers.js).
 *
 * Backend: EXISTS. /api/site/jobs[/<id>[/sign-off|/reschedule-request|/problem]]
 * on the dashboard's job records.
 */

import { seg } from "./_util.js";

export const JOB_STEPS = Object.freeze([
  "new_lead",
  "contacted",
  "water_test_needed",
  "quoted",
  "booked",
  "sent_to_plumber",
  "plumber_accepted",
  "shipped",
  "delivered",
  "installed",
  "paid",
  "closed",
]);

/** The customer-facing subset of the steps, in order (what a tracker renders). */
export const CUSTOMER_JOB_STEPS = Object.freeze(["booked", "plumber_accepted", "shipped", "delivered", "installed", "closed"]);

export class JobsModule {
  constructor(client) {
    this.client = client;
  }

  /** @returns {Promise<{jobs: object[]}>} the customer's jobs, newest first */
  async list({ status, type } = {}) {
    return this.client._fetch("/api/site/jobs", { auth: true, query: { status, type } });
  }

  /** @returns {Promise<{job: object}>} */
  async get(jobId) {
    return this.client._fetch(`/api/site/jobs/${seg("jobId", jobId)}`, { auth: true });
  }

  /**
   * Customer sign-off after the plumber marks the job installed. This is the
   * trigger for the install-fee charge, so it is an explicit act.
   * @param {{signatureName: string, rating?: number, comment?: string}} input
   */
  async signOff(jobId, { signatureName, rating, comment } = {}) {
    if (!signatureName) throw new Error("jobs.signOff: signatureName is required");
    return this.client._fetch(`/api/site/jobs/${seg("jobId", jobId)}/sign-off`, {
      method: "POST",
      auth: true,
      body: { signature_name: signatureName, rating, comment },
    });
  }

  /** Ask ops to move the install date. A request, not a change: ops confirms with the plumber. */
  async requestReschedule(jobId, { preferredDates = [], note } = {}) {
    return this.client._fetch(`/api/site/jobs/${seg("jobId", jobId)}/reschedule-request`, {
      method: "POST",
      auth: true,
      body: { preferred_dates: preferredDates, note },
    });
  }

  /** Report a problem after install; opens a repair job routed to the same plumber. */
  async reportProblem(jobId, { description, photos = [] } = {}) {
    if (!description) throw new Error("jobs.reportProblem: description is required");
    return this.client._fetch(`/api/site/jobs/${seg("jobId", jobId)}/problem`, {
      method: "POST",
      auth: true,
      body: { description, photos },
    });
  }

  /** Where a job sits in the customer-facing tracker: { index, total, step }. Pure. */
  progress(job) {
    const status = job?.status;
    let index = CUSTOMER_JOB_STEPS.indexOf(status);
    if (index < 0) {
      // Map internal steps onto the nearest customer step before it.
      const pos = JOB_STEPS.indexOf(status);
      index = CUSTOMER_JOB_STEPS.reduce((acc, s, i) => (JOB_STEPS.indexOf(s) <= pos ? i : acc), -1);
    }
    return { index, total: CUSTOMER_JOB_STEPS.length, step: CUSTOMER_JOB_STEPS[index] ?? null };
  }
}

export default JobsModule;
