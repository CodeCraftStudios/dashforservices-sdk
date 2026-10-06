import type { SiteClient, SiteClientOptions } from "./index";

export * from "./index";

/** A SiteClient from SERVICEDASH_SITE_KEY / SERVICEDASH_API_URL / SERVICEDASH_PLATFORM. Server only. */
export declare function createSiteClient(options?: SiteClientOptions): SiteClient;
