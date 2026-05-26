"use client";

import * as React from "react";

const MOBILE_BREAKPOINT = 768;

const mql =
  typeof window !== "undefined"
    ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    : null;

function getSnapshot() {
  return mql?.matches ?? false;
}

function getServerSnapshot() {
  return false;
}

function subscribe(callback: () => void) {
  mql?.addEventListener("change", callback);
  return () => mql?.removeEventListener("change", callback);
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
