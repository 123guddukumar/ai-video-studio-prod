/**
 * API client — all calls to the FastAPI backend.
 */

const API_BASE = typeof window === "undefined"
  ? "http://backend:8000"
  : (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000");

import type {
  Project,
  ProjectListItem,
  CreateProjectRequest,
  UpdateSceneRequest,
  DashboardStats,
  Scene,
} from "@/types";

// ─── Generic fetch ────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export const api = {
  // Dashboard
  async getStats(): Promise<DashboardStats> {
    return apiFetch("/api/projects/stats");
  },

  // Projects
  async getProjects(): Promise<ProjectListItem[]> {
    return apiFetch("/api/projects");
  },

  async getProject(id: string): Promise<Project> {
    return apiFetch(`/api/projects/${id}`);
  },

  async createProject(data: CreateProjectRequest): Promise<Project> {
    return apiFetch("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async deleteProject(id: string): Promise<void> {
    return apiFetch(`/api/projects/${id}`, { method: "DELETE" });
  },

  // Pipeline control
  async generateScript(id: string): Promise<{ message: string; job_id: string }> {
    return apiFetch(`/api/projects/${id}/generate-script`, { method: "POST" });
  },

  async approveScript(id: string): Promise<{ message: string; job_id: string }> {
    return apiFetch(`/api/projects/${id}/approve-script`, { method: "POST" });
  },

  async generateAssets(id: string): Promise<{ message: string; job_id: string }> {
    return apiFetch(`/api/projects/${id}/generate-assets`, { method: "POST" });
  },

  async generateVoice(id: string): Promise<{ message: string; job_id: string }> {
    return apiFetch(`/api/projects/${id}/generate-voice`, { method: "POST" });
  },

  async renderVideo(id: string): Promise<{ message: string; job_id: string }> {
    return apiFetch(`/api/projects/${id}/render`, { method: "POST" });
  },

  async cancelProject(id: string): Promise<{ message: string }> {
    return apiFetch(`/api/projects/${id}/cancel`, { method: "POST" });
  },

  async getProjectStatus(id: string): Promise<{
    project_id: string;
    status: string;
    progress: number;
    current_stage: string | null;
    error_message: string | null;
    final_video_url: string | null;
  }> {
    return apiFetch(`/api/projects/${id}/status`);
  },

  async getDownloadUrl(id: string): Promise<{ download_url: string }> {
    return apiFetch(`/api/projects/${id}/download`);
  },

  async uploadReferenceImage(id: string, file: File): Promise<{ status: string; filename: string }> {
    const formData = new FormData();
    formData.append("file", file);
    const url = `${API_BASE}/api/projects/${id}/reference-image`;
    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error ${response.status}: ${error}`);
    }
    return response.json();
  },

  // Scenes
  async updateScene(id: string, data: UpdateSceneRequest): Promise<Scene> {
    return apiFetch(`/api/scenes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  async regenerateSceneImage(id: string): Promise<{ message: string; task_id: string }> {
    return apiFetch(`/api/scenes/${id}/regenerate-image`, { method: "POST" });
  },

  async regenerateSceneVideo(id: string): Promise<{ message: string; task_id: string }> {
    return apiFetch(`/api/scenes/${id}/regenerate-video`, { method: "POST" });
  },

  async regenerateScenePrompts(id: string): Promise<Scene> {
    return apiFetch(`/api/scenes/${id}/regenerate-prompts`, { method: "POST" });
  },

  async retryProject(id: string): Promise<{ message: string; stage: string; job_id: string }> {
    return apiFetch(`/api/projects/${id}/retry`, { method: "POST" });
  },
};

// ─── WebSocket helper ─────────────────────────────────────────────────────────

export function createProjectWebSocket(projectId: string): WebSocket {
  const wsBase = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";
  const ws = new WebSocket(`${wsBase}/ws/projects/${projectId}`);

  // Keepalive ping every 30s
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send("ping");
    }
  }, 30_000);

  ws.addEventListener("close", () => clearInterval(pingInterval));

  return ws;
}
