"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useProject } from "@/hooks/useProject";
import { useWebSocket } from "@/hooks/useWebSocket";
import { api } from "@/lib/api";
import type { Project, Scene, WSMessage } from "@/types";
import {
  ChevronLeft, Play, Download, RefreshCw, Edit3,
  CheckCircle2, XCircle, Loader2, Clock, AlertTriangle,
  Image as ImageIcon, Video, Mic, Subtitles, Film,
  ThumbsUp, Sparkles
} from "lucide-react";
import Link from "next/link";

// ─── Sub-components ────────────────────────────────────────────────────────────

function PipelineStatus({ project }: { project: Project }) {
  const STAGES = [
    { id: "SCRIPT_GENERATION", label: "🎬 Creative Director", icon: "✍️" },
    { id: "FLOW_IMAGE_GENERATION", label: "🌐 Google Flow · Assets", icon: "🖼️" },
    { id: "ELEVENLABS_GENERATION", label: "🎙️ Voice Director", icon: "🎙️" },
    { id: "VIDEO_COMPOSITION", label: "🎞️ Editor Director", icon: "🎞️" },
    { id: "COMPLETED", label: "🎬 Final Director", icon: "✅" },
  ];

  const currentIdx = STAGES.findIndex(s => s.id === project.current_stage || (project.status === "completed" && s.id === "COMPLETED"));

  return (
    <div
      className="glass-card"
      style={{ padding: "20px 24px", marginBottom: 24 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold" style={{ fontSize: 14 }}>Pipeline Progress</h3>
        <span className={`badge badge-${project.status}`}>{project.status.replace(/_/g, " ")}</span>
      </div>

      {/* Progress bar */}
      <div className="progress-bar mb-3" style={{ height: 8 }}>
        <div className="progress-bar-fill" style={{ width: `${project.progress}%` }} />
      </div>
      <div className="flex justify-between mb-4">
        <span style={{ fontSize: 12, color: "#6b7280" }}>{project.current_stage?.replace(/_/g, " ")}</span>
        <span style={{ fontSize: 12, color: "#3b82f6", fontWeight: 600 }}>{Math.round(project.progress)}%</span>
      </div>

      {/* Stage timeline */}
      <div className="flex flex-col gap-2">
        {STAGES.map((stage, i) => {
          const isDone = i < currentIdx || project.status === "completed";
          const isCurrent = stage.id === project.current_stage;
          const isError = project.status === "failed" && isCurrent;

          return (
            <div key={stage.id} className="flex items-center gap-3" style={{ padding: "6px 0" }}>
              <div
                className="flex items-center justify-center rounded-full"
                style={{
                  width: 24, height: 24, flexShrink: 0,
                  background: isDone ? "rgba(16,185,129,0.2)" : isCurrent ? "rgba(59,130,246,0.2)" : "rgba(30,45,69,0.5)",
                  border: isDone ? "1px solid #10b981" : isCurrent ? "1px solid #3b82f6" : "1px solid #1e2d45",
                }}
              >
                {isDone ? <CheckCircle2 size={12} style={{ color: "#10b981" }} /> :
                 isError ? <XCircle size={12} style={{ color: "#ef4444" }} /> :
                 isCurrent ? <Loader2 size={12} style={{ color: "#3b82f6" }} className="animate-spin" /> :
                 <Clock size={12} style={{ color: "#374151" }} />}
              </div>
              <span style={{
                fontSize: 13,
                color: isDone ? "#9ca3af" : isCurrent ? "#f9fafb" : "#4b5563",
                fontWeight: isCurrent ? 600 : 400,
              }}>
                {stage.label}
              </span>
              {isDone && <span style={{ fontSize: 11, color: "#10b981", marginLeft: "auto" }}>✓ Done</span>}
              {isCurrent && !isError && (
                <span style={{ fontSize: 11, color: "#3b82f6", marginLeft: "auto" }}>In progress...</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Scene-level progress for Flow stage */}
      {project.current_stage === "FLOW_IMAGE_GENERATION" && project.scenes.length > 0 && (
        <div className="mt-4" style={{ borderTop: "1px solid #1e2d45", paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>Scene Generation</div>
          <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(30px, 1fr))" }}>
            {project.scenes.map((scene) => (
              <div
                key={scene.id}
                title={`Scene ${scene.scene_number}: ${scene.status}`}
                className="rounded flex items-center justify-center"
                style={{
                  height: 28, fontSize: 10,
                  background: scene.status === "completed" ? "rgba(16,185,129,0.2)" :
                               scene.status === "processing" ? "rgba(59,130,246,0.2)" :
                               scene.status === "failed" ? "rgba(239,68,68,0.2)" : "rgba(30,45,69,0.5)",
                  border: `1px solid ${scene.status === "completed" ? "#10b98140" :
                            scene.status === "processing" ? "#3b82f640" :
                            scene.status === "failed" ? "#ef444440" : "#1e2d45"}`,
                  color: scene.status === "completed" ? "#10b981" :
                         scene.status === "processing" ? "#60a5fa" :
                         scene.status === "failed" ? "#f87171" : "#4b5563",
                }}
              >
                {scene.scene_number}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScriptTab({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [editData, setEditData] = useState({ narration: "", image_prompt: "", video_prompt: "" });
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  const startEdit = (scene: Scene) => {
    setEditingScene(scene.id);
    setEditData({
      narration: scene.narration,
      image_prompt: scene.image_prompt,
      video_prompt: scene.video_prompt,
    });
  };

  const saveEdit = async (sceneId: string) => {
    setSaving(true);
    try {
      await api.updateScene(sceneId, editData);
      setEditingScene(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      await api.approveScript(project.id);
      onRefresh();
    } finally {
      setApproving(false);
    }
  };

  if (!project.script_data) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ padding: 64 }}>
        <Loader2 size={32} className="animate-spin" style={{ color: "#3b82f6", marginBottom: 16 }} />
        <p style={{ color: "#6b7280" }}>Script is being generated...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Script header */}
      <div className="glass-card mb-6" style={{ padding: "20px 24px" }}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-bold mb-1" style={{ fontSize: 18 }}>{project.script_data.title}</h2>
            <p style={{ color: "#6b7280", fontSize: 13 }}>{project.script_data.description}</p>
          </div>
          {project.status === "awaiting_approval" && (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="btn-glow flex items-center gap-2"
              style={{ fontSize: 13 }}
            >
              {approving ? <Loader2 size={14} className="animate-spin" /> : <ThumbsUp size={14} />}
              Approve & Continue
            </button>
          )}
        </div>

        {project.visual_style_data && (
          <div className="grid gap-2 mt-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
            {Object.entries(project.visual_style_data).map(([key, val]) => (
              val && (
                <div key={key} style={{ fontSize: 11, color: "#4b5563" }}>
                  <span style={{ color: "#6b7280" }}>{key.replace(/_/g, " ")}: </span>
                  <span style={{ color: "#9ca3af" }}>{String(val)}</span>
                </div>
              )
            ))}
          </div>
        )}
      </div>

      {/* Scenes */}
      <div className="flex flex-col gap-4">
        {project.scenes.map((scene) => (
          <div key={scene.id} className="glass-card" style={{ padding: "20px 24px" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div
                  className="font-bold flex items-center justify-center rounded-lg"
                  style={{
                    width: 36, height: 36,
                    background: "rgba(59,130,246,0.1)",
                    border: "1px solid rgba(59,130,246,0.2)",
                    fontSize: 12, color: "#60a5fa",
                  }}
                >
                  {String(scene.scene_number).padStart(2, "0")}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Scene {scene.scene_number}</div>
                  <div style={{ fontSize: 11, color: "#4b5563" }}>{scene.start_time} → {scene.end_time} ({scene.duration}s)</div>
                </div>
              </div>
              {editingScene !== scene.id && (
                <button
                  onClick={() => startEdit(scene)}
                  style={{
                    background: "rgba(30,45,69,0.5)", border: "1px solid #1e2d45",
                    borderRadius: 6, padding: "5px 10px", cursor: "pointer",
                    color: "#6b7280", fontSize: 11, display: "flex", gap: 5, alignItems: "center",
                  }}
                >
                  <Edit3 size={11} /> Edit
                </button>
              )}
            </div>

            {editingScene === scene.id ? (
              <div className="flex flex-col gap-3">
                <div>
                  <label style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, display: "block" }}>Narration</label>
                  <textarea
                    className="textarea-dark"
                    rows={3}
                    value={editData.narration}
                    onChange={(e) => setEditData(p => ({ ...p, narration: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, display: "block" }}>Image Prompt</label>
                  <textarea
                    className="textarea-dark"
                    rows={2}
                    value={editData.image_prompt}
                    onChange={(e) => setEditData(p => ({ ...p, image_prompt: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, display: "block" }}>Video Prompt</label>
                  <textarea
                    className="textarea-dark"
                    rows={2}
                    value={editData.video_prompt}
                    onChange={(e) => setEditData(p => ({ ...p, video_prompt: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => saveEdit(scene.id)}
                    disabled={saving}
                    className="btn-glow"
                    style={{ fontSize: 12, padding: "6px 16px" }}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => setEditingScene(null)}
                    style={{ background: "rgba(30,45,69,0.5)", border: "1px solid #1e2d45", borderRadius: 8, padding: "6px 14px", cursor: "pointer", color: "#6b7280", fontSize: 12 }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 4 }}>NARRATION</div>
                  <p style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.6 }}>{scene.narration}</p>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 4 }}>IMAGE PROMPT</div>
                  <p style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }}>{scene.image_prompt}</p>
                  <div style={{ fontSize: 11, color: "#4b5563", marginTop: 8, marginBottom: 4 }}>VIDEO PROMPT</div>
                  <p style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }}>{scene.video_prompt}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AssetsTab({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});

  const regen = async (sceneId: string, type: "image" | "video") => {
    setRegenerating(p => ({ ...p, [`${sceneId}-${type}`]: true }));
    try {
      if (type === "image") await api.regenerateSceneImage(sceneId);
      else await api.regenerateSceneVideo(sceneId);
      setTimeout(onRefresh, 2000);
    } finally {
      setTimeout(() => setRegenerating(p => ({ ...p, [`${sceneId}-${type}`]: false })), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {project.scenes.map((scene) => {
        const imageAsset = scene.assets.find(a => a.asset_type === "image");
        const videoAsset = scene.assets.find(a => a.asset_type === "video");

        return (
          <div key={scene.id} className="glass-card" style={{ padding: "20px 24px" }}>
            <div className="flex items-center gap-3 mb-4">
              <div
                className="font-bold flex items-center justify-center rounded-lg"
                style={{ width: 32, height: 32, background: "rgba(59,130,246,0.1)", fontSize: 11, color: "#60a5fa" }}
              >
                {String(scene.scene_number).padStart(2, "0")}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Scene {scene.scene_number}</div>
              <span className={`badge badge-${scene.status}`} style={{ marginLeft: "auto" }}>
                {scene.status.replace(/_/g, " ")}
              </span>
            </div>

            <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {/* Image */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: 11, color: "#4b5563" }}><ImageIcon size={11} className="inline mr-1" />IMAGE</span>
                  <span className={`badge badge-${scene.image_status}`} style={{ fontSize: 9 }}>{scene.image_status}</span>
                </div>
                <div
                  className="rounded-lg mb-2 flex items-center justify-center"
                  style={{ height: 120, background: "#0d1421", border: "1px solid #1e2d45" }}
                >
                  {imageAsset?.public_url ? (
                    <img src={imageAsset.public_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />
                  ) : scene.image_status === "processing" ? (
                    <Loader2 size={20} className="animate-spin" style={{ color: "#3b82f6" }} />
                  ) : (
                    <ImageIcon size={24} style={{ color: "#1e2d45" }} />
                  )}
                </div>
                <div className="flex gap-2">
                  {imageAsset?.public_url && (
                    <a href={imageAsset.public_url} download className="flex-1 flex items-center justify-center gap-1"
                      style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "#34d399", textDecoration: "none" }}>
                      <Download size={10} /> Download
                    </a>
                  )}
                  <button
                    onClick={() => regen(scene.id, "image")}
                    disabled={regenerating[`${scene.id}-image`]}
                    style={{ flex: 1, background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "#60a5fa", cursor: "pointer", display: "flex", gap: 4, alignItems: "center", justifyContent: "center" }}
                  >
                    <RefreshCw size={10} /> Regenerate
                  </button>
                </div>
              </div>

              {/* Video */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: 11, color: "#4b5563" }}><Video size={11} className="inline mr-1" />VIDEO</span>
                  <span className={`badge badge-${scene.video_status}`} style={{ fontSize: 9 }}>{scene.video_status}</span>
                </div>
                <div
                  className="rounded-lg mb-2 flex items-center justify-center"
                  style={{ height: 120, background: "#0d1421", border: "1px solid #1e2d45" }}
                >
                  {videoAsset?.public_url ? (
                    <video src={videoAsset.public_url} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} controls={false} muted autoPlay loop />
                  ) : scene.video_status === "processing" ? (
                    <Loader2 size={20} className="animate-spin" style={{ color: "#8b5cf6" }} />
                  ) : (
                    <Video size={24} style={{ color: "#1e2d45" }} />
                  )}
                </div>
                <div className="flex gap-2">
                  {videoAsset?.public_url && (
                    <a href={videoAsset.public_url} download className="flex-1 flex items-center justify-center gap-1"
                      style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "#34d399", textDecoration: "none" }}>
                      <Download size={10} /> Download
                    </a>
                  )}
                  <button
                    onClick={() => regen(scene.id, "video")}
                    disabled={regenerating[`${scene.id}-video`]}
                    style={{ flex: 1, background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "#a78bfa", cursor: "pointer", display: "flex", gap: 4, alignItems: "center", justifyContent: "center" }}
                  >
                    <RefreshCw size={10} /> Regenerate
                  </button>
                </div>
              </div>
            </div>

            {scene.error_message && (
              <div style={{ marginTop: 12, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, padding: "8px 12px", fontSize: 11, color: "#f87171" }}>
                <AlertTriangle size={10} className="inline mr-1" />
                {scene.error_message}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VoiceTab({ project }: { project: Project }) {
  if (!project.narration_url) {
    return (
      <div className="flex flex-col items-center justify-center glass-card" style={{ padding: 64 }}>
        {project.current_stage === "ELEVENLABS_GENERATION" ? (
          <>
            <Loader2 size={32} className="animate-spin" style={{ color: "#3b82f6", marginBottom: 16 }} />
            <p style={{ color: "#6b7280" }}>Generating voice narration...</p>
          </>
        ) : (
          <>
            <Mic size={32} style={{ color: "#1e2d45", marginBottom: 16 }} />
            <p style={{ color: "#6b7280" }}>Voice not yet generated</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="glass-card" style={{ padding: "24px" }}>
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center rounded-xl" style={{ width: 44, height: 44, background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)" }}>
          <Mic size={20} style={{ color: "#a78bfa" }} />
        </div>
        <div>
          <h3 className="font-semibold">Narration Audio</h3>
          {project.narration_duration && (
            <div style={{ fontSize: 12, color: "#6b7280" }}>{project.narration_duration.toFixed(1)}s duration</div>
          )}
        </div>
      </div>

      <audio controls src={project.narration_url} style={{ width: "100%", borderRadius: 8 }} />

      <div className="flex gap-3 mt-4">
        <a
          href={project.narration_url}
          download="narration.mp3"
          className="btn-glow flex items-center gap-2"
          style={{ fontSize: 13, textDecoration: "none", padding: "8px 20px" }}
        >
          <Download size={14} />
          Download Audio
        </a>
      </div>

      {project.narration_duration && project.duration && Math.abs(project.narration_duration - project.duration) > 5 && (
        <div style={{ marginTop: 12, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#fbbf24" }}>
          <AlertTriangle size={12} className="inline mr-2" />
          Audio duration ({project.narration_duration.toFixed(1)}s) differs from target ({project.duration}s). Video composition will adjust timing.
        </div>
      )}
    </div>
  );
}

function FinalVideoTab({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const [rendering, setRendering] = useState(false);

  const handleRender = async () => {
    setRendering(true);
    try {
      await api.renderVideo(project.id);
      setTimeout(onRefresh, 2000);
    } finally {
      setRendering(false);
    }
  };

  if (!project.final_video_url) {
    return (
      <div className="flex flex-col items-center justify-center glass-card" style={{ padding: 64 }}>
        {project.current_stage === "VIDEO_COMPOSITION" ? (
          <>
            <Loader2 size={32} className="animate-spin" style={{ color: "#3b82f6", marginBottom: 16 }} />
            <p style={{ color: "#6b7280" }}>Composing final video...</p>
          </>
        ) : project.narration_url ? (
          <>
            <Film size={32} style={{ color: "#1e2d45", marginBottom: 16 }} />
            <p style={{ color: "#6b7280", marginBottom: 24 }}>Ready to compose final video</p>
            <button
              onClick={handleRender}
              disabled={rendering}
              className="btn-glow flex items-center gap-2"
            >
              {rendering ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
              Compose Final Video
            </button>
          </>
        ) : (
          <>
            <Film size={32} style={{ color: "#1e2d45", marginBottom: 16 }} />
            <p style={{ color: "#6b7280" }}>Final video not yet generated</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Completion banner */}
      {project.status === "completed" && (
        <div
          className="glass-card mb-6 flex items-center gap-4"
          style={{
            padding: "20px 24px",
            background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.05))",
            borderColor: "rgba(16,185,129,0.2)",
          }}
        >
          <div className="flex items-center justify-center rounded-xl" style={{ width: 44, height: 44, background: "rgba(16,185,129,0.15)" }}>
            <Sparkles size={20} style={{ color: "#34d399" }} />
          </div>
          <div>
            <div className="font-bold" style={{ fontSize: 16 }}>🎉 Video Generated Successfully!</div>
            <div style={{ fontSize: 13, color: "#6b7280" }}>Your cinematic AI video is ready to preview and download</div>
          </div>
        </div>
      )}

      {/* Video player */}
      <div className="glass-card" style={{ padding: "24px" }}>
        <div className="video-container mb-4" style={{
          aspectRatio: project.aspect_ratio === "9:16" ? "9/16" : project.aspect_ratio === "1:1" ? "1/1" : "16/9",
          maxWidth: project.aspect_ratio === "9:16" ? "360px" : project.aspect_ratio === "1:1" ? "480px" : "100%",
          margin: "0 auto"
        }}>
          <video
            src={project.final_video_url}
            controls
            style={{ width: "100%", height: "100%" }}
          />
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            <div style={{ color: "#4b5563", fontSize: 10, marginBottom: 2 }}>DURATION</div>
            {project.duration}s
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            <div style={{ color: "#4b5563", fontSize: 10, marginBottom: 2 }}>RESOLUTION</div>
            {project.resolution}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            <div style={{ color: "#4b5563", fontSize: 10, marginBottom: 2 }}>ASPECT RATIO</div>
            {project.aspect_ratio}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            <div style={{ color: "#4b5563", fontSize: 10, marginBottom: 2 }}>SCENES</div>
            {project.scenes.length}
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <a
            href={project.final_video_url}
            download="final_video.mp4"
            className="btn-glow flex items-center gap-2"
            style={{ fontSize: 14, textDecoration: "none" }}
          >
            <Download size={16} />
            Download MP4
          </a>
          <button
            onClick={handleRender}
            disabled={rendering}
            style={{
              background: "rgba(30,45,69,0.5)", border: "1px solid #1e2d45",
              borderRadius: 10, padding: "10px 20px", cursor: "pointer",
              color: "#9ca3af", fontSize: 13, display: "flex", gap: 6, alignItems: "center",
            }}
          >
            <RefreshCw size={13} /> Rerender
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: "pipeline", label: "Pipeline" },
  { id: "script", label: "Script" },
  { id: "assets", label: "Assets" },
  { id: "voice", label: "Voice" },
  { id: "final", label: "Final Video" },
];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { project, loading, error, refresh, setProject } = useProject(id);
  const [activeTab, setActiveTab] = useState("pipeline");

  const handleWsMessage = useCallback((msg: WSMessage) => {
    if (msg.type === "PROGRESS_UPDATE") {
      setProject(prev => prev ? {
        ...prev,
        progress: msg.progress,
        current_stage: msg.stage,
        status: msg.status === "completed" ? "completed" : prev.status,
      } : prev);
    } else if (msg.type === "GENERATION_COMPLETED") {
      refresh();
      setActiveTab("final");
    } else if (msg.type === "GENERATION_ERROR") {
      refresh();
    }
  }, [refresh, setProject]);

  useWebSocket(id, {
    onMessage: handleWsMessage,
    enabled: !!project && ["pending", "processing"].includes(project.status),
  });

  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await api.retryProject(id);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to retry generation");
    } finally {
      setRetrying(false);
    }
  };

  if (loading && !project) {
    return (
      <div className="flex items-center justify-center" style={{ height: "100vh" }}>
        <Loader2 size={32} className="animate-spin" style={{ color: "#3b82f6" }} />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ height: "100vh" }}>
        <XCircle size={48} style={{ color: "#ef4444", marginBottom: 16 }} />
        <h2 className="font-bold mb-2">Project not found</h2>
        <Link href="/projects" style={{ color: "#3b82f6" }}>← Back to Projects</Link>
      </div>
    );
  }

  return (
    <div style={{ padding: "32px 48px", maxWidth: 1100 }}>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/projects" style={{ color: "#6b7280", display: "flex", alignItems: "center", gap: 4, textDecoration: "none", fontSize: 13 }}>
          <ChevronLeft size={14} /> Projects
        </Link>
        <div style={{ color: "#1e2d45" }}>/</div>
        <h1 className="font-bold truncate" style={{ fontSize: 20 }}>{project.title}</h1>
        <span className={`badge badge-${project.status}`} style={{ marginLeft: "auto" }}>
          {project.status.replace(/_/g, " ")}
        </span>
      </div>

      {/* Failure banner with Retry button */}
      {project.status === "failed" && (
        <div
          className="glass-card mb-6 flex flex-col md:flex-row md:items-center gap-4"
          style={{
            padding: "20px 24px",
            background: "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.03))",
            borderColor: "rgba(239,68,68,0.2)",
          }}
        >
          <div className="flex items-center justify-center rounded-xl" style={{ width: 44, height: 44, background: "rgba(239,68,68,0.15)", flexShrink: 0 }}>
            <AlertTriangle size={20} style={{ color: "#f87171" }} />
          </div>
          <div>
            <div className="font-bold" style={{ fontSize: 16, color: "#f87171" }}>Pipeline Execution Failed</div>
            <div style={{ fontSize: 13, color: "#9ca3af" }}>
              {project.error_message || "An unknown error occurred during generation."}
            </div>
          </div>
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="flex items-center gap-2 shadow-sm"
            style={{
              marginLeft: "auto",
              background: "rgba(239,68,68,0.2)",
              border: "1px solid rgba(239,68,68,0.4)",
              color: "#f87171",
              padding: "10px 20px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Retry Generation
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6" style={{ borderBottom: "1px solid #1e2d45", paddingBottom: 0 }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "8px 16px",
              fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? "#3b82f6" : "#6b7280",
              borderBottom: activeTab === tab.id ? "2px solid #3b82f6" : "2px solid transparent",
              marginBottom: -1,
              transition: "all 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "pipeline" && <PipelineStatus project={project} />}
      {activeTab === "script" && <ScriptTab project={project} onRefresh={refresh} />}
      {activeTab === "assets" && <AssetsTab project={project} onRefresh={refresh} />}
      {activeTab === "voice" && <VoiceTab project={project} />}
      {activeTab === "final" && <FinalVideoTab project={project} onRefresh={refresh} />}
    </div>
  );
}
