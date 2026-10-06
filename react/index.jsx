"use client";
/**
 * servicedash-sdk/react: provider, hooks and tracking components.
 *
 * Plain JSX with no build step. Add the package to `transpilePackages` in
 * next.config so Next compiles it:
 *
 *   // next.config.ts
 *   export default { transpilePackages: ["servicedash-sdk"] };
 *
 *   // app/providers.tsx
 *   "use client";
 *   import { ServiceDashProvider, PageView } from "servicedash-sdk/react";
 *   import { sd } from "@/lib/servicedash";
 *   export function Providers({ children }) {
 *     return <ServiceDashProvider client={sd}><PageView />{children}</ServiceDashProvider>;
 *   }
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  cloneElement,
  isValidElement,
  Children,
} from "react";
import { SiteClient } from "../index.js";

const ServiceDashContext = createContext(null);

const EMPTY_CART = Object.freeze({ id: null, lines: [], totals: null, warnings: [], updatedAt: null });

/**
 * Provides one SiteClient to the tree. Pass a `client` you built (preferred,
 * so server and client code share lib/servicedash), or `options` to build one.
 * On mount it captures attribution (utm, click ids, ?ref=) for this landing.
 *
 * @param {{client?: SiteClient, options?: object, captureAttribution?: boolean, children?: any}} props
 */
export function ServiceDashProvider({ client, options, captureAttribution = true, children }) {
  // `client={null}`, or no key configured, mounts a no-op provider: <PageView/>
  // and <TrackClick> do nothing, and the site still renders. useServiceDash()
  // throws in that state, because there is genuinely no client to hand out.
  const value = useMemo(() => {
    if (client !== undefined) return client;
    try {
      return new SiteClient(options || {});
    } catch (err) {
      if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
        console.warn(`[servicedash-sdk] No site client: ${err?.message || err}. Tracking is off.`);
      }
      return null;
    }
  }, [client, options]);
  useEffect(() => {
    if (!captureAttribution || !value) return;
    try {
      value.attribution.capture();
    } catch {
      /* never break render */
    }
  }, [value, captureAttribution]);
  return <ServiceDashContext.Provider value={value}>{children}</ServiceDashContext.Provider>;
}

/** The SiteClient from the nearest provider. */
export function useServiceDash() {
  const client = useContext(ServiceDashContext);
  if (!client) throw new Error("useServiceDash() needs a <ServiceDashProvider> with a configured site key.");
  return client;
}

/**
 * The cart, live. Persists to localStorage through the client's CartModule,
 * follows other tabs, and renders empty on the server (no hydration mismatch:
 * the stored cart appears right after hydration).
 *
 *   const { lines, count, subtotal, add, update, remove, sync, syncing } = useCart();
 *
 * @param {{autoSync?: boolean}} [options] autoSync: push to the platform after each change (debounced)
 */
export function useCart({ autoSync } = {}) {
  const client = useServiceDash();
  const cart = client.cart;
  useEffect(() => {
    if (autoSync !== undefined) cart.autoSync = autoSync;
  }, [cart, autoSync]);

  const subscribe = useCallback((fn) => cart.subscribe(fn), [cart]);
  const state = useSyncExternalStore(
    subscribe,
    () => cart.state,
    () => EMPTY_CART
  );

  // Pick up anything written by another client instance before mount.
  useEffect(() => {
    cart.hydrate();
  }, [cart]);

  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      return await cart.sync();
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setSyncing(false);
    }
  }, [cart]);

  return useMemo(() => {
    const lines = state.lines || [];
    const count = lines.reduce((n, l) => n + l.quantity, 0);
    const subtotal =
      state.totals?.subtotal !== undefined
        ? Number(state.totals.subtotal)
        : lines.reduce((s, l) => s + Math.round((Number(l.snapshot?.price) || 0) * 100) * l.quantity, 0) / 100;
    return {
      state,
      id: state.id,
      lines,
      count,
      subtotal,
      totals: state.totals,
      warnings: state.warnings || [],
      isEmpty: lines.length === 0,
      hasSubscription: lines.some((l) => l.purchase === "subscription"),
      add: (item) => cart.add(item),
      update: (key, qty) => cart.update(key, qty),
      setPlan: (key, planId, snapshot) => cart.setPlan(key, planId, snapshot),
      remove: (key) => cart.remove(key),
      clear: () => cart.clear(),
      setCode: (code) => cart.setCode(code),
      sync,
      syncing,
      error,
    };
  }, [state, cart, sync, syncing, error]);
}

/**
 * Records a click on its child, then lets the child's own onClick run.
 *
 *   <TrackClick event="cta_click" label="Get my price">
 *     <a href="/quote">Get my price</a>
 *   </TrackClick>
 *
 * With a single element child the handler is attached to it directly (no
 * wrapper element). Otherwise the children are wrapped in a <span>.
 *
 * @param {{event?: string, label?: string, href?: string, props?: object, children?: any}} p
 */
export function TrackClick({ event = "cta_click", label, href, props, children }) {
  const client = useContext(ServiceDashContext);

  const record = (childProps = {}) => {
    try {
      const childText = typeof childProps.children === "string" ? childProps.children : "";
      client?.insights.trackClick(event, {
        label: label ?? (childProps["aria-label"] || childText),
        href: href ?? childProps.href ?? "",
        ...(props || {}),
      });
    } catch {
      /* analytics never breaks a click */
    }
  };

  const only = Children.count(children) === 1 && isValidElement(children) ? children : null;
  if (only) {
    return cloneElement(only, {
      "data-sd-tracked": "",
      onClick: (e) => {
        record(only.props);
        if (typeof only.props.onClick === "function") only.props.onClick(e);
      },
    });
  }
  return (
    <span data-sd-tracked="" onClickCapture={() => record({})}>
      {children}
    </span>
  );
}

/**
 * Pageview tracker. Mount once (in the root layout's client providers).
 *
 * Without `path` it starts insights with automatic pageviews, which follow
 * App Router navigations through history.pushState. With `path` (e.g.
 * `usePathname()`), it records a pageview whenever that value changes and
 * leaves history alone.
 *
 * @param {{path?: string, options?: object}} props  options are passed to insights.init()
 */
export function PageView({ path, options }) {
  const client = useContext(ServiceDashContext);
  const controlled = path !== undefined;
  const started = useRef(false);

  useEffect(() => {
    if (!client || started.current) return;
    started.current = true;
    client.insights.init({ ...(options || {}), autoPageviews: !controlled });
  }, [client, controlled, options]);

  useEffect(() => {
    if (!client || !controlled) return;
    client.insights.notifyRouteChange(path);
  }, [client, controlled, path]);

  return null;
}

export { SiteClient };
