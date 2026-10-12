/**
 * Leads: quote requests, water test requests, callbacks and contact forms.
 * Every submission starts the install CRM's 5-minute call timer and the
 * first-contact text + email (spec sections 4 and 5).
 *
 * Works with a PUBLIC key; the endpoint validates, throttles per IP and
 * honeypots. Two things are attached automatically:
 *
 *  - attribution: utm_*, gclid/fbclid/msclkid, landing page, referrer, video
 *    id and the affiliate code from the sd_ref cookie (see attribution.js);
 *  - consent: the explicit SMS consent boolean, the version of the consent
 *    text the visitor saw, and the time. Texting a lead without it is not
 *    allowed, so `smsConsent` must be passed as a real boolean, true or false.
 *
 *   await sd.leads.requestQuote(
 *     { firstName: "Dana", phone: "602-555-0142", email, zip: "85004",
 *       customerType: "homeowner", ownsHome: true, waterSource: "city",
 *       householdSize: 4, concerns: ["spots_scale", "dry_skin_hair"] },
 *     { smsConsent: true, consentTextVersion: "sms-2026-10", honeypot: hp }
 *   );
 *
 * Backend: the endpoint EXISTS (POST /api/site/leads, module "contacts",
 * writes a `contact` record). Routing it into an `install_lead` with the call
 * timer and sequences is NEW (DashForServices "install_crm" module).
 */

/**
 * quote: home install price request. water_test: free mail-in kit. site_survey and
 * commercial_quote: business. callback: schedule a call. contact: general. service:
 * repair or maintenance (opens a repair job). installer / affiliate: partner signups.
 */
export const LEAD_KINDS = Object.freeze(["quote", "water_test", "site_survey", "callback", "contact", "commercial_quote", "service", "installer", "affiliate"]);
export const CUSTOMER_TYPES = Object.freeze(["homeowner", "commercial"]);
export const WATER_CONCERNS = Object.freeze(["spots_scale", "dry_skin_hair", "taste_smell", "appliances"]);
export const WATER_PROBLEMS = Object.freeze(["iron_stains", "rotten_egg", "other"]);
export const TIMELINES = Object.freeze(["asap", "this_month", "1_3_months", "researching"]);
export const BUSINESS_TYPES = Object.freeze(["hotel", "restaurant", "property_manager", "office", "salon_spa", "laundromat", "other"]);

function toAddress(a) {
  if (!a) return undefined;
  if (typeof a === "string") return { line1: a };
  return {
    line1: a.line1 ?? a.address1 ?? a.street,
    line2: a.line2 ?? a.address2,
    city: a.city,
    state: a.state,
    postal_code: a.postalCode ?? a.postal_code ?? a.zip,
    country: a.country || "US",
  };
}

/** camelCase SDK input -> the platform's snake_case lead fields. Unknown keys pass through in `extra`. */
function normalize(data) {
  const {
    firstName, first_name, lastName, last_name, name, email, phone, zip, city, state, address,
    customerType, customer_type,
    // homeowner
    ownsHome, owns_home, waterSource, water_source, householdSize, household_size, concerns, problems, timeline,
    // commercial
    company, businessType, business_type, locations, unitsOrRooms, units, dailyUsageGallons, contactRole,
    // both
    message, preferredContact, preferredTime, productInterest,
    // what a cost calculator recommended, for the rep
    recommendedSystem, recommended_system, ...extra
  } = data || {};
  const type = customerType ?? customer_type ?? (company || businessType || business_type ? "commercial" : "homeowner");
  if (!CUSTOMER_TYPES.includes(type)) throw new Error(`leads: customerType must be one of ${CUSTOMER_TYPES.join(", ")}`);

  const out = {
    first_name: firstName ?? first_name,
    last_name: lastName ?? last_name,
    name: name ?? ([firstName ?? first_name, lastName ?? last_name].filter(Boolean).join(" ") || undefined),
    email,
    phone,
    zip: zip ?? (address && typeof address === "object" ? address.zip ?? address.postalCode : undefined),
    city,
    state,
    address: toAddress(address),
    customer_type: type,
    message,
    preferred_contact: preferredContact,
    preferred_time: preferredTime,
    product_interest: productInterest,
    recommended_system: recommendedSystem ?? recommended_system,
  };
  if (type === "homeowner") {
    Object.assign(out, {
      owns_home: ownsHome ?? owns_home,
      water_source: waterSource ?? water_source,
      household_size: householdSize ?? household_size,
      concerns,
      problems,
      timeline,
    });
  } else {
    Object.assign(out, {
      company,
      business_type: businessType ?? business_type,
      locations,
      units: unitsOrRooms ?? units,
      daily_usage_gallons: dailyUsageGallons,
      contact_role: contactRole,
      timeline,
    });
  }
  if (Object.keys(extra).length) out.extra = extra;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

export class LeadsModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * Submit a lead.
   *
   * @param {Object} data  see normalize(): firstName, lastName, email, phone, zip, address,
   *   customerType ("homeowner"|"commercial"), homeowner fields (ownsHome, waterSource,
   *   householdSize, concerns[], problems[], timeline) or commercial fields (company,
   *   businessType, locations, unitsOrRooms, dailyUsageGallons, contactRole), message.
   * @param {Object} options
   * @param {string} [options.kind="quote"]  one of LEAD_KINDS
   * @param {boolean} options.smsConsent     REQUIRED, explicit true/false from the form checkbox
   * @param {string} [options.consentTextVersion]  required when smsConsent is true
   * @param {string} [options.consentText]   the exact wording shown, stored with the lead
   * @param {boolean} [options.emailConsent]
   * @param {string} [options.honeypot]
   * @param {Object} [options.attribution]   override the automatic attribution snapshot
   * @param {Object} [options.meta]          anything else only the page knows
   * @returns {Promise<{created: boolean, id?: string}>}
   */
  async submit(data, options = {}) {
    const { kind = "quote", smsConsent, consentTextVersion, consentText, emailConsent, honeypot, attribution, meta } = options;
    if (!LEAD_KINDS.includes(kind)) throw new Error(`leads.submit: kind must be one of ${LEAD_KINDS.join(", ")}`);
    if (typeof smsConsent !== "boolean") {
      throw new Error("leads.submit: smsConsent must be an explicit boolean (the form's text-consent checkbox)");
    }
    if (smsConsent && !consentTextVersion) {
      throw new Error("leads.submit: consentTextVersion is required when smsConsent is true");
    }
    const lead = normalize(data);
    if (!lead.email && !lead.phone) throw new Error("leads.submit: an email or a phone number is required");

    let attr = attribution;
    if (!attr) {
      try {
        attr = this.client.attribution?.snapshot?.();
      } catch {
        attr = undefined;
      }
    }

    const res = await this.client._fetch("/api/site/leads", {
      method: "POST",
      body: {
        data: {
          ...lead,
          kind,
          source: attr?.source,
          affiliate_code: attr?.affiliate_code,
          consent: {
            sms: smsConsent,
            sms_text_version: consentTextVersion || null,
            sms_text: consentText || null,
            email_marketing: typeof emailConsent === "boolean" ? emailConsent : null,
            at: new Date().toISOString(),
            page: attr?.page,
          },
          attribution: attr || null,
          meta: meta || {},
        },
        _hp: honeypot || "",
      },
    });

    try {
      this.client.insights?.track?.("lead_submitted", { kind, customer_type: lead.customer_type, zip: lead.zip });
      this.client.insights?.flush?.();
    } catch {
      /* analytics never breaks a submit */
    }
    return res;
  }

  /** Install quote request (the default lead). */
  requestQuote(data, options) {
    return this.submit(data, { ...options, kind: data?.customerType === "commercial" || data?.company ? "commercial_quote" : "quote" });
  }

  /** $99 home water test (well water, problem water) or a business site survey. */
  requestWaterTest(data, options) {
    return this.submit(data, { ...options, kind: data?.customerType === "commercial" ? "site_survey" : "water_test" });
  }

  /** "Call me back" with a preferred time. */
  requestCallback(data, options) {
    return this.submit(data, { ...options, kind: "callback" });
  }

  /** General contact form. */
  contact(data, options) {
    return this.submit(data, { ...options, kind: "contact" });
  }
}

export default LeadsModule;
