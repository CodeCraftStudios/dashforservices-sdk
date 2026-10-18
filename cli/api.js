/**
 * Thin client for the site CDN endpoints (/api/site/cdn/*). X-Site-Key auth , 
 * the same header the runtime SDK uses.
 */

/** Site keys allow 30 requests a minute; a deploy with many new files confirms more than that. */
const MAX_RATE_LIMIT_WAITS = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createApi(cfg) {
  async function request(method, apiPath, body) {
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${cfg.apiUrl}/api/site${apiPath}`, {
        method,
        headers: {
          "X-Site-Key": cfg.apiKey,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status !== 429 || attempt >= MAX_RATE_LIMIT_WAITS) break;
      // Rate limited: wait out the window (Retry-After when sent, else a few seconds) and try again.
      const after = Number(res.headers.get("retry-after"));
      await sleep((after > 0 ? after * 1000 : 5000) + Math.random() * 1000);
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const message = payload?.message || payload?.error || `HTTP ${res.status}`;
      throw new Error(`${apiPath}: ${message}`);
    }
    return payload;
  }

  return {
    status: () => request("GET", "/cdn/status"),
    manifest: (body) => request("POST", "/cdn/manifest", body),
    confirmUpload: (sha256) => request("POST", "/cdn/uploaded", { sha256 }),
    activate: (deployId) => request("POST", "/cdn/activate", { deploy_id: deployId }),
  };
}
