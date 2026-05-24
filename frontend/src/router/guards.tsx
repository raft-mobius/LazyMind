import { Navigate } from "react-router-dom";
import { isDesktopMode } from "@/utils/platform";
import type { ReactNode } from "react";

export function DesktopOnlyRoute({ children }: { children: ReactNode }) {
  if (!isDesktopMode()) {
    return <Navigate to="/agent/chat" replace />;
  }
  return <>{children}</>;
}
