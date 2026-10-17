/**
 * Thin client for the site CDN endpoints (/api/site/cdn/*). X-Site-Key auth , 
 * the same header the runtime SDK uses.
 */

export function createApi(cfg) {
  async function request(method, apiPath, body) {
    const res = await fetch(`${cfg.apiUrl}/api/site${apiPath}`, {
      method,
      headers: {
        "X-Site-Key": cfg.apiKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
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
