/**
 * useProject hook — fetches and polls project state.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { Project } from "@/types";

const POLL_INTERVAL_MS = 5000;
const ACTIVE_STATUSES = new Set(["pending", "processing"]);

export function useProject(projectId: string | undefined) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (isInitial = false) => {
    if (!projectId || projectId === "undefined") {
      return;
    }
    if (isInitial) {
      setLoading(true);
    }
    try {
      const data = await api.getProject(projectId);
      setProject(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      if (isInitial) {
        setLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId && projectId !== "undefined") {
      fetch(true);
    }
  }, [projectId, fetch]);

  // Poll when project is actively processing
  useEffect(() => {
    if (!project || !ACTIVE_STATUSES.has(project.status)) return;

    const timer = setInterval(() => fetch(false), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [project?.status, fetch]);

  return { project, loading, error, refresh: () => fetch(true), setProject };
}
