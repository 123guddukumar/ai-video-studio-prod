"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ProjectListItem } from "@/types";
import { Video, Plus, Trash2, ExternalLink, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";

function statusIcon(status: string) {
  switch (status) {
    case "completed": return <CheckCircle2 size={14} style={{ color: "#10b981" }} />;
    case "failed": return <XCircle size={14} style={{ color: "#ef4444" }} />;
    case "processing": return <Loader2 size={14} style={{ color: "#3b82f6" }} className="animate-spin" />;
    default: return <Clock size={14} style={{ color: "#6b7280" }} />;
  }
}

function ProjectCard({ project, onDelete }: { project: ProjectListItem; onDelete: () => void }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm("Delete this project? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await api.deleteProject(project.id);
      onDelete();
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div
      className="glass-card"
      style={{ padding: 0, overflow: "hidden" }}
    >
      {/* Thumbnail */}
      <div style={{ height: 140, background: "linear-gradient(135deg, #0d1421, #111827)", position: "relative" }}>
        {project.thumbnail_url ? (
          <img
            src={project.thumbnail_url}
            alt={project.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Video size={32} style={{ color: "#1e2d45" }} />
          </div>
        )}

        {/* Status badge */}
        <div style={{ position: "absolute", top: 10, right: 10 }}>
          <span className={`badge badge-${project.status}`}>{project.status.replace("_", " ")}</span>
        </div>

        {/* Duration badge */}
        <div
          style={{
            position: "absolute", bottom: 10, left: 10,
            background: "rgba(0,0,0,0.7)", borderRadius: 6,
            padding: "2px 8px", fontSize: 11, color: "#9ca3af"
          }}
        >
          {project.duration}s · {project.scene_count} scenes
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "16px 20px" }}>
        <h3 className="font-semibold truncate mb-1" style={{ fontSize: 14 }}>
          {project.title}
        </h3>
        <p
          className="truncate"
          style={{ color: "#6b7280", fontSize: 12, marginBottom: 12 }}
        >
          {project.prompt}
        </p>

        {/* Progress */}
        {project.status === "processing" && (
          <div className="mb-3">
            <div className="flex justify-between mb-1">
              <span style={{ fontSize: 11, color: "#6b7280" }}>{project.current_stage?.replace(/_/g, " ")}</span>
              <span style={{ fontSize: 11, color: "#3b82f6" }}>{Math.round(project.progress)}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${project.progress}%` }} />
            </div>
          </div>
        )}

        {/* Date */}
        <div style={{ color: "#4b5563", fontSize: 11, marginBottom: 14 }}>
          {new Date(project.created_at).toLocaleDateString("en-US", {
            month: "short", day: "numeric", year: "numeric"
          })}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Link
            href={`/projects/${project.id}`}
            className="flex-1 flex items-center justify-center gap-1"
            style={{
              background: "rgba(59,130,246,0.1)",
              border: "1px solid rgba(59,130,246,0.2)",
              borderRadius: 8, padding: "8px 12px",
              fontSize: 12, color: "#60a5fa", textDecoration: "none",
              transition: "all 0.15s ease",
            }}
          >
            <ExternalLink size={12} />
            Open
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 8, padding: "8px 10px",
              color: "#f87171", cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getProjects().then(setProjects).finally(() => setLoading(false));
  }, []);

  const handleDelete = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div style={{ padding: "40px 48px" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="gradient-text font-bold" style={{ fontSize: 32 }}>Projects</h1>
          <p style={{ color: "#6b7280", marginTop: 4 }}>
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link href="/projects/new" className="btn-glow flex items-center gap-2" style={{ textDecoration: "none" }}>
          <Plus size={16} />
          New Video
        </Link>
      </div>

      {/* Projects grid */}
      {loading ? (
        <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 340, borderRadius: 16 }} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center" style={{ paddingTop: 100 }}>
          <div
            className="flex items-center justify-center rounded-2xl mb-6"
            style={{ width: 80, height: 80, background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)" }}
          >
            <Video size={32} style={{ color: "#3b82f6" }} />
          </div>
          <h3 className="font-semibold mb-2" style={{ fontSize: 20 }}>No projects yet</h3>
          <p style={{ color: "#6b7280", marginBottom: 24 }}>Create your first AI video to get started</p>
          <Link href="/projects/new" className="btn-glow" style={{ textDecoration: "none" }}>
            Create Your First Video
          </Link>
        </div>
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={() => handleDelete(project.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
