import { isDesktopMode } from "@/utils/platform";

const API_BASE = isDesktopMode() ? "" : "";

interface ScanPath {
  id: string;
  path: string;
  status: string;
  file_count: number;
  last_scan_at: string | null;
}

interface ParseTask {
  id: string;
  file_name: string;
  status: string;
  chunk_count: number;
  error_message: string;
}

interface ModelConfig {
  id: string;
  provider: string;
  model_name: string;
  status: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    throw new Error(`API error: ${resp.status}`);
  }
  return resp.json();
}

export const desktopAPI = {
  // Scan paths
  async listScanPaths(userId: string): Promise<ScanPath[]> {
    return request(`/api/scan/paths?user_id=${userId}`);
  },
  async addScanPath(userId: string, path: string): Promise<ScanPath> {
    return request("/api/scan/paths", { method: "POST", body: JSON.stringify({ user_id: userId, path }) });
  },
  async removeScanPath(id: string): Promise<void> {
    await fetch(`/api/scan/paths/${id}`, { method: "DELETE" });
  },
  async triggerScan(pathId: string): Promise<void> {
    await request(`/api/scan/paths/${pathId}/scan`, { method: "POST" });
  },

  // Parse/Index
  async getParseStatus(taskId: string): Promise<ParseTask> {
    return request(`/api/chat/parse/status/${taskId}`);
  },
  async listParseTasks(userId: string): Promise<ParseTask[]> {
    return request(`/api/chat/parse/tasks/${userId}`);
  },

  // Model configs
  async listModelConfigs(): Promise<ModelConfig[]> {
    return request("/api/core/model-providers");
  },
  async testModelConfig(configId: string): Promise<{ success: boolean; error?: string }> {
    return request(`/api/core/model-providers/${configId}/test`, { method: "POST" });
  },
};
