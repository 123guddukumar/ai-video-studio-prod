"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { DashboardStats, ProjectListItem } from "@/types";
import {
  Video, Loader2, CheckCircle2, XCircle, Clock,
  Plus, ArrowRight, TrendingUp
} from "lucide-react";

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  glow,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  glow: string;
}) {
  return (
    <div className="stat-card" style={{ borderColor: glow + "30" }}>
      <div className="flex items-start justify-between mb-4">
        <div
          className="flex items-center justify-center rounded-xl"
          style={{ background: glow + "20", width: 44, height: 44, border: `1px solid ${glow}40` }}
        >
          <Icon size={20} style={{ color }} />
        </div>
        <TrendingUp size={14} style={{ color: "#374151" }} />
      </div>
      <div
        className="font-bold mb-1"
        style={{ fontSize: 32, background: `linear-gradient(135deg, ${color}, white)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
      >
        {value.toLocaleString()}
      </div>
      <div style={{ color: "#6b7280", fontSize: 13 }}>{label}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [s, p] = await Promise.all([api.getStats(), api.getProjects()]);
        setStats(s);
        setRecentProjects(p.slice(0, 3));
      } catch {
        // API not available yet — show zeros
        setStats({ total_projects: 0, processing_projects: 0, completed_projects: 0, failed_projects: 0, total_videos: 0 });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div style={{ padding: "40px 48px", maxWidth: 1200 }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="gradient-text font-bold" style={{ fontSize: 32 }}>Dashboard</h1>
          <p style={{ color: "#6b7280", marginTop: 4 }}>Your AI video production overview</p>
        </div>
        <Link href="/projects/new" className="btn-glow flex items-center gap-2" style={{ textDecoration: "none" }}>
          <Plus size={16} />
          New Video
        </Link>
      </div>

      {/* Stat cards */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 mb-10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 120, borderRadius: 16 }} />
          ))}
        </div>
      ) : stats ? (
        <div className="grid gap-4 mb-10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <StatCard label="Total Projects" value={stats.total_projects} icon={Video} color="#3b82f6" glow="#3b82f6" />
          <StatCard label="Processing" value={stats.processing_projects} icon={Loader2} color="#f59e0b" glow="#f59e0b" />
          <StatCard label="Completed" value={stats.completed_projects} icon={CheckCircle2} color="#10b981" glow="#10b981" />
          <StatCard label="Failed" value={stats.failed_projects} icon={XCircle} color="#ef4444" glow="#ef4444" />
        </div>
      ) : null}

      {/* Hero create area */}
      <div
        className="glass-card mb-10"
        style={{ padding: "40px", background: "linear-gradient(135deg, rgba(59,130,246,0.05), rgba(139,92,246,0.05))" }}
      >
        <div className="flex flex-col md:flex-row items-center gap-8">
          <div className="flex-1">
            <h2 className="font-bold mb-3" style={{ fontSize: 24 }}>
              Create a new AI video
            </h2>
            <p style={{ color: "#9ca3af", marginBottom: 24, lineHeight: 1.6 }}>
              Paste your topic, choose a duration, and our multi-director AI pipeline will generate
              a complete cinematic video — script, visuals, voice, and final edit — all automatically.
            </p>
            <Link href="/projects/new" className="btn-glow inline-flex items-center gap-2" style={{ textDecoration: "none" }}>
              Start Creating
              <ArrowRight size={16} />
            </Link>
          </div>

          {/* Mini pipeline preview */}
          <div style={{ minWidth: 240 }}>
            {[
              { icon: "✍️", label: "Script Director", done: true },
              { icon: "🎨", label: "Visual Director", done: true },
              { icon: "🌐", label: "Google Flow", done: true },
              { icon: "🎙️", label: "ElevenLabs Voice", done: false },
              { icon: "🎬", label: "FFmpeg Compose", done: false },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3 mb-3">
                <span style={{ fontSize: 16 }}>{step.icon}</span>
                <div className="flex-1" style={{ fontSize: 13, color: step.done ? "#9ca3af" : "#4b5563" }}>
                  {step.label}
                </div>
                {step.done && <CheckCircle2 size={14} style={{ color: "#10b981" }} />}
                {!step.done && <Clock size={14} style={{ color: "#374151" }} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent projects */}
      {recentProjects.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold" style={{ fontSize: 18 }}>Recent Projects</h3>
            <Link href="/projects" style={{ color: "#3b82f6", fontSize: 13, textDecoration: "none" }}>
              View all →
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {recentProjects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="glass-card flex items-center gap-4"
                style={{ padding: "16px 20px", textDecoration: "none", display: "flex" }}
              >
                {/* Thumbnail */}
                <div
                  className="rounded-lg flex items-center justify-center"
                  style={{ width: 56, height: 40, background: "#1e2d45", flexShrink: 0 }}
                >
                  {p.thumbnail_url ? (
                    <img src={p.thumbnail_url} alt="" className="rounded-lg" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Video size={16} style={{ color: "#374151" }} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate" style={{ fontSize: 14 }}>{p.title}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>{p.duration}s · {p.scene_count} scenes</div>
                </div>

                <span className={`badge badge-${p.status}`}>{p.status.replace("_", " ")}</span>

                {/* Progress */}
                {p.status === "processing" && (
                  <div style={{ minWidth: 80 }}>
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{ width: `${p.progress}%` }} />
                    </div>
                    <div style={{ fontSize: 10, color: "#6b7280", textAlign: "right", marginTop: 2 }}>{Math.round(p.progress)}%</div>
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
