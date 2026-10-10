/**
 * Product categories, as edited on the dashboard's category page: copy, display
 * settings, images, SEO, FAQs, labeled files, a labeled gallery and custom
 * fields. Files and gallery images are found by the label set in the dashboard.
 *
 *   const cat = await sd.categories.get("water-softeners");
 *   const pdf = await sd.categories.file(cat, "category_pdf");    // { url, label, name } | null
 *   const shot = await sd.categories.image("water-softeners", "showroom"); // { url, alt, label } | null
 *   const years = sd.categories.customField(cat, "warranty_years"); // 10
 *
 * Every method takes a category object or its slug. Only categories marked
 * visible reach a site, and a site only sees its own org's categories.
 *
 * Backend: EXISTS. GET /api/site/categories, /api/site/categories/<slug>
 * (module `inventory`).
 */

const unset = (v) => v === null || v === undefined || v === "" || v === "None" || v === "null";
const str = (v) => (unset(v) ? "" : String(v));
const bool = (v, d = false) => (unset(v) ? d : v === true || v === "True" || v === "true");
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);

/** Custom fields are stored as JSON text (older rows: a list of {key, value}). */
function customFields(v) {
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through */
    }
  }
  if (Array.isArray(v)) return Object.fromEntries(list(v).map((f) => [str(f.key), f.value]).filter(([k]) => k));
  if (v && typeof v === "object") return v;
  return {};
}

/** A site category record -> a plain category object. */
export function toCategory(record) {
  if (!record) return null;
  const d = record.data || {};
  const seo = d.seo && typeof d.seo === "object" ? d.seo : {};
  return {
    id: record.id,
    slug: str(d.slug),
    name: str(d.name),
    shortDescription: str(d.short_description),
    /** HTML from the dashboard's rich text editor. */
    description: str(d.description),
    parentId: str(d.parent_id),
    sort: Number(d.sort) || 0,
    visible: bool(d.visible, true),
    showInHome: bool(d.show_in_home),
    navbarName: str(d.navbar_name) || str(d.name),
    navbarCaption: str(d.navbar_caption),
    image: str(d.image),
    heroImage: str(d.hero_image),
    heroImageMobile: str(d.hero_image_mobile),
    seo: {
      title: str(seo.title) || str(d.name),
      description: str(seo.description),
      keywords: str(seo.keywords),
      ogImage: str(seo.ogImage),
      schemaJson: str(seo.schemaJson),
    },
    faqs: list(d.faqs).map((f) => ({ question: str(f.question), answer: str(f.answer) })).filter((f) => f.question),
    files: list(d.files).map((f) => ({ url: str(f.url), label: str(f.label), name: str(f.name) })).filter((f) => f.url),
    // Alt text falls back to the label ("showroom_front" -> "showroom front").
    gallery: list(d.gallery).map((g) => ({ url: str(g.url), alt: str(g.alt) || str(g.label).replace(/[_-]+/g, " "), label: str(g.label) })).filter((g) => g.url),
    customFields: customFields(d.custom_fields),
    updatedAt: record.updated_at,
  };
}

export class CategoriesModule {
  constructor(client) {
    this.client = client;
  }

  /** Every visible category, flat; nest them by `parentId`. */
  async list() {
    const res = await this.client._fetch("/api/site/categories", { tags: ["servicedash:categories"] });
    return (res?.categories || []).map(toCategory).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  }

  /** One category by slug, or null when there's no visible one. */
  async get(slug) {
    try {
      const res = await this.client._fetch(`/api/site/categories/${encodeURIComponent(slug)}`, { tags: ["servicedash:categories", `servicedash:category:${slug}`] });
      return toCategory(res?.category);
    } catch (err) {
      if (err && err.status === 404) return null;
      throw err;
    }
  }

  /** A category object as-is, or fetch it by slug. */
  async resolve(categoryOrSlug) {
    return typeof categoryOrSlug === "string" ? this.get(categoryOrSlug) : categoryOrSlug || null;
  }

  /** The file with this label ("category_pdf"), or null. */
  async file(categoryOrSlug, label) {
    const cat = await this.resolve(categoryOrSlug);
    return cat?.files.find((f) => f.label === label) ?? null;
  }

  /** Just the URL of the file with this label, or null. */
  async fileUrl(categoryOrSlug, label) {
    return (await this.file(categoryOrSlug, label))?.url ?? null;
  }

  /** The gallery image with this label ("showroom"), or null. */
  async image(categoryOrSlug, label) {
    const cat = await this.resolve(categoryOrSlug);
    return cat?.gallery.find((g) => g.label === label) ?? null;
  }

  /** The whole gallery, in the order set in the dashboard. */
  async gallery(categoryOrSlug) {
    return (await this.resolve(categoryOrSlug))?.gallery ?? [];
  }

  /** A custom field's value (any JSON), or `fallback`. Synchronous: pass a category object. */
  customField(category, key, fallback = undefined) {
    const v = category?.customFields?.[key];
    return v === undefined ? fallback : v;
  }

  /** Subcategories of a category, from a list(). */
  children(all, categoryOrId) {
    const id = typeof categoryOrId === "string" ? categoryOrId : categoryOrId?.id;
    return all.filter((c) => c.parentId === id);
  }
}
