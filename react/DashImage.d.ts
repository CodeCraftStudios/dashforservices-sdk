import * as React from "react";

/** A pre-generated responsive WebP variant. */
export interface DashImageVariant {
  url: string;
  width: number;
}

/**
 * Any platform file object (sd.files, page images, catalog products):
 * the WebP srcset and LQIP blur-up kick in when variants are present.
 */
export interface DashImageData {
  url: string;
  lqip?: string | null;
  variants_ready?: boolean;
  variants?: { webp?: DashImageVariant[] } | null;
  [key: string]: unknown;
}

export interface DashImageProps {
  image?: DashImageData | null;
  alt?: string;
  sizes?: string;
  className?: string;
  style?: React.CSSProperties;
  priority?: boolean;
  noBlur?: boolean;
  fill?: boolean;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
  onError?: React.ReactEventHandler<HTMLImageElement>;
  /** Drop-in <img> compatibility. */
  src?: string;
  width?: number | string;
  height?: number | string;
  loading?: "eager" | "lazy";
}

export declare function DashImage(props: DashImageProps): React.JSX.Element | null;
export default DashImage;
