import { create } from "zustand";
import { isDesktopMode, getDesktopAPI } from "@/utils/platform";
import type {
  AssistantInfo,
  ServiceStatus,
} from "../../desktop/src/shared/types";

interface DesktopState {
  isDesktop: boolean;
  currentAssistant: AssistantInfo | null;
  assistantList: AssistantInfo[];
  serviceStatuses: Record<string, ServiceStatus>;
  initialized: boolean;
  initialize: () => Promise<void>;
  setCurrentAssistant: (id: string) => Promise<void>;
  refreshAssistantList: () => Promise<void>;
}

export const useDesktopStore = create<DesktopState>((set, get) => ({
  isDesktop: isDesktopMode(),
  currentAssistant: null,
  assistantList: [],
  serviceStatuses: {},
  initialized: false,

  async initialize() {
    if (!isDesktopMode()) return;
    const api = getDesktopAPI();
    if (!api) return;

    try {
      const [current, list] = await Promise.all([
        api.getCurrentAssistant(),
        api.getAssistantList(),
      ]);

      set({
        currentAssistant: current,
        assistantList: list,
        initialized: true,
        isDesktop: true,
      });

      // Write synthetic auth info for existing code compatibility
      if (current) {
        syncAuthState(current);
      }

      // Listen for service status changes
      api.onServiceStatusChanged((status) => {
        set((state) => ({
          serviceStatuses: { ...state.serviceStatuses, [status.name]: status },
        }));
      });
    } catch (err) {
      console.error("Failed to initialize desktop store:", err);
      set({ initialized: true, isDesktop: true });
    }
  },

  async setCurrentAssistant(id: string) {
    const api = getDesktopAPI();
    if (!api) return;

    await api.setCurrentAssistant(id);
    const current = await api.getCurrentAssistant();
    set({ currentAssistant: current });

    if (current) {
      syncAuthState(current);
    }
  },

  async refreshAssistantList() {
    const api = getDesktopAPI();
    if (!api) return;

    const list = await api.getAssistantList();
    set({ assistantList: list });
  },
}));

function syncAuthState(assistant: AssistantInfo): void {
  const STORAGE_KEY = "lazymind:user";
  const syntheticUser = {
    token: "desktop-token",
    username: assistant.username,
    userId: assistant.id,
    displayName: assistant.displayName,
    role: "user",
    timestamp: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(syntheticUser));
  window.dispatchEvent(new Event("lazymind:user-change"));
}
