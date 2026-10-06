/**
 * Files: the site's slice of the tenant's Media Library (dashboard → Media library).
 *
 * Backend: GET /api/site/files (platform module `media`). It filters by exact
 * `label` and by `folder` (folder name or full path, e.g. "Brand/Logos"), and
 * returns this site's files plus the platform's shared pool. URLs are public CDN
 * URLs, safe for <img src>. Each file carries {lqip, variants_ready, variants}
 * for blur-up images.
 *
 * Finding by name happens here, because the backend has no name filter. A name
 * matches, in order: the file's label, its name, its name without the
 * extension, a loose match ignoring case, spaces and punctuation, and finally a
 * whole-word match. So "hero" finds a file labelled "hero", or one named
 * "hero.png", "Hero Image.jpg" or "hero-banner.png" (but not "superhero.png").
 *
 *   const hero = await sd.files.find("hero");                    // file | null
 *   const url  = await sd.files.url("hero");                     // string | null
 *   const logo = await sd.files.folder("Brand").find("logo");    // file | null
 *   const all  = await sd.files.folder("Gallery").all();         // file[]
 */

const PAGE = 200; // backend max

const stripExt = (s) => s.replace(/\.[a-z0-9]{1,5}$/i, "");
const loose = (s) => stripExt(String(s ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, "");
const words = (s) => stripExt(String(s ?? "")).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** Whether `key`'s words appear together, as whole words, in `name`. */
const hasWords = (name, key) => {
  const n = words(name);
  const k = words(key);
  if (!k.length) return false;
  for (let i = 0; i + k.length <= n.length; i++) if (k.every((w, j) => n[i + j] === w)) return true;
  return false;
};

/** The best match for `key` in `files`, or null. Exported for tests. */
export function matchFile(files, key) {
  if (!key) return null;
  const k = String(key);
  const kl = k.toLowerCase();
  const kLoose = loose(k);
  return (
    files.find((f) => f.label && f.label === k) ||
    files.find((f) => String(f.name ?? "").toLowerCase() === kl) ||
    files.find((f) => stripExt(String(f.name ?? "")).toLowerCase() === kl) ||
    files.find((f) => String(f.original_filename ?? "").toLowerCase() === kl) ||
    (kLoose && files.find((f) => loose(f.name) === kLoose || loose(f.original_filename) === kLoose)) ||
    files.find((f) => hasWords(f.name, k)) ||
    null
  );
}

export class FilesModule {
  constructor(client) {
    this.client = client;
  }

  /**
   * One page of files.
   * @param {{folder?: string, label?: string, limit?: number, offset?: number}} [query]
   * @returns {Promise<{files: object[], total: number, limit: number, offset: number}>}
   */
  async list(query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const qs = params.toString();
    return this.client._fetch(`/api/site/files${qs ? `?${qs}` : ""}`, { tags: ["files"] });
  }

  /** Every file (optionally in one folder), following pages. */
  async all(query = {}) {
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await this.list({ ...query, limit: PAGE, offset });
      const files = page?.files ?? [];
      out.push(...files);
      if (files.length < PAGE || out.length >= (page?.total ?? 0)) return out;
    }
  }

  /**
   * The file whose label or name matches, or null. Never throws for "not found".
   * @param {string} nameOrLabel  e.g. "hero"
   * @param {{folder?: string}} [opts]
   */
  async find(nameOrLabel, opts = {}) {
    if (!nameOrLabel) return null;
    // Labels are exact and indexed on the backend: try that first, cheaply.
    const byLabel = await this.list({ label: nameOrLabel, folder: opts.folder, limit: 1 });
    if (byLabel?.files?.[0]) return byLabel.files[0];
    return matchFile(await this.all({ folder: opts.folder }), nameOrLabel);
  }

  /** Alias of find(), for people who want the null in the name. */
  getFileOrReturnNull(nameOrLabel, opts) {
    return this.find(nameOrLabel, opts);
  }

  /** Just the CDN URL of find(nameOrLabel), or null. */
  async url(nameOrLabel, opts) {
    return (await this.find(nameOrLabel, opts))?.url ?? null;
  }

  /** A folder handle: sd.files.folder("Gallery").find("hero"). Name or full path. */
  folder(nameOrPath) {
    return new FileFolder(this, nameOrPath);
  }

  /** Alias of folder(). */
  getFolder(nameOrPath) {
    return this.folder(nameOrPath);
  }
}

export class FileFolder {
  constructor(files, nameOrPath) {
    this.files = files;
    this.name = nameOrPath;
  }

  /** One page of this folder's files. */
  list(query = {}) {
    return this.files.list({ ...query, folder: this.name });
  }

  /** Every file in this folder. */
  all() {
    return this.files.all({ folder: this.name });
  }

  /** The file in this folder whose label or name matches, or null. */
  find(nameOrLabel) {
    return this.files.find(nameOrLabel, { folder: this.name });
  }

  getFileOrReturnNull(nameOrLabel) {
    return this.find(nameOrLabel);
  }

  /** CDN URL of a file in this folder, or null. */
  url(nameOrLabel) {
    return this.files.url(nameOrLabel, { folder: this.name });
  }
}
