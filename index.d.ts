/**
 * servicedash-sdk: the ServiceDash public-site SDK.
 * Runs on per-site dfd-site-* keys against the Dash4Devs /api/site/* surface.
 */

export declare const SDK_NAME: "servicedash-sdk";
export declare const SDK_VERSION: string;
export declare const PRODUCT_NAME: "ServiceDash";
export declare const DEFAULT_BASE_URL: "https://api.dashfordevs.com";
export declare const ENV: {
  readonly SITE_KEY: "SERVICEDASH_SITE_KEY";
  readonly PUBLIC_SITE_KEY: "NEXT_PUBLIC_SERVICEDASH_SITE_KEY";
  readonly API_URL: "SERVICEDASH_API_URL";
};
export declare const KEY_PATTERN: RegExp;

export declare function parseSiteKey(key: string): { kind: "public" | "secret"; environment: "live" | "test" } | null;

export declare class ServiceDashError extends Error {
  status?: number;
  /** Platform error code, e.g. origin_not_allowed, module_not_enabled, not_signed_in, platform_mismatch. */
  code?: string;
  payload?: unknown;
  retryAfterMs?: number;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SiteClientOptions {
  /** dfd-site-<public|secret>-key-<live|test>-<random>. Defaults to the SERVICEDASH env vars. */
  key?: string;
  /** API host. Defaults to SERVICEDASH_API_URL or https://api.dashfordevs.com. */
  baseURL?: string;
  /** Expected Dash4Devs platform slug; asserted via /api/site/whoami on first call when given. */
  platform?: string;
  /** Server GET cache lifetime in seconds under a production Next build. Default 300. */
  revalidate?: number;
  /** Extra Next cache tags on every cached GET (always includes "servicedash"). */
  cacheTags?: string[];
  /** A signed-in customer's JWT. */
  customerToken?: string;
  /** Default checkout transport. */
  checkout?: { endpoint?: string; mode?: CheckoutMode };
  /** Cart / visitor id / token store. Defaults to localStorage (browser) or memory (server). */
  storage?: KeyValueStorage;
  attribution?: { cookieDays?: number; refCookieDays?: number; cookieDomain?: string };
  fetch?: typeof fetch;
}

export interface SiteWhoami {
  site: { id: string; name: string; domain: string };
  customer: string | null;
  platform: { slug: string; name: string };
  key: { kind: "public" | "secret"; environment: "live" | "test" };
  modules: string[];
}

export interface Paged {
  total: number;
  limit: number;
  offset: number;
}

/** A platform record as the site surface serializes it. */
export interface SiteRecord<T = Record<string, unknown>> {
  id: string;
  type: string;
  status: string;
  data: T & Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Address {
  name?: string;
  company?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
}

// ─── Content / page groups / blog / legal ─────────────────────────────────

/* ---------- Files (Media Library) ---------- */

export interface SiteFileVariant { url: string; width: number }
export interface SiteFile {
  id: string;
  name: string;
  /** Stable handle set in the dashboard, e.g. "hero". */
  label: string | null;
  url: string;
  original_filename: string;
  file_type: "image" | "video" | "document" | "other";
  content_type: string;
  size_bytes: number;
  file_size_display: string;
  alt: string;
  description: string;
  width: number | null;
  height: number | null;
  tags: string[];
  metadata: Record<string, unknown>;
  display_order: number;
  folder_id: string | null;
  created_at: string | null;
  lqip?: string | null;
  variants_ready?: boolean;
  variants?: { webp?: SiteFileVariant[] };
}

export interface FileListQuery {
  /** Folder name or full path, e.g. "Gallery" or "Brand/Logos". */
  folder?: string;
  /** Exact label. */
  label?: string;
  limit?: number;
  offset?: number;
}

/** Best match for a name or label: label, name, name without extension, then a loose match. */
export declare function matchFile(files: SiteFile[], nameOrLabel: string): SiteFile | null;

export declare class FileFolder {
  readonly name: string;
  list(query?: Omit<FileListQuery, "folder">): Promise<{ files: SiteFile[]; total: number; limit: number; offset: number }>;
  all(): Promise<SiteFile[]>;
  find(nameOrLabel: string): Promise<SiteFile | null>;
  getFileOrReturnNull(nameOrLabel: string): Promise<SiteFile | null>;
  url(nameOrLabel: string): Promise<string | null>;
}

export declare class FilesModule {
  list(query?: FileListQuery): Promise<{ files: SiteFile[]; total: number; limit: number; offset: number }>;
  all(query?: Pick<FileListQuery, "folder">): Promise<SiteFile[]>;
  /** The file whose label or name matches (e.g. "hero"), or null. */
  find(nameOrLabel: string, opts?: { folder?: string }): Promise<SiteFile | null>;
  getFileOrReturnNull(nameOrLabel: string, opts?: { folder?: string }): Promise<SiteFile | null>;
  url(nameOrLabel: string, opts?: { folder?: string }): Promise<string | null>;
  folder(nameOrPath: string): FileFolder;
  getFolder(nameOrPath: string): FileFolder;
}

export declare class ContentModule {
  list(query?: { section?: string; limit?: number; offset?: number }): Promise<{ content: SiteRecord[] } & Paged>;
  get(slug: string): Promise<{ content: SiteRecord }>;
  data(slug: string): Promise<Record<string, unknown> | null>;
  section(section: string): Promise<Record<string, Record<string, unknown>>>;
}

export interface PageGroupItem {
  id: string;
  slug: string;
  title: string;
  content?: string;
  excerpt?: string;
  featured_image?: { url: string; alt?: string } | null;
  custom_fields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  seo?: { title?: string; description?: string; og_image?: string };
  published_at?: string;
  [key: string]: unknown;
}

export type ItemPredicate = ((item: PageGroupItem) => boolean) | Record<string, unknown>;

export declare class PageGroup {
  constructor(client: SiteClient, slug: string);
  readonly slug: string;
  all(options?: { limit?: number; offset?: number; sort?: string }): Promise<{ group: Record<string, unknown>; items: PageGroupItem[]; total: number }>;
  get(itemSlug: string): Promise<{ item: PageGroupItem }>;
  filter(predicate?: ItemPredicate, options?: { limit?: number; offset?: number }): Promise<PageGroupItem[]>;
  find(predicate: ItemPredicate): Promise<PageGroupItem | null>;
  count(): Promise<number>;
  slugs(): Promise<string[]>;
}

export declare class PageGroupsModule {
  list(): Promise<{ groups: Array<{ slug: string; name: string; item_count: number }> }>;
  group(slug: string): PageGroup;
}

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt?: string;
  content?: string;
  featured_image?: { url: string; alt?: string } | null;
  author?: { name: string; avatar?: string };
  category?: { slug: string; name: string } | null;
  tags?: string[];
  published_at?: string;
  reading_minutes?: number;
  seo?: { title?: string; description?: string; og_image?: string };
  [key: string]: unknown;
}

export declare class BlogModule {
  list(options?: {
    limit?: number;
    offset?: number;
    page?: number;
    category?: string;
    tag?: string;
    search?: string;
    featured?: boolean;
    city?: string;
    customFields?: Record<string, string | number | boolean>;
  }): Promise<{ posts: BlogPost[] } & Paged>;
  get(slug: string): Promise<{ post: BlogPost }>;
  post(slug: string): Promise<BlogPost | null>;
  categories(): Promise<{ categories: Array<{ slug: string; name: string; post_count?: number }> }>;
  related(slug: string, options?: { limit?: number }): Promise<{ posts: BlogPost[] }>;
}

export interface LegalDocument {
  slug: string;
  title: string;
  body_html?: string;
  version: string;
  effective_at?: string;
  updated_at: string;
}

export declare class LegalModule {
  list(): Promise<{ documents: LegalDocument[] }>;
  get(slug: string, options?: { version?: string }): Promise<{ document: LegalDocument }>;
  document(slug: string): Promise<LegalDocument | null>;
}

export declare class FormsModule {
  get(formKey: string): Promise<{ form: SiteRecord<{ key?: string; name?: string; fields?: unknown[]; success_message?: string }> }>;
  submit(
    formKey: string,
    values: Record<string, unknown>,
    options?: { honeypot?: string; meta?: Record<string, unknown>; attribution?: boolean }
  ): Promise<{ created: boolean; id?: string }>;
}

// ─── Catalog ──────────────────────────────────────────────────────────────

export interface SubscriptionPlan {
  id: string;
  name?: string;
  interval_length: number;
  interval_unit: "days" | "months";
  discount_percent: number;
  /** Per-cycle price (server figure). */
  price?: number;
}

export interface ProductSize {
  id: string;
  name: string;
  sku?: string;
  price: number | null;
  compare_at_price?: number | null;
  stock_status?: "in_stock" | "low_stock" | "out_of_stock" | "backorder";
  subscription_plans: SubscriptionPlan[];
}

export interface ProductData {
  slug?: string;
  name?: string;
  category?: string;
  kind?: "system" | "store";
  description?: string;
  price?: number | string;
  compare_at_price?: number | string;
  main_image?: { url: string; alt?: string } | null;
  images?: Array<{ url: string; alt?: string }>;
  certification?: string;
  sizes?: ProductSize[];
  refill_schedule?: { interval_length: number; interval_unit: "days" | "months" };
  [key: string]: unknown;
}

export type ProductRecord = SiteRecord<ProductData>;

export declare class ProductsModule {
  list(query?: { category?: string; search?: string; kind?: string; limit?: number; offset?: number }): Promise<{ products: ProductRecord[] } & Paged>;
  get(slug: string): Promise<{ product: ProductRecord }>;
  data(slug: string): Promise<ProductData | null>;
  search(q: string, options?: { limit?: number; category?: string }): Promise<{ products: ProductRecord[] } & Paged>;
  categories(): Promise<{ categories: SiteRecord[] }>;
  category(slug: string): Promise<{ category: SiteRecord }>;
  sizes(product: ProductRecord | ProductData): ProductSize[];
  subscriptionPlans(product: ProductRecord | ProductData, sizeId: string): SubscriptionPlan[];
  isSubscribable(product: ProductRecord | ProductData): boolean;
  planPrice(basePrice: number | string, plan: SubscriptionPlan): number;
  cadence(plan: SubscriptionPlan): string;
}

// ─── Cart / checkout ──────────────────────────────────────────────────────

export interface CartLineSnapshot {
  name?: string;
  sizeName?: string;
  price?: number;
  image?: string;
  slug?: string;
  planName?: string;
  discountPercent?: number;
  [key: string]: unknown;
}

export interface CartLine {
  key: string;
  productId: string;
  sizeId: string | null;
  quantity: number;
  purchase: "one_time" | "subscription";
  planId: string | null;
  snapshot: CartLineSnapshot;
}

export interface CartTotals {
  subtotal: number;
  discount?: number;
  shipping?: number;
  tax?: number;
  total: number;
  currency?: string;
}

export interface CartState {
  id: string | null;
  code?: string | null;
  lines: CartLine[];
  totals: CartTotals | null;
  warnings: Array<{ key?: string; code: string; message: string }>;
  updatedAt: string | null;
}

export interface CartAddInput {
  productId: string;
  sizeId?: string | null;
  quantity?: number;
  /** Subscription plan id; omit for one-time. */
  planId?: string | null;
  snapshot?: CartLineSnapshot;
}

export interface CartPayload {
  cart_id?: string;
  code?: string;
  lines: Array<{ key: string; product_id: string; size_id: string | null; quantity: number; plan_id: string | null }>;
}

export declare class CartModule {
  autoSync: boolean;
  readonly state: CartState;
  readonly id: string | null;
  readonly lines: CartLine[];
  readonly count: number;
  readonly isEmpty: boolean;
  readonly hasSubscription: boolean;
  readonly subtotal: number;
  readonly totals: CartTotals | null;
  line(key: string): CartLine | null;
  add(item: CartAddInput): CartLine;
  update(key: string, quantity: number): CartLine | null;
  setPlan(key: string, planId: string | null, snapshot?: CartLineSnapshot): CartLine | null;
  remove(key: string): null;
  clear(): void;
  setCode(code: string | null): void;
  toPayload(): CartPayload;
  sync(): Promise<CartState>;
  load(cartId: string): Promise<CartState>;
  hydrate(): CartState;
  subscribe(listener: (state: CartState) => void): () => void;
}

export type CheckoutMode = "session" | "payment_intent";

export interface CheckoutCustomer {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  type?: "homeowner" | "commercial";
  company?: string;
  acceptsMarketing?: boolean;
}

export interface CheckoutInput {
  cart?: CartModule | CartPayload;
  customer: CheckoutCustomer;
  shippingAddress?: Address;
  billingAddress?: Address;
  /** May contain {CHECKOUT_SESSION_ID}. */
  successUrl: string;
  cancelUrl: string;
  mode?: CheckoutMode;
  notes?: string;
  code?: string;
  attribution?: AttributionSnapshot;
  metadata?: Record<string, unknown>;
  /** Tenant route handler (same origin) instead of the platform endpoint. */
  endpoint?: string;
  idempotencyKey?: string;
}

export interface CheckoutResult {
  url?: string;
  session_id?: string;
  client_secret?: string;
  payment_intent_id?: string;
  order_id?: string;
}

export interface QuoteCheckoutInput {
  acceptPurchaseTerms: true;
  acceptInstallAgreement: true;
  tier?: QuoteTier;
  signatureName?: string;
  agreementVersions?: { purchase_terms?: string; install_agreement?: string };
  smsConsent?: boolean;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey?: string;
}

export declare class CheckoutModule {
  buildBody(input: CheckoutInput): Record<string, unknown>;
  create(input: CheckoutInput): Promise<CheckoutResult>;
  /** Post a prebuilt buildBody() payload to the platform (tenant route handlers). */
  forward(body: Record<string, unknown>, options?: { idempotencyKey?: string }): Promise<CheckoutResult>;
  redirect(result: CheckoutResult | string): string;
  get(sessionId: string): Promise<{ status: "open" | "complete" | "expired"; order?: Order }>;
  fromQuote(token: string, input: QuoteCheckoutInput): Promise<{ url: string; session_id: string }>;
}

// ─── Customer portal ──────────────────────────────────────────────────────

export interface Customer {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  default_address?: Address | null;
  sms_consent?: boolean;
  [key: string]: unknown;
}

export interface Order {
  id: string;
  number: string;
  status: string;
  payment_status?: string;
  lines: Array<{ product_id: string; name: string; size?: string; quantity: number; unit_price: number; plan_id?: string | null }>;
  totals: CartTotals;
  shipping_address?: Address;
  shipments?: Shipment[];
  created_at: string;
  [key: string]: unknown;
}

export interface Shipment {
  carrier: string;
  tracking_number: string;
  tracking_url?: string;
  status?: string;
  shipped_at?: string;
  delivered_at?: string;
  eta?: string;
}

export declare class CustomersModule {
  subscribe(
    data: { email: string; name?: string; phone?: string; source?: string; zip?: string; meta?: Record<string, unknown> },
    options?: { honeypot?: string }
  ): Promise<{ created: boolean; id: string }>;
  readonly token: string | null;
  readonly isSignedIn: boolean;
  setToken(token: string | null, options?: { persist?: boolean }): this;
  login(credentials: { email: string; password: string }, options?: { persist?: boolean }): Promise<{ token: string; customer: Customer }>;
  register(input: { email: string; password: string; name?: string; phone?: string }, options?: { persist?: boolean }): Promise<{ token: string; customer: Customer }>;
  requestLoginLink(email: string, options?: { redirectUrl?: string }): Promise<{ ok: true }>;
  verifyLoginLink(token: string, options?: { persist?: boolean }): Promise<{ token: string; customer: Customer }>;
  requestPasswordReset(email: string): Promise<{ ok: true }>;
  me(): Promise<{ customer: Customer }>;
  updateMe(patch: Partial<Customer>): Promise<{ customer: Customer }>;
  logout(): Promise<{ ok: true }>;
  orders(options?: { limit?: number; offset?: number }): Promise<{ orders: Order[] } & Partial<Paged>>;
  order(orderId: string): Promise<{ order: Order }>;
}

export type SubscriptionStatus = "active" | "paused" | "cancelled" | "past_due";

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  product: { id: string; name: string; slug?: string; image?: string };
  size: { id: string; name: string };
  plan: SubscriptionPlan;
  quantity: number;
  next_billing_date: string | null;
  paused_until?: string | null;
  last_order_id?: string | null;
  shipping_address?: Address;
  payment_method?: { brand: string; last4: string } | null;
  created_at: string;
}

type SubResult = Promise<{ subscription: Subscription }>;

export declare class SubscriptionsModule {
  list(options?: { status?: SubscriptionStatus }): Promise<{ subscriptions: Subscription[] }>;
  get(id: string): Promise<{ subscription: Subscription; history: Array<{ kind: string; at: string; detail?: string }> }>;
  pause(id: string, options?: { until?: string }): SubResult;
  resume(id: string): SubResult;
  skip(id: string): SubResult;
  cancel(id: string, options?: { reason?: string; feedback?: string }): SubResult;
  resubscribe(id: string): SubResult;
  changePlan(id: string, planId: string, options?: { quantity?: number }): SubResult;
  reschedule(id: string, nextDate: string): SubResult;
  updateAddress(id: string, address: Address): SubResult;
  updatePayment(id: string, options?: { paymentMethodId?: string }): Promise<{ subscription: Subscription; client_secret?: string }>;
}

export type JobStatus =
  | "new_lead" | "contacted" | "water_test_needed" | "quoted" | "booked" | "sent_to_plumber"
  | "plumber_accepted" | "shipped" | "delivered" | "installed" | "paid" | "closed" | "cancelled";

export declare const JOB_STEPS: readonly JobStatus[];
export declare const CUSTOMER_JOB_STEPS: readonly JobStatus[];

export interface Job {
  id: string;
  number: string;
  type: "install" | "water_test" | "site_survey" | "repair";
  status: JobStatus;
  steps: Array<{ key: JobStatus; label: string; done: boolean; at?: string | null }>;
  system?: { name: string; tier?: QuoteTier };
  address?: Address;
  shipment?: Shipment | null;
  install?: { date: string | null; window_start?: string | null; window_end?: string | null };
  plumber?: { company: string; first_name?: string; license_number?: string; license_state?: string; phone?: string; rating?: number } | null;
  photos?: Array<{ url: string; kind?: string }>;
  sign_off?: { required: boolean; signed_at?: string | null };
}

export declare class JobsModule {
  list(options?: { status?: JobStatus; type?: Job["type"] }): Promise<{ jobs: Job[] }>;
  get(jobId: string): Promise<{ job: Job }>;
  signOff(jobId: string, input: { signatureName: string; rating?: number; comment?: string }): Promise<{ job: Job }>;
  requestReschedule(jobId: string, input?: { preferredDates?: string[]; note?: string }): Promise<{ ok: true }>;
  reportProblem(jobId: string, input: { description: string; photos?: string[] }): Promise<{ job: Job }>;
  progress(job: Pick<Job, "status">): { index: number; total: number; step: JobStatus | null };
}

export interface Refill {
  id: string;
  product: { id: string; name: string; slug?: string; image?: string };
  size?: { id: string; name: string } | null;
  price?: number;
  due_date: string;
  status: "due" | "upcoming" | "overdue" | "subscribed";
  last_order_id?: string | null;
  subscription_plans?: SubscriptionPlan[];
}

export declare class RefillsModule {
  list(): Promise<{ refills: Refill[] }>;
  reorder(refillId: string, options?: { quantity?: number }): Promise<{ order?: Order; url?: string }>;
  dismiss(refillId: string, options?: { reason?: string }): Promise<{ ok: true }>;
  addToCart(refill: Refill, planId?: string | null, quantity?: number): CartLine;
}

// ─── Quotes / hardness / regulations ──────────────────────────────────────

export type QuoteTier = "good" | "better" | "best" | "ultimate";
export declare const QUOTE_TIERS: readonly QuoteTier[];

export interface QuoteAgreement {
  key: string;
  version: string;
  title: string;
  body_html: string;
}

export interface Quote {
  token: string;
  status: "sent" | "viewed" | "accepted" | "expired" | "void";
  expires_at: string;
  customer: { first_name?: string; city?: string; state?: string; zip?: string };
  household_size?: number;
  water_source?: "city" | "well" | "unknown";
  hardness_gpg?: number | null;
  packages: Array<{
    tier: QuoteTier;
    name: string;
    system: string;
    equipment_price: number;
    install_fee: number;
    features: string[];
    recommended?: boolean;
  }>;
  selected_tier: QuoteTier | null;
  can_change_tier: boolean;
  plumber?: { company: string; license_number?: string; license_state?: string; rating?: number } | null;
  install?: { price: number; proposed_date?: string | null; fee_timing: "on_completion" | "at_booking" };
  agreements: { purchase_terms: QuoteAgreement; install_agreement: QuoteAgreement };
}

export declare class QuotesModule {
  get(token: string): Promise<{ quote: Quote }>;
  select(token: string, tier: QuoteTier): Promise<{ quote: Quote }>;
  ask(token: string, input: { message: string; preferredContact?: "call" | "text" | "email" }): Promise<{ ok: true }>;
  checkout(token: string, input: QuoteCheckoutInput): Promise<{ url: string; session_id: string }>;
}

export type HardnessBand = "soft" | "slightly_hard" | "moderately_hard" | "hard" | "very_hard";
export declare const HARDNESS_BANDS: ReadonlyArray<{ band: HardnessBand; label: string; maxGpg: number }>;

export interface Hardness {
  zip?: string;
  city: string;
  state: string;
  county?: string;
  gpg: number;
  ppm: number;
  band: HardnessBand;
  water_source?: "city" | "well" | "mixed";
  source?: string;
  source_url?: string;
  notes?: string;
  updated_at?: string;
  /** "zip": this zip's own data. "nearby": a known zip on the same supply stands in (area data matched). */
  match?: "zip" | "nearby";
  /** The zip whose data a nearby match used. */
  nearby_zip?: string;
}

export interface SiteOrg {
  slug: string;
  name: string;
  short: string;
  legal_name: string;
  domain: string;
  email: string;
  /** Empty until set in Settings > General. */
  phone: string;
  address: string;
  timezone: string;
  accent: string;
}

export declare class OrgModule {
  get(): Promise<{ org: SiteOrg }>;
}

export declare class HardnessModule {
  byZip(zip: string): Promise<{ hardness: Hardness | null }>;
  byCity(city: string, state: string): Promise<{ hardness: (Hardness & { gpg_avg: number; gpg_min: number; gpg_max: number; zips: string[] }) | null }>;
  cities(options?: { state?: string }): Promise<{ cities: Array<{ city: string; state: string; slug: string; gpg_avg: number }> }>;
  band(gpg: number): { band: HardnessBand; label: string; maxGpg: number } | null;
  ppmToGpg(ppm: number): number;
  gpgToPpm(gpg: number): number;
}

export interface Regulation {
  jurisdiction: { level: "state" | "county" | "city"; name: string; state: string };
  summary: string;
  requirements: Array<{ key: string; label: string; value: boolean | string; note?: string }>;
  install_fee_timing?: "on_completion" | "at_booking";
  sources?: Array<{ title: string; url: string }>;
  updated_at?: string;
  disclaimer?: string;
}

export declare class RegulationsModule {
  lookup(where: { zip?: string; city?: string; county?: string; state?: string }): Promise<{ regulation: Regulation | null }>;
  state(state: string): Promise<{ state: Regulation; counties: Regulation[]; cities: Regulation[] }>;
  requirement(regulation: Regulation | null, key: string): Regulation["requirements"][number] | null;
}

// ─── Reviews / plumbers ───────────────────────────────────────────────────

export interface Review {
  id: string;
  rating: number;
  title?: string;
  body: string;
  name: string;
  city?: string;
  verified: boolean;
  photos?: string[];
  reply?: { body: string; at: string } | null;
  helpful_count?: number;
  created_at: string;
}

export interface ReviewSummary {
  average: number;
  count: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export declare class ReviewsModule {
  list(query: {
    product?: string;
    plumber?: string;
    rating?: number;
    sort?: "recent" | "rating_desc" | "rating_asc" | "helpful";
    withPhotos?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ reviews: Review[]; summary: ReviewSummary; total: number }>;
  summary(target: { product?: string; plumber?: string }): Promise<{ summary: ReviewSummary }>;
  submit(
    input: {
      product?: string;
      plumber?: string;
      rating: number;
      title?: string;
      body: string;
      name: string;
      email?: string;
      city?: string;
      orderId?: string;
      jobId?: string;
      photos?: string[];
    },
    options?: { honeypot?: string }
  ): Promise<{ id: string; status: "pending" }>;
  markHelpful(reviewId: string): Promise<{ ok: true }>;
}

export interface PlumberProfile {
  slug: string;
  company: string;
  logo?: string;
  photo?: string;
  bio?: string;
  city?: string;
  state?: string;
  counties?: string[];
  zips_served_count?: number;
  license?: { number: string; state: string; verified: boolean; expires_on?: string };
  insured?: boolean;
  services?: string[];
  rating?: { average: number; count: number };
  years_in_business?: number;
  featured?: boolean;
  badges?: string[];
}

export declare class PlumbersModule {
  search(query: {
    zip?: string;
    state?: string;
    county?: string;
    city?: string;
    service?: string;
    featured?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ plumbers: PlumberProfile[]; total: number; area?: { city?: string; county?: string; state: string } }>;
  get(slug: string): Promise<{ plumber: PlumberProfile }>;
  areas(options?: { state?: string }): Promise<{ states: Array<{ state: string; count: number; counties: Array<{ name: string; count: number; cities: Array<{ name: string; count: number }> }> }> }>;
  coverage(zip: string): Promise<{ covered: boolean; plumbers_count: number; lead_time_days?: number }>;
  requestInstall(
    input: {
      plumber?: string;
      name?: string;
      email?: string;
      phone?: string;
      zip: string;
      address?: Address;
      product?: string;
      orderId?: string;
      service?: string;
      preferredDates?: string[];
      notes?: string;
      smsConsent: boolean;
      consentTextVersion?: string;
    },
    options?: { honeypot?: string }
  ): Promise<{ id: string; created: boolean }>;
}

// ─── Leads / attribution / affiliates / insights ──────────────────────────

export type LeadKind = "quote" | "water_test" | "site_survey" | "callback" | "contact" | "commercial_quote" | "service" | "installer" | "affiliate";
export declare const LEAD_KINDS: readonly LeadKind[];
export declare const CUSTOMER_TYPES: readonly ["homeowner", "commercial"];
export declare const WATER_CONCERNS: readonly ["spots_scale", "dry_skin_hair", "taste_smell", "appliances"];
export declare const WATER_PROBLEMS: readonly ["iron_stains", "rotten_egg", "other"];
export declare const TIMELINES: readonly ["asap", "this_month", "1_3_months", "researching"];
export declare const BUSINESS_TYPES: readonly string[];

export interface LeadBase {
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  zip?: string;
  city?: string;
  state?: string;
  address?: Address | string;
  message?: string;
  preferredContact?: "call" | "text" | "email";
  preferredTime?: string;
  productInterest?: string;
  /** The system a cost calculator recommended, shown to the rep. */
  recommendedSystem?: string;
  [extra: string]: unknown;
}

export interface HomeownerLead extends LeadBase {
  customerType?: "homeowner";
  ownsHome?: boolean;
  waterSource?: "city" | "well" | "unknown";
  householdSize?: number;
  concerns?: Array<(typeof WATER_CONCERNS)[number]>;
  problems?: Array<(typeof WATER_PROBLEMS)[number]>;
  timeline?: (typeof TIMELINES)[number];
}

export interface CommercialLead extends LeadBase {
  customerType: "commercial";
  company: string;
  businessType?: string;
  locations?: number;
  unitsOrRooms?: number;
  dailyUsageGallons?: number;
  contactRole?: string;
  timeline?: (typeof TIMELINES)[number];
}

export interface LeadOptions {
  kind?: LeadKind;
  /** REQUIRED: the form's text-consent checkbox, true or false. */
  smsConsent: boolean;
  /** Required when smsConsent is true. */
  consentTextVersion?: string;
  consentText?: string;
  emailConsent?: boolean;
  honeypot?: string;
  attribution?: AttributionSnapshot;
  meta?: Record<string, unknown>;
}

export declare class LeadsModule {
  submit(data: HomeownerLead | CommercialLead, options: LeadOptions): Promise<{ created: boolean; id?: string }>;
  requestQuote(data: HomeownerLead | CommercialLead, options: Omit<LeadOptions, "kind">): Promise<{ created: boolean; id?: string }>;
  requestWaterTest(data: HomeownerLead | CommercialLead, options: Omit<LeadOptions, "kind">): Promise<{ created: boolean; id?: string }>;
  requestCallback(data: HomeownerLead | CommercialLead, options: Omit<LeadOptions, "kind">): Promise<{ created: boolean; id?: string }>;
  contact(data: HomeownerLead | CommercialLead, options: Omit<LeadOptions, "kind">): Promise<{ created: boolean; id?: string }>;
}

export interface Touch {
  at: string;
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  msclkid?: string;
  ttclid?: string;
  video_id?: string;
  affiliate_code?: string;
  landing_page?: string;
  referrer?: string;
}

export interface AttributionSnapshot {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  msclkid?: string;
  ttclid?: string;
  video_id?: string;
  affiliate_code?: string;
  landing_page?: string;
  referrer?: string;
  page?: string;
  visitor_id?: string;
  first_touch?: Touch;
  last_touch?: Touch;
}

export interface StoredAttribution {
  first_touch: Touch | null;
  last_touch: Touch | null;
  affiliate_code: string | null;
}

export declare function attributionFromCookies(cookieHeader: string | null | undefined): StoredAttribution;

export declare class AttributionModule {
  capture(options?: { trackAffiliate?: boolean }): StoredAttribution;
  get(): StoredAttribution;
  readonly affiliateCode: string | null;
  snapshot(): AttributionSnapshot;
  clear(): void;
}

export declare class AffiliatesModule {
  track(code: string, options?: { days?: number }): Promise<boolean>;
  recordClick(code: string, touch?: Partial<Touch>): Promise<{ ok: true }>;
  get(code: string): Promise<{ affiliate: { code: string; display_name: string; avatar?: string; discount?: { type: "percent" | "amount"; value: number } | null } | null }>;
}

export interface InsightsInitOptions {
  autoPageviews?: boolean;
  /** "tagged" (default): elements with data-track="<event>"; true: every link/button; false: none. */
  autoClicks?: boolean | "tagged";
  flushIntervalMs?: number;
  /** Default true: DNT / GPC disables collection entirely. */
  respectDNT?: boolean;
}

/** One event in a POST /api/site/insights batch (the platform ingest contract). */
export interface InsightsEvent {
  type: "pageview" | "click" | "session_start" | "custom";
  /** Event name: "cta_click", "phone_click", "lead_submitted". Max 200 chars. */
  name?: string;
  /** Path (+query); the platform reports on the bare path. */
  path?: string;
  referrer?: string;
  title?: string;
  /** Epoch milliseconds on the client. */
  ts: number;
  session_id?: string;
  /** Click target detail (click events). */
  el?: { tag: string; text: string; href: string; id: string; outbound: boolean };
  props?: Record<string, unknown>;
}

/** The batch envelope the collector sends. */
export interface InsightsEnvelope {
  visitor_id: string;
  session_id: string;
  attribution: {
    /** First touch: immutable on the platform once set. */
    ft: { source?: string; medium?: string; campaign?: string; term?: string; content?: string; referrer?: string; landing?: string; at?: string | number };
    /** Last touch, snapshotted onto every event. */
    lt: { source?: string; medium?: string; campaign?: string };
  };
  device: { type?: "desktop" | "mobile" | "tablet"; browser?: string; os?: string; screen?: string };
  /** At most 100 per batch. */
  events: InsightsEvent[];
}

export declare class InsightsModule {
  readonly enabled: boolean;
  init(options?: InsightsInitOptions): { active: boolean };
  destroy(): void;
  pageview(path?: string): void;
  track(name: string, props?: Record<string, unknown>): void;
  /** A click: recorded as type "click" with el {tag, text: label, href, id, outbound}. tel:/mailto:/outbound links flush at once. */
  trackClick(name: string, props?: { label?: string; href?: string; id?: string; tag?: string; [key: string]: unknown }): void;
  /** A goal (lead sent, purchase): a "custom" event with props.conversion = true, flushed at once. */
  conversion(name?: string, props?: Record<string, unknown>): void;
  notifyRouteChange(path?: string): void;
  getVisitorId(): string;
  getSessionId(): string;
  /** Send queued events now, in batches of up to 100. Beacon when useBeacon (page hide/unload). */
  flush(useBeacon?: boolean): void;
}

// ─── Client ───────────────────────────────────────────────────────────────

export declare class SiteClient {
  constructor(options?: SiteClientOptions);
  readonly key: string;
  readonly kind: "public" | "secret";
  readonly environment: "live" | "test";
  readonly baseURL: string;
  readonly platform: string | null;
  readonly isServerSide: boolean;
  readonly customerToken: string | null;

  content: ContentModule;
  files: FilesModule;
  pageGroups: PageGroupsModule;
  blog: BlogModule;
  products: ProductsModule;
  categories: CategoriesModule;
  cart: CartModule;
  checkout: CheckoutModule;
  subscriptions: SubscriptionsModule;
  customers: CustomersModule;
  /** Alias of customers. */
  auth: CustomersModule;
  reviews: ReviewsModule;
  plumbers: PlumbersModule;
  regulations: RegulationsModule;
  leads: LeadsModule;
  insights: InsightsModule;
  /** Alias of insights. */
  tracking: InsightsModule;
  legal: LegalModule;
  forms: FormsModule;
  quotes: QuotesModule;
  hardness: HardnessModule;
  org: OrgModule;
  affiliates: AffiliatesModule;
  attribution: AttributionModule;
  jobs: JobsModule;
  refills: RefillsModule;

  pageGroup(slug: string): PageGroup;
  setCustomerToken(token: string | null): this;
  /** A client acting as one signed-in customer, sharing key and pairing. */
  asCustomer(token: string | null | undefined): SiteClient;
  whoami(): Promise<SiteWhoami>;
}

export default SiteClient;

/* ---------- Categories ---------- */

export interface CategoryFile { url: string; label: string; name: string }
export interface CategoryImage { url: string; alt: string; label: string }

export interface Category {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  /** HTML from the dashboard's rich text editor. */
  description: string;
  parentId: string;
  sort: number;
  visible: boolean;
  showInHome: boolean;
  navbarName: string;
  navbarCaption: string;
  /** Square cover. */
  image: string;
  /** 16:9. */
  heroImage: string;
  /** 9:16. */
  heroImageMobile: string;
  seo: { title: string; description: string; keywords: string; ogImage: string; schemaJson: string };
  faqs: { question: string; answer: string }[];
  files: CategoryFile[];
  gallery: CategoryImage[];
  customFields: Record<string, unknown>;
  updatedAt: string;
}

export declare class CategoriesModule {
  /** Every visible category of the site's org, flat; nest by parentId. */
  list(): Promise<Category[]>;
  /** One category by slug, or null. */
  get(slug: string): Promise<Category | null>;
  resolve(categoryOrSlug: Category | string): Promise<Category | null>;
  /** The file with this label, e.g. "category_pdf". */
  file(categoryOrSlug: Category | string, label: string): Promise<CategoryFile | null>;
  fileUrl(categoryOrSlug: Category | string, label: string): Promise<string | null>;
  /** The gallery image with this label, e.g. "showroom". */
  image(categoryOrSlug: Category | string, label: string): Promise<CategoryImage | null>;
  gallery(categoryOrSlug: Category | string): Promise<CategoryImage[]>;
  customField<T = unknown>(category: Category | null | undefined, key: string, fallback?: T): T | undefined;
  children(all: Category[], categoryOrId: Category | string): Category[];
}

export declare function toCategory(record: SiteRecord | null | undefined): Category | null;
