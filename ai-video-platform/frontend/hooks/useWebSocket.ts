/**
 * useWebSocket hook — manages a WebSocket connection for a specific project.
 */
"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createProjectWebSocket } from "@/lib/api";
import type { WSMessage } from "@/types";

interface UseWebSocketOptions {
  onMessage: (message: WSMessage) => void;
  enabled?: boolean;
}

export function useWebSocket(
  projectId: string,
  { onMessage, enabled = true }: UseWebSocketOptions
) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(() => {
    if (!enabled || !projectId) return;

    try {
      const ws = createProjectWebSocket(projectId);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        if (event.data === "pong") return;
        try {
          const message = JSON.parse(event.data) as WSMessage;
          onMessage(message);
        } catch {
          console.warn("Invalid WebSocket message:", event.data);
        }
      };

      ws.onerror = () => {
        setError("WebSocket connection error");
        setConnected(false);
      };

      ws.onclose = () => {
        setConnected(false);
        // Reconnect after 3s if not intentionally closed
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.CLOSED) {
            connect();
          }
        }, 3000);
      };
    } catch (err) {
      setError("Failed to create WebSocket connection");
    }
  }, [projectId, enabled, onMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on unmount
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connected, error };
}
