import type { LazyMindDesktopAPI } from "../../desktop/src/shared/types";

declare global {
  interface Window {
    lazymind?: LazyMindDesktopAPI;
    __DESKTOP_MODE__?: boolean;
  }
}

export function isDesktopMode(): boolean {
  return !!(window.__DESKTOP_MODE__ || window.lazymind);
}

export function getDesktopAPI(): LazyMindDesktopAPI | null {
  return window.lazymind || null;
}

export function getAPIBaseURL(): string {
  if (isDesktopMode()) {
    return "http://127.0.0.1:5023";
  }
  return "";
}
