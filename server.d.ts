import type { SiteClient, SiteClientOptions } from "./index";

export * from "./index";

/** A SiteClient from DASHFORSERVICES_SITE_KEY / DASHFORSERVICES_API_URL / DASHFORSERVICES_PLATFORM. Server only. */
export declare function createSiteClient(options?: SiteClientOptions): SiteClient;
