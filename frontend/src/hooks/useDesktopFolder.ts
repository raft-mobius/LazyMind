import { useCallback } from "react";
import { isDesktopMode, getDesktopAPI } from "@/utils/platform";

export function useDesktopFolder() {
  const pickFolder = useCallback(async (): Promise<string | null> => {
    if (!isDesktopMode()) return null;
    const api = getDesktopAPI();
    if (!api) return null;
    return api.pickFolder();
  }, []);

  return { pickFolder, isDesktop: isDesktopMode() };
}
