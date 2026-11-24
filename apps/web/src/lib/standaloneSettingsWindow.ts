let lastStandaloneSettingsHref = "/settings/general";
let activeRouterRef: { readonly latestLocation: { readonly href: string } } | null = null;

export function bindStandaloneSettingsRouter(router: {
  readonly latestLocation: { readonly href: string };
}): void {
  activeRouterRef = router;
}

export function isRouterPreloadLocation(
  location: { readonly href: string },
  preload: boolean,
): boolean {
  if (preload) return true;
  // TanStack Router passes preload=false to already-matched ancestor routes (such as __root__)
  // during preloadRoute(); comparing against latestLocation distinguishes real navigations.
  return activeRouterRef !== null && activeRouterRef.latestLocation.href !== location.href;
}

export function getLastStandaloneSettingsHref(): string {
  return lastStandaloneSettingsHref;
}

export function setLastStandaloneSettingsHref(href: string): void {
  if (href.startsWith("/settings/")) {
    lastStandaloneSettingsHref = href;
  }
}

export function parseInternalRedirectTarget(rawHref: string): {
  readonly to: string;
  readonly search?: Record<string, unknown>;
  readonly hash?: string;
} {
  const url = new URL(rawHref, "http://t3code.local");
  const search: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) {
    search[key] = value;
  }
  const hash = url.hash.replace(/^#/, "");
  return {
    to: url.pathname || "/",
    ...(Object.keys(search).length > 0 ? { search } : {}),
    ...(hash.length > 0 ? { hash } : {}),
  };
}

export function isStandaloneSettingsWindow(): boolean {
  return typeof window !== "undefined" && window.desktopBridge?.getWindowRole?.() === "settings";
}

export function canOpenStandaloneSettingsWindow(): boolean {
  return (
    typeof window !== "undefined" &&
    !isStandaloneSettingsWindow() &&
    typeof window.desktopBridge?.openSettingsWindow === "function"
  );
}

export function openStandaloneSettingsWindow(href?: string): boolean {
  if (!canOpenStandaloneSettingsWindow()) return false;
  void window.desktopBridge?.openSettingsWindow?.(href);
  return true;
}

export function openInMainDesktopWindow(href: string): boolean {
  if (
    !isStandaloneSettingsWindow() ||
    typeof window.desktopBridge?.openInMainWindow !== "function"
  ) {
    return false;
  }
  void window.desktopBridge.openInMainWindow(href);
  return true;
}
