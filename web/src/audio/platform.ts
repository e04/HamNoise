const APPLE_MOBILE_DEVICE_RE = /\b(iPad|iPhone|iPod)\b/i;

/**
 * Detects iPhone/iPad/iPod, including iPadOS that reports as desktop Safari
 * ("MacIntel" with a touch screen). Ported from web-deep-cw-decoder-pro.
 */
export function isAppleMobilePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  if (APPLE_MOBILE_DEVICE_RE.test(navigator.userAgent)) {
    return true;
  }

  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}
