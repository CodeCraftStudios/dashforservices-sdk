import type { ReactNode, ReactElement } from "react";
import type { SiteClient, SiteClientOptions, CartState, CartLine, CartAddInput, CartTotals, InsightsInitOptions } from "../index";

export { SiteClient };

export interface DashForServicesProviderProps {
  /** A client you built (preferred). */
  client?: SiteClient | null;
  /** Or options to build one. */
  options?: SiteClientOptions;
  /** Capture utm / click ids / ?ref= on mount. Default true. */
  captureAttribution?: boolean;
  children?: ReactNode;
}
export declare function DashForServicesProvider(props: DashForServicesProviderProps): ReactElement;

/** The SiteClient from the nearest provider. Throws outside one. */
export declare function useDashForServices(): SiteClient;

export interface UseCartResult {
  state: CartState;
  id: string | null;
  lines: CartLine[];
  count: number;
  subtotal: number;
  totals: CartTotals | null;
  warnings: Array<{ key?: string; code: string; message: string }>;
  isEmpty: boolean;
  hasSubscription: boolean;
  add(item: CartAddInput): CartLine;
  update(key: string, quantity: number): CartLine | null;
  setPlan(key: string, planId: string | null, snapshot?: CartLine["snapshot"]): CartLine | null;
  remove(key: string): null;
  clear(): void;
  setCode(code: string | null): void;
  sync(): Promise<CartState>;
  syncing: boolean;
  error: Error | null;
}
export declare function useCart(options?: { autoSync?: boolean }): UseCartResult;

export interface TrackClickProps {
  /** Event name. Default "cta_click". */
  event?: string;
  /** Defaults to the child's aria-label or text. */
  label?: string;
  /** Defaults to the child's href. */
  href?: string;
  /** Extra props recorded with the event. */
  props?: Record<string, unknown>;
  children?: ReactNode;
}
export declare function TrackClick(props: TrackClickProps): ReactElement;

export interface PageViewProps {
  /** Controlled mode: a pageview whenever this changes (e.g. usePathname()). */
  path?: string;
  /** Passed to insights.init(). */
  options?: InsightsInitOptions;
}
export declare function PageView(props: PageViewProps): null;
