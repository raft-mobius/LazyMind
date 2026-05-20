import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.scss";
import "./i18n";
import { isDesktopMode } from "@/utils/platform";
import { useDesktopStore } from "@/stores/desktop";

async function bootstrap() {
  if (isDesktopMode()) {
    await useDesktopStore.getState().initialize();
  }

  const container = document.getElementById("app");
  if (!container) throw new Error("Root element #app not found");
  const root = createRoot(container);
  root.render(<App />);
}

bootstrap();
