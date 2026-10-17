"use client";

/**
 * <DashImage />, responsive image with LQIP blur-up + progressive loading.
 *
 * Renders a raw <img> with srcset across pre-generated WebP widths served
 * directly from the CDN (the platform file pipeline generates them on upload).
 * LQIP base64 blur shows as CSS background while loading, clears once real
 * pixels paint. Shimmer fallback when no LQIP.
 *
 * Import from the subpath, it keeps the client component out of the server
 * entry so bundlers never trip on it:
 *
 *   import { DashImage } from "dashforservices-sdk/react/DashImage";
 *   <DashImage image={file} alt="Storefront" sizes="(min-width:1024px) 50vw, 100vw" />
 *
 * `image` is any platform file object (sd.files, page images or catalog products) , 
 * { url, lqip?, variants_ready?, variants? }. A bare `src` also works as a
 * drop-in <img> replacement.
 *
 * Uses React.createElement instead of JSX to avoid Turbopack parse errors
 * when bundled as a dependency in older Next.js versions.
 */

import React, { useState, useRef, useEffect } from "react";

import GENERATED_MANIFEST from "./manifest.generated.js";

/**
 * Where `dashforservices build` writes the cuts. Must match OUT_DIR in cli/images.js.
 */
const GEN = "/_gen/img";

/**
 * A committed public/ file gets no CDN prefix on its own: Next's assetPrefix
 * only rewrites what it emits under _next/static, so a plain "/images/x.webp"
 * comes off the origin while every script on the page comes off the edge.
 * `dashforservices build` uploads public/ too, so the file is already on the CDN and
 * only has to be asked for by its full URL.
 */
const PREFIX = process.env.NEXT_PUBLIC_ASSET_PREFIX || "";

/** "/images/a/b.webp" at 640 → "/_gen/img/images/a/b-webp-640.webp". */
function cutUrl(src, width) {
  return GEN + src.replace(/\.([^./]+)$/, "-$1") + "-" + width + ".webp";
}

function withPrefix(url) {
  return PREFIX && url.charAt(0) === "/" ? PREFIX + url : url;
}

/**
 * Upgrade a bare committed `src` into full image data using the manifest the
 * build generated.
 *
 * This is what makes every existing `<DashImage src="/images/hero.webp" />`
 * on every site emit a responsive srcset with no call-site change. A path with
 * no entry, an SVG, a logo, anything under the generator's width floor , 
 * returns null and the caller renders the original, exactly as before.
 */
function fromManifest(src) {
  if (!src || src.charAt(0) !== "/") return null;
  var entry = GENERATED_MANIFEST[src];
  if (!entry || !entry.widths || !entry.widths.length) return null;
  return {
    url: withPrefix(src),
    lqip: entry.lqip || null,
    variants_ready: true,
    variants: {
      webp: entry.widths.map(function (w) {
        return { width: w, url: withPrefix(cutUrl(src, w)) };
      }),
    },
    width: entry.w,
    height: entry.h,
  };
}

const SHIMMER_SVG = "data:image/svg+xml;base64," + (typeof window === "undefined"
  ? Buffer.from('<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#222"><animate attributeName="offset" values="-2;1" dur="1.4s" repeatCount="indefinite"/></stop><stop offset="50%" stop-color="#2a2a2a"><animate attributeName="offset" values="-1;2" dur="1.4s" repeatCount="indefinite"/></stop><stop offset="100%" stop-color="#222"><animate attributeName="offset" values="0;3" dur="1.4s" repeatCount="indefinite"/></stop></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/></svg>').toString("base64")
  : btoa('<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#222"><animate attributeName="offset" values="-2;1" dur="1.4s" repeatCount="indefinite"/></stop><stop offset="50%" stop-color="#2a2a2a"><animate attributeName="offset" values="-1;2" dur="1.4s" repeatCount="indefinite"/></stop><stop offset="100%" stop-color="#222"><animate attributeName="offset" values="0;3" dur="1.4s" repeatCount="indefinite"/></stop></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/></svg>'));

function buildSrcSet(variantList) {
  if (!Array.isArray(variantList) || variantList.length === 0) return undefined;
  return variantList
    .filter(function(v) { return v && v.url && v.width; })
    .sort(function(a, b) { return a.width - b.width; })
    .map(function(v) { return v.url + " " + v.width + "w"; })
    .join(", ");
}

export function DashImage(props) {
  var image = props.image;
  var alt = props.alt || "";
  var sizes = props.sizes || "100vw";
  var className = props.className || "";
  var style = props.style || {};
  var priority = props.priority || false;
  var noBlur = props.noBlur || false;
  var fill = props.fill || false;
  var onLoad = props.onLoad;
  var onError = props.onError;
  // Drop-in <img>/<Image> compatibility props.
  var src = props.src;
  var width = props.width;
  var height = props.height;
  var loadingProp = props.loading;

  var _loaded = useState(false);
  var loaded = _loaded[0];
  var setLoaded = _loaded[1];

  var _variantError = useState(false);
  var variantError = _variantError[0];
  var setVariantError = _variantError[1];

  var imgRef = useRef(null);

  useEffect(function() {
    if (imgRef.current && imgRef.current.complete) setLoaded(true);
  }, []);

  // Accept a bare `src` URL as a drop-in replacement for <img>/<Image>.
  if ((!image || !image.url) && src) image = { url: src };
  if (!image || !image.url) return null;

  /*
   * UPGRADE ANYTHING THAT STILL HAS NO VARIANTS.
   *
   * The rule is "if we do not already have a ladder, and this URL is a
   * committed file the build cut, use the cuts", deliberately NOT "only when
   * a bare src was passed". Every site wraps this in an adapter
   * (components/smart-image.tsx) that builds an `image` object out of whatever
   * it has and ALWAYS passes `image=`, so a src-only rule would upgrade the
   * handful of direct call sites and miss the component rendering most of the
   * page.
   *
   * A platform file that already carries variants is left alone: those are the
   * client-swappable ones, generated on upload, and they are already right.
   */
  if (!image.variants_ready) {
    var generated = fromManifest(image.url);
    if (generated) {
      image = Object.assign({}, image, generated, {
        // The caller's own LQIP wins. A catalog file can carry one without
        // carrying variants, and blanking it would trade a real blur-up for
        // the dark #222 shimmer on a page that was already doing it right.
        lqip: image.lqip || generated.lqip,
      });
    }
  }

  var variants = !variantError && image.variants_ready ? image.variants : null;
  var webpSet = variants ? buildSrcSet(variants.webp) : undefined;

  var sorted = (variants && variants.webp || [])
    .filter(function(v) { return v && v.url && v.width; })
    .sort(function(a, b) { return a.width - b.width; });
  var primarySrc = sorted.length
    ? (sorted.find(function(v) { return v.width >= 1024; }) || sorted[sorted.length - 1]).url
    : image.url;

  var handleError = function(e) {
    if (!variantError) setVariantError(true);
    setLoaded(true);
    if (onError) onError(e);
  };

  var handleLoad = function(e) {
    setLoaded(true);
    if (onLoad) onLoad(e);
  };

  var blur = !loaded && !noBlur
    ? (image.lqip || (sorted.length ? SHIMMER_SVG : null))
    : null;

  var mergedStyle = Object.assign(
    {},
    blur ? { backgroundImage: 'url("' + blur + '")', backgroundSize: "cover", backgroundPosition: "center" } : {},
    fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : {},
    style
  );

  return React.createElement("img", {
    ref: imgRef,
    src: primarySrc,
    srcSet: webpSet,
    sizes: sizes,
    alt: alt,
    width: fill ? undefined : width,
    height: fill ? undefined : height,
    loading: loadingProp || (priority ? "eager" : "lazy"),
    decoding: "async",
    fetchPriority: priority ? "high" : undefined,
    onLoad: handleLoad,
    onError: handleError,
    className: className,
    style: mergedStyle,
  });
}

export default DashImage;
