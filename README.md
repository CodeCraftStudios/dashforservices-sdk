# dashforservices-sdk

The **DashForServices public-site SDK**: what a DashForServices tenant's website runs on.
That covers the landing page, blog, service and city pages, page groups, the store
(products, cart, Stripe checkout, filter subscriptions), install quotes and quote
checkout, reviews, the plumber directory, tap water quality and local regulations,
lead and quote forms with attribution and SMS consent, affiliates, first-party
click tracking, legal pages and the customer portal (orders, installs, refills,
subscriptions).

It talks to the Dash4Devs **site surface** (`/api/site/*`) with a per-site key, the
same way `localplug-sdk` does for LocalPlug SEO client sites. Private; installs
from the repo, never npm.

> Status: `0.1.0-alpha`. About a third of the endpoints exist on Dash4Devs today.
> The rest are specified in `../servicedash/docs/backend-modules.md` and must be built as
> DashForServices platform modules. See [Backend status](#backend-status). A call to
> an endpoint that doesn't exist yet throws a `DashForServicesError` (status 404) whose
> message says so.

## Install

Pin a commit tarball, like `dash4devs-platform`:

```jsonc
// package.json
"dependencies": {
  "dashforservices-sdk": "https://github.com/CodeCraftStudios/dashforservices-sdk/archive/<commit-sha>.tar.gz"
}
```

or `npm install github:CodeCraftStudios/dashforservices-sdk`. The package ships plain
ESM and JSX with no build step, so let Next compile it:

```ts
// next.config.ts
export default { transpilePackages: ["dashforservices-sdk"] };
```

## Files (Media Library)

Everything uploaded in the dashboard's **Media library** is available to the site.
Find files by **label or name**, no ids needed:

```ts
const hero = await sd.files.find("hero");                 // SiteFile | null
const heroUrl = await sd.files.url("hero");               // string | null
const logo = await sd.files.folder("Brand").find("logo"); // inside a folder (name or "Brand/Logos" path)
const gallery = await sd.files.folder("Gallery").all();   // every file in a folder
// Aliases if you prefer the long names:
await sd.files.getFileOrReturnNull("hero");
await sd.files.getFolder("Brand").getFileOrReturnNull("logo");
```

Matching order: exact label, then name, name without extension, a loose match
(ignoring case and punctuation), then whole words, so `"hero"` finds `hero.png`,
`Hero Image.jpg` or `hero-banner.png` (but not `superhero.png`). Set a **label** on a
file in the dashboard when you want a guaranteed, rename-proof handle.
Endpoint: `GET /api/site/files?label=&folder=&limit=&offset=` (module `media`, exists today).

## Categories

Product categories as edited on the dashboard's category page, with their labeled
files and gallery images. A site only sees its own org's categories, and only ones
marked visible.

```ts
const cat = await sd.categories.get("water-softeners");          // Category | null
cat.image; cat.heroImage; cat.heroImageMobile;                     // cover (1:1), hero (16:9), mobile hero (9:16)

const pdf = await sd.categories.file(cat, "category_pdf");         // { url, label, name } | null
const pdfUrl = await sd.categories.fileUrl("water-softeners", "category_pdf");
const shot = await sd.categories.image(cat, "showroom");           // { url, alt, label } | null
const all = await sd.categories.gallery(cat);                      // in dashboard order

sd.categories.customField(cat, "warranty_years", 0);               // any JSON value from Custom fields
const tree = await sd.categories.list();                           // flat; nest by parentId
```

Labels are set in the dashboard when a file or gallery image is added
(lowercase letters, digits, `_` or `-`, unique within the category).
Endpoints: `GET /api/site/categories`, `/api/site/categories/<slug>` (module `inventory`, exists today).

## Keys and env

Each tenant site gets its own keys in **DashForServices dashboard: Website, then API keys**.
The value is shown once.

```
dfd-site-secret-key-live-<random>   server only; full site surface
dfd-site-public-key-live-<random>   browser-safe; reads + visitor writes (leads, forms, cart, checkout, reviews); origin-locked
dfd-site-*-key-test-<random>        same, against test data
```

These are **not** `dfd-platform-*` keys. A platform key belongs to the dashboard,
never to a website.

| Variable | Where | Purpose |
| --- | --- | --- |
| `DASHFORSERVICES_SITE_KEY` | server only | Secret (or public) key for server components, route handlers, the CLI |
| `NEXT_PUBLIC_DASHFORSERVICES_SITE_KEY` | browser | Public key only |
| `DASHFORSERVICES_API_URL` | both | API host; default `https://api.dashfordevs.com` |
| `NEXT_PUBLIC_DASHFORSERVICES_API_URL` | browser | API host for browser calls (tracking, cart, forms). Set it whenever you set `DASHFORSERVICES_API_URL` to a non-default host |
| `DASHFORSERVICES_PLATFORM` | server, optional | Platform slug `createSiteClient()` asserts |

Guards: constructing a client with a **secret** key in a browser throws, putting a
secret key in **any** `NEXT_PUBLIC_*` variable throws, and importing
`dashforservices-sdk/server` in a browser bundle throws at module load.

### Pairing

Unlike `localplug-sdk`, this SDK is not hardwired to one platform slug, because
each DashForServices tenant can be its own Dash4Devs platform. Pass `platform` and the
first call checks `/api/site/whoami`; a key from another platform is rejected
(`code: "platform_mismatch"`). Leave it out and any valid site key is accepted,
with no extra round-trip.

```ts
new SiteClient({ key, platform: "servicedash-clearline" });
```

## Quick start (Next.js App Router)

### 1. One client module

```ts
// lib/servicedash.ts (browser-safe: public key)
import { SiteClient } from "dashforservices-sdk";

export const sd = new SiteClient({
  key: process.env.NEXT_PUBLIC_DASHFORSERVICES_SITE_KEY, // written literally so Next inlines it
  checkout: { mode: "session" },
});
```

```ts
// lib/servicedash.server.ts (server only: secret key)
import "server-only";
import { createSiteClient } from "dashforservices-sdk/server";

export const sdServer = createSiteClient(); // DASHFORSERVICES_SITE_KEY, DASHFORSERVICES_API_URL, DASHFORSERVICES_PLATFORM
```

### 2. Server components read content

Server GETs under a production build are cached with
`next: { revalidate: 300, tags: ["servicedash", ...] }`. Every module adds its
own tag (`servicedash:products`, `servicedash:product:<slug>`,
`servicedash:page-group:<slug>`, ...), so a dashboard webhook can call
`revalidateTag()`. Per-customer calls and live reads (quotes, cart, search) are
never cached. A 429 on a GET is waited out (up to 4 tries) instead of failing a
static build. Writes are never retried.

```tsx
// app/water-softeners/[city]/page.tsx
import { sdServer as sd } from "@/lib/dashforservices.server";

export async function generateStaticParams() {
  return (await sd.pageGroup("cities").slugs()).map((city) => ({ city }));
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const { item } = await sd.pageGroup("cities").get(city);
  const zip = String(item.custom_fields?.zip ?? "");
  const [water, { regulation }, { plumbers }] = await Promise.all([
    sd.water.byZip(zip),
    sd.regulations.lookup({ zip }),
    sd.plumbers.search({ zip, limit: 6 }),
  ]);
  return <CityView item={item} water={water} regulation={regulation} plumbers={plumbers} />;
}
```

### 3. Providers: attribution, pageviews, cart

```tsx
// app/providers.tsx
"use client";
import { DashForServicesProvider, PageView } from "dashforservices-sdk/react";
import { sd } from "@/lib/dashforservices";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DashForServicesProvider client={sd}>
      <PageView />
      {children}
    </DashForServicesProvider>
  );
}
```

The provider captures attribution on landing (utm, gclid/fbclid, video id,
`?ref=` affiliate code). `<PageView/>` starts insights and follows App Router
navigations; pass `path={usePathname()}` if you would rather drive it yourself.

### 4. Client cart and checkout

```tsx
"use client";
import { useCart, useDashForServices, TrackClick } from "dashforservices-sdk/react";

export function AddToCart({ product, size, plan }) {
  const { add } = useCart();
  return (
    <TrackClick event="add_to_cart" label={product.name}>
      <button
        onClick={() =>
          add({
            productId: product.id,
            sizeId: size.id,
            planId: plan?.id, // omit for one-time
            snapshot: { name: product.name, sizeName: size.name, price: plan ? plan.price : size.price, image: product.main_image?.url },
          })
        }
      >
        {plan ? `Subscribe and save ${plan.discount_percent}%` : "Add to cart"}
      </button>
    </TrackClick>
  );
}

export function CheckoutButton({ customer, shippingAddress }) {
  const sd = useDashForServices();
  const { sync, isEmpty } = useCart();
  return (
    <button
      disabled={isEmpty}
      onClick={async () => {
        await sync(); // the platform reprices; never trust browser prices
        const session = await sd.checkout.create({
          customer,
          shippingAddress,
          successUrl: `${location.origin}/thanks?session={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${location.origin}/cart`,
        });
        sd.checkout.redirect(session);
      }}
    >
      Checkout
    </button>
  );
}
```

### 5. Lead form with consent and attribution

```tsx
"use client";
import { useDashForServices } from "dashforservices-sdk/react";

const SMS_CONSENT_VERSION = "sms-2026-10"; // matches the legal page your lawyer approved

export function QuoteForm() {
  const sd = useDashForServices();
  async function onSubmit(form: FormData) {
    await sd.leads.requestQuote(
      {
        firstName: String(form.get("first_name")),
        phone: String(form.get("phone")),
        email: String(form.get("email")),
        zip: String(form.get("zip")),
        customerType: "homeowner",
        householdSize: Number(form.get("people")),
        waterSource: form.get("well") ? "well" : "city",
      },
      {
        smsConsent: form.get("sms_consent") === "on", // explicit, true or false
        consentTextVersion: SMS_CONSENT_VERSION,
        honeypot: String(form.get("company_website") ?? ""),
      }
    );
  }
  // ...
}
```

Attribution (`source`, `medium`, `campaign`, `gclid`, `fbclid`, `video_id`,
`affiliate_code`, landing page, referrer, first and last touch) is attached
automatically. On the server, read the same thing from cookies with
`attributionFromCookies(request.headers.get("cookie"))`.

### 6. Customer portal on the server

Never put one customer's token on a shared module-level client. Derive one per
request:

```ts
// app/account/installs/page.tsx
import { cookies } from "next/headers";
import { sdServer } from "@/lib/dashforservices.server";

export default async function Installs() {
  const me = sdServer.asCustomer((await cookies()).get("sd_customer")?.value);
  const [{ jobs }, { subscriptions }, { refills }] = await Promise.all([
    me.jobs.list(),
    me.subscriptions.list(),
    me.refills.list(),
  ]);
  // ...
}
```

Sign-in sets that cookie from your own route handler:
`const { token } = await sdServer.auth.login({ email, password })`, then set it
httpOnly. In a pure browser flow, `sd.auth.login(creds, { persist: true })` keeps
the token in localStorage instead.

## Modules

`sd.<module>.<method>`. **P** = works with a public key from the browser.
**C** = needs a signed-in customer (`sd.auth.login()` or `sd.asCustomer(token)`).

| Module | Methods | Notes |
| --- | --- | --- |
| client | `whoami()`, `pageGroup(slug)`, `asCustomer(token)`, `setCustomerToken(t)` | |
| `content` | `list({section})`, `get(slug)`, `data(slug)`, `section(name)` | Managed copy; site rows beat shared ones. P |
| `pageGroups` / `pageGroup(slug)` | `list()`; fluent `.all({limit,offset})`, `.get(item)`, `.filter(spec or fn)`, `.find()`, `.count()`, `.slugs()` | Services, cities, cost pages, FAQs. `filter({state:"AZ"})` matches top level, then `metadata`, then `custom_fields`. P |
| `blog` | `list({category,tag,search,featured,city,page,customFields})`, `get(slug)`, `post(slug)`, `categories()`, `related(slug)` | P |
| `legal` | `list()`, `get(slug,{version})`, `document(slug)` | `version` is what consent and agreements reference. P |
| `forms` | `get(key)`, `submit(key, values, {honeypot, meta})` | Dashboard-built forms; attribution added to meta. P |
| `products` | `list({category,search,kind})`, `get(slug)`, `data(slug)`, `search(q)`, `categories()`, `category(slug)`; helpers `sizes(p)`, `subscriptionPlans(p, sizeId)`, `isSubscribable(p)`, `planPrice(base, plan)`, `cadence(plan)` | Plans are per size: `{id,name,interval_length,interval_unit,discount_percent,price}`. P |
| `cart` | `add({productId,sizeId,quantity,planId,snapshot})`, `update(key,qty)`, `setPlan(key,planId)`, `remove(key)`, `clear()`, `setCode(code)`, `sync()`, `load(id)`, `hydrate()`, `subscribe(fn)`, `toPayload()`; getters `lines`, `count`, `subtotal`, `totals`, `hasSubscription` | Local-first (localStorage `sd_cart`), synced on demand or `autoSync`. A line is one-time or a subscription; different cadences never merge. P |
| `checkout` | `create({cart,customer,shippingAddress,billingAddress,successUrl,cancelUrl,mode,endpoint})`, `redirect(result)`, `get(sessionId)`, `forward(body)`, `fromQuote(token,{acceptPurchaseTerms,acceptInstallAgreement,tier,signatureName,agreementVersions,successUrl,cancelUrl})`, `buildBody(input)` | See [Checkout transports](#checkout-transports). P |
| `quotes` | `get(token)`, `select(token, tier)`, `ask(token,{message})`, `checkout(token, input)` | The `/q/<token>` checkout link. Tiers: good, better, best, ultimate. P |
| `customers` / `auth` | `subscribe({email,...})`; `login`, `register`, `requestLoginLink`, `verifyLoginLink`, `requestPasswordReset`, `me`, `updateMe`, `logout`, `setToken`; portal `orders()`, `order(id)` | `subscribe` is newsletter capture (P); the rest is portal auth (C for me/orders) |
| `subscriptions` | `list()`, `get(id)`, `pause(id,{until})`, `resume`, `skip`, `cancel(id,{reason})`, `resubscribe`, `changePlan(id, planId, {quantity})`, `reschedule(id, date)`, `updateAddress`, `updatePayment` | Subscribe & Save for filters and salt. Started by checking out a subscription line. C |
| `refills` | `list()`, `reorder(id)`, `dismiss(id)`, `addToCart(refill, planId?)` | What the system needs next, for non-subscribers too. C |
| `jobs` | `list()`, `get(id)`, `signOff(id,{signatureName})`, `requestReschedule(id)`, `reportProblem(id)`; helper `progress(job)`; constants `JOB_STEPS`, `CUSTOMER_JOB_STEPS` | Install tracking: shipped, delivered, install date, plumber. C |
| `reviews` | `list({product or plumber, sort, rating, withPhotos})`, `summary()`, `submit({product or plumber, rating, body, name, ...})`, `markHelpful(id)` | Moderated; verified when tied to an order or job. P |
| `plumbers` | `search({zip} or {state,county,city})`, `get(slug)`, `areas({state})`, `coverage(zip)`, `requestInstall({..., smsConsent})` | Public directory profile only. P |
| `regulations` | `lookup({zip} or {city,state})`, `state(code)`, helper `requirement(reg, key)` | Most specific jurisdiction wins. P |
| `water` | `byZip(zip, {report})`, `system(pws)`; helpers `exceeding(report)`, `other(report)`, `filtersFor(report)`; constant `WATER_FILTERS` | EWG Tap Water Database by ZIP: the utilities serving it and the featured utility's contaminant report. Credit EWG (`report.source_url`). P |
| `leads` | `submit(data, {kind, smsConsent, consentTextVersion, consentText, emailConsent, honeypot})`, `requestQuote`, `requestWaterTest`, `requestCallback`, `contact`; constants `LEAD_KINDS`, `WATER_CONCERNS`, ... | `smsConsent` must be an explicit boolean; `consentTextVersion` is required when it is true. Homeowner fields (ownsHome, waterSource, householdSize, concerns, problems, timeline) or commercial fields (company, businessType, locations, unitsOrRooms, dailyUsageGallons). P |
| `attribution` | `capture()`, `get()`, `snapshot()`, `affiliateCode`, `clear()`; `attributionFromCookies(header)` | First-party: localStorage + cookies `sd_attr` and `sd_ref` |
| `affiliates` | `track(code)`, `recordClick(code)`, `get(code)` | `?ref=CODE` is tracked automatically on landing. P |
| `insights` / `tracking` | `init({autoPageviews, autoClicks, respectDNT})`, `pageview()`, `track(name, props)`, `trackClick(name,{label,href,id,tag})`, `conversion(name, props)`, `notifyRouteChange()`, `flush()`, `getVisitorId()`, `getSessionId()`, `destroy()` | Batched (flush every 5 s, at 20 events, max 100 per request), `sendBeacon` on hide/unload, visitor id `sd_vid`, session `sd_ses` (30 idle minutes; a new session sends `session_start`), respects DNT and GPC. `track("cta_click",{label,href})` is recorded as a click. `data-track="event"` on any element is captured automatically. P |

### Insights wire format

What `insights` sends, exactly as the platform ingest (`platforms/insights_views.py`) reads it. The key rides in `?k=` and the body is JSON sent as `text/plain`, so neither `fetch` nor `sendBeacon` triggers a CORS preflight; a live public key must still match its allowed origins.

```json
{
  "visitor_id": "v_…", "session_id": "s_…",
  "attribution": {
    "ft": { "source": "google", "medium": "cpc", "campaign": "…", "term": "…", "content": "…", "referrer": "…", "landing": "https://site/…?utm_…", "at": "2026-10-06T…Z" },
    "lt": { "source": "google", "medium": "cpc", "campaign": "…" }
  },
  "device": { "type": "mobile", "browser": "Safari", "os": "iOS", "screen": "390x844" },
  "events": [
    { "type": "session_start", "ts": 1759770000000, "session_id": "s_…" },
    { "type": "pageview", "ts": 1759770000001, "session_id": "s_…", "path": "/", "referrer": "", "title": "…" },
    { "type": "click", "name": "phone_click", "ts": 1759770004000, "session_id": "s_…", "path": "/",
      "el": { "tag": "a", "text": "Footer call", "href": "tel:+1…", "id": "", "outbound": false },
      "props": { "label": "Footer call", "href": "tel:+1…" } },
    { "type": "custom", "name": "lead_submitted", "ts": 1759770050000, "path": "/", "props": { "conversion": true } }
  ]
}
```

Bots are classified from the user agent and kept out of reports; the client IP is only stored hashed.

### React (`dashforservices-sdk/react`)

| Export | What it does |
| --- | --- |
| `<DashForServicesProvider client={sd}>` | Provides the client; captures attribution on mount |
| `useDashForServices()` | The client |
| `useCart({autoSync})` | Live cart: `lines`, `count`, `subtotal`, `totals`, `add`, `update`, `setPlan`, `remove`, `clear`, `sync`, `syncing`, `error`. Persists to localStorage, follows other tabs, renders empty on the server so hydration matches |
| `<TrackClick event label href props>` | Records a click on its single child (no wrapper element), then runs the child's own `onClick` |
| `<PageView path? options?/>` | Starts insights; automatic pageviews or controlled by `path` |

### Checkout transports

`checkout.create()` posts one body (`cart`, `customer`, `shipping_address`,
`billing_address`, `success_url`, `cancel_url`, `mode`, `code`, `attribution`)
to one of two places:

1. **Platform (default)**: `POST /api/site/checkout/sessions` with the public
   key. The platform reprices, reserves stock, creates the Stripe Checkout Session
   (or a PaymentIntent with `mode: "payment_intent"` for an embedded Payment
   Element) on the tenant's Stripe account, and turns the webhook into an order.
   Subscription lines put the session in subscription or `setup_future_usage`
   mode; the SDK call doesn't change.
2. **Tenant route**: `checkout.create({ ..., endpoint: "/api/checkout" })` (or
   `new SiteClient({ checkout: { endpoint } })`) posts the same body to the
   site's own route handler, same origin and keyless. Use it when the site has
   to own part of the flow (captcha, a CRM hook):

   ```ts
   // app/api/checkout/route.ts
   import { sdServer } from "@/lib/dashforservices.server";
   export async function POST(req: Request) {
     const body = await req.json(); // the buildBody() shape
     // ...verify captcha, enrich body.metadata...
     const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;
     return Response.json(await sdServer.checkout.forward(body, { idempotencyKey }));
   }
   ```

Both send an `Idempotency-Key` header (a fresh one per call unless you pass
`idempotencyKey`).

`checkout.fromQuote(token, {...})` is the install path: it charges the equipment
now and saves the card (`setup_future_usage=off_session`). After the plumber marks
the job installed and the customer signs off, the platform charges the install
fee as a **direct charge on the plumber's Stripe Connect account**. In Florida
(`install.fee_timing: "at_booking"`) the install fee is charged at booking with
the system, and the plumber is paid out weekly. Both agreement checkboxes must be
true or the SDK throws before any request.

## CLI

```bash
npx servicedash status          # site, platform, key kind/env, enabled modules
npx servicedash status --json
```

Reads `DASHFORSERVICES_SITE_KEY` (or the public key), `DASHFORSERVICES_API_URL` and
`DASHFORSERVICES_PLATFORM` from env, `.env.local` and `.env`. No image CDN commands
yet.

## Backend status

Every endpoint the SDK calls, and whether it exists on the Dash4Devs site
surface today. Everything marked **NEW** is specified in
[`../servicedash/docs/backend-modules.md`](../servicedash/docs/backend-modules.md) and must be built as
a DashForServices platform module (the platform module key that gates it is in the
last column).

| SDK call | Endpoint | Today | Module |
| --- | --- | --- | --- |
| `whoami()`, pairing, CLI | `GET /api/site/whoami` | **Exists** | (any key) |
| `content.*` | `GET /api/site/content`, `/content/<slug>` | **Exists** | `pages` |
| `products.list/get/data` | `GET /api/site/products`, `/products/<slug>` | **Exists** | `inventory` |
| `products.search`, `?kind=` | `GET /api/site/products?search=` | Partial: endpoint exists, `search`/`kind` params NEW | `inventory` |
| `products.sizes/subscriptionPlans` | `sizes[].subscription_plans` on the product payload | NEW payload fields (falls back to today's `variants`) | `subscriptions` |
| `products.categories/category` | `GET /api/site/categories`, `/categories/<slug>` | **Exists** | `inventory` |
| `forms.get/submit` | `GET /api/site/forms/<key>`, `POST .../submissions` | **Exists** | `forms` |
| `leads.*` | `POST /api/site/leads` | **Exists** (writes a `contact`). Routing into `install_lead` with call timer, consent and sequences is NEW | `contacts`, then `install_crm` |
| `customers.subscribe` | `POST /api/site/customers` | **Exists** | `customers` |
| `insights.*` | `POST /api/site/insights?k=<key>` (text/plain JSON, no preflight); reports: `GET /api/platform/sites/<website id>/insights?days=N` (platform key) | **Exists** (pageview, click, session_start, custom). The report returns totals, a timeseries, top pages, referrers and first-touch UTM; click, event, device and geo breakdowns are NEW | `websites` |
| (not wrapped) | `/api/site/locations`, `/files`, `/cdn/*`, `/klaviyo`, giveaways | Exist; not used by DashForServices sites yet | |
| `pageGroup(slug).*`, `pageGroups.list` | `GET /api/site/page-groups`, `/<group>`, `/<group>/<item>` | NEW | `pages` |
| `blog.*` | `GET /api/site/blog/posts`, `/posts/<slug>`, `/posts/<slug>/related`, `/blog/categories` | NEW | `blog` |
| `legal.*` | `GET /api/site/legal`, `/legal/<slug>` | NEW | `legal` |
| `cart.sync/load` | `POST /api/site/carts`, `GET /api/site/carts/<id>` | NEW | `carts` |
| `checkout.create/get` | `POST /api/site/checkout/sessions`, `GET .../sessions/<id>` | NEW (Django app: Stripe webhooks, stock reservations) | `checkout` |
| `quotes.*` | `GET /api/site/quotes/<token>`, `POST .../select`, `.../questions` | NEW | `quotes` |
| `checkout.fromQuote` | `POST /api/site/quotes/<token>/checkout` | NEW (Django app: Stripe Connect) | `quotes`, `payments` |
| `auth.login/register/logout/me/updateMe`, magic link, reset | `/api/site/auth/login`, `/register`, `/logout`, `/me`, `/magic-link`, `/magic-link/verify`, `/password-reset` | NEW on the site surface (`/api/platform/portal/login` exists on platform keys only) | `customers` |
| `customers.orders/order` | `GET /api/site/orders`, `/orders/<id>` | NEW | `orders` |
| `subscriptions.*` | `GET /api/site/subscriptions`, `/<id>`; `POST /<id>/pause`, `resume`, `skip`, `cancel`, `resubscribe`, `change-plan`, `reschedule`, `update-address`, `update-payment` | NEW (Django app: billing schedule) | `subscriptions` |
| `refills.*` | `GET /api/site/refills`, `POST /<id>/reorder`, `/<id>/dismiss` | NEW | `subscriptions` |
| `jobs.*` | `GET /api/site/jobs`, `/<id>`; `POST /<id>/sign-off`, `/reschedule-request`, `/problem` | NEW | `jobs` |
| `reviews.*` | `GET /api/site/reviews`, `/reviews/summary`; `POST /api/site/reviews`, `/reviews/<id>/helpful` | NEW | `reviews` |
| `plumbers.*` | `GET /api/site/plumbers`, `/plumbers/areas`, `/plumbers/coverage`, `/plumbers/<slug>`; `POST /plumbers/install-requests` | NEW | `plumbers`, `dispatch` |
| `regulations.*` | `GET /api/site/regulations`, `/regulations/<state>` | NEW | `regulations` |
| `water.*` | `GET /api/site/water?zip=`, `?pws=` | EXISTS | `records` + the org's `tap_water` table |
| `affiliates.*`, auto `?ref=` | `POST /api/site/affiliates/clicks`, `GET /api/site/affiliates/<code>` | NEW | `affiliates` |

## Errors

Every failed call, including network failures (`status: 0`, `code: "network_error"`), throws `DashForServicesError` with `status`, `code` (the platform's
`error` field) and `payload`. The common ones explain themselves:
`origin_not_allowed` (add the domain to the key), `secret_key_required` (make the
call server-side), `key_revoked`, `module_not_enabled` (see the table above),
`not_signed_in` (portal call with no customer token), `platform_mismatch`.
