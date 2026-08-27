"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { CreateProjectRequest, GenerationMode } from "@/types";
import {
  Clapperboard, Clock, Palette, Ratio, Globe, Mic,
  Subtitles, Zap, ChevronRight, Sparkles
} from "lucide-react";

const DURATIONS = [
  { value: 30, label: "30 sec" },
  { value: 60, label: "1 min" },
  { value: 90, label: "1.5 min" },
  { value: 120, label: "2 min" },
  { value: 180, label: "3 min" },
  { value: 300, label: "5 min" },
];

const VIDEO_STYLES = [
  "Cinematic Documentary",
  "Explainer Animation",
  "Corporate Professional",
  "Nature & Science",
  "Dramatic Cinematic",
  "Educational",
  "News Report",
  "Travel Vlog",
  "Cinematic Photorealistic Commercial",
  "Cinematic Real Estate Commercial",
  "Social Media UGC / Lifestyle Ad",
  "High-Energy Product Commercial",
  "Emotional Lifestyle Storytelling",
  "Hollywood Cinematic",
  "Bollywood Cinematic",
  "Realistic serious story",
  "Other",
];

const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9 Landscape" },
  { value: "9:16", label: "9:16 Portrait" },
  { value: "1:1", label: "1:1 Square" },
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "ar", label: "Arabic" },
];

const GENERATION_MODES: { value: GenerationMode; label: string; desc: string }[] = [
  { value: "fully_automatic", label: "⚡ Fully Automatic", desc: "Prompt → Final Video with no interruption" },
  { value: "review_script", label: "📝 Review Script", desc: "Pause after script for your approval" },
  { value: "review_assets", label: "🖼️ Review Assets", desc: "Pause after asset generation" },
  { value: "review_before_final", label: "🎬 Review Before Final", desc: "Approve everything before render" },
];

export default function NewProjectPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<"topic" | "script">("topic");

  const [refImage, setRefImage] = useState<File | null>(null);
  const [customStyle, setCustomStyle] = useState("");
  const [isOtherSelected, setIsOtherSelected] = useState(false);

  const [form, setForm] = useState<CreateProjectRequest>({
    prompt: "",
    duration: 60,
    language: "en",
    video_style: "Cinematic Documentary",
    image_style: "Cinematic Realistic",
    aspect_ratio: "16:9",
    resolution: "1920x1080",
    background_music: false,
    subtitles_enabled: true,
    generation_mode: "fully_automatic",
  });

  const set = <K extends keyof CreateProjectRequest>(k: K, v: CreateProjectRequest[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.prompt.trim()) {
      setError("Please enter a prompt");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const project = await api.createProject(form);
      if (refImage) {
        await api.uploadReferenceImage(project.id, refImage);
      }
      // Auto-start generation
      await api.generateScript(project.id);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "40px 48px", maxWidth: 800 }}>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1" style={{ color: "#3b82f6", fontSize: 13 }}>
          <Clapperboard size={14} />
          <span>AI VIDEO STUDIO</span>
        </div>
        <h1 className="gradient-text font-bold mb-2" style={{ fontSize: 36 }}>
          Create New Video
        </h1>
        <p style={{ color: "#6b7280", lineHeight: 1.6 }}>
          Describe your video idea and our multi-director AI pipeline will handle everything
          — script, visuals, voice, and final edit.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">

        {/* Creation Mode Tabs */}
        <div className="flex gap-4 p-1 rounded-lg bg-slate-900/80 border border-slate-800" style={{ maxWidth: "fit-content" }}>
          <button
            type="button"
            onClick={() => setInputMode("topic")}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              transition: "all 0.2s",
              background: inputMode === "topic" ? "rgba(59,130,246,0.15)" : "transparent",
              color: inputMode === "topic" ? "#60a5fa" : "#9ca3af",
              border: inputMode === "topic" ? "1px solid rgba(59,130,246,0.3)" : "1px solid transparent",
              cursor: "pointer",
            }}
          >
            💡 Generate from Topic
          </button>
          <button
            type="button"
            onClick={() => setInputMode("script")}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              transition: "all 0.2s",
              background: inputMode === "script" ? "rgba(139,92,246,0.15)" : "transparent",
              color: inputMode === "script" ? "#a78bfa" : "#9ca3af",
              border: inputMode === "script" ? "1px solid rgba(139,92,246,0.3)" : "1px solid transparent",
              cursor: "pointer",
            }}
          >
            🎬 Paste Manual Script
          </button>
        </div>

        {/* Prompt */}
        {inputMode === "topic" ? (
          <div className="glass-card" style={{ padding: "24px" }}>
            <label className="block font-semibold mb-2" style={{ fontSize: 14 }}>
              <Sparkles size={14} className="inline mr-2" style={{ color: "#3b82f6" }} />
              Video Idea / Topic *
            </label>
            <textarea
              className="textarea-dark"
              rows={4}
              placeholder="Explain how artificial intelligence will change education. Focus on personalized learning, AI tutors, and the future classroom. Make it inspiring and accessible to a general audience."
              value={form.prompt}
              onChange={(e) => set("prompt", e.target.value)}
              required
            />
            <p style={{ color: "#4b5563", fontSize: 12, marginTop: 8 }}>
              Be descriptive. Mention the audience, tone, and key points you want covered.
            </p>
          </div>
        ) : (
          <div className="glass-card" style={{ padding: "24px" }}>
            <label className="block font-semibold mb-2" style={{ fontSize: 14 }}>
              <Sparkles size={14} className="inline mr-2" style={{ color: "#8b5cf6" }} />
              Paste Manual Script *
            </label>
            <textarea
              className="textarea-dark"
              rows={12}
              placeholder={`🎬 30-Second Reel: “घर सिर्फ दीवारें नहीं होता”

0–3 sec — EMOTIONAL HOOK
🎥 Visual: सुबह का समय, बच्चा school bag लेकर घर से निकलता है; mother smiles.
🎙️ VO: “घर वही अच्छा है… जहां परिवार खुद को सुरक्षित महसूस करे।”

3–6 sec — COMPARISON
🎥 Visual: Society gate, security guard, CCTV.
🎙️ VO: “लेकिन सवाल है—Independent House या Society का Flat?”`}
              value={form.prompt}
              onChange={(e) => set("prompt", e.target.value)}
              required
              style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.5 }}
            />
            <p style={{ color: "#4b5563", fontSize: 12, marginTop: 8 }}>
              Paste your script containing timestamps (e.g. 0-3 sec), visuals, and voiceover details.
            </p>
          </div>
        )}

        {/* Reference Image Upload */}
        <div className="glass-card" style={{ padding: "24px" }}>
          <label className="block font-semibold mb-2" style={{ fontSize: 14 }}>
            🖼️ Optional Reference Image
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setRefImage(file);
            }}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: 8,
              background: "rgba(13,20,33,0.6)",
              border: "1px solid #1e2d45",
              color: "#9ca3af",
              fontSize: 13,
            }}
          />
          <p style={{ color: "#4b5563", fontSize: 12, marginTop: 8 }}>
            Upload an image to guide the style/composition of the generated scenes.
          </p>
        </div>

        {/* Duration + Style */}
        <div className="glass-card" style={{ padding: "24px" }}>
          <h3 className="font-semibold mb-4" style={{ fontSize: 14 }}>
            <Clock size={14} className="inline mr-2" style={{ color: "#8b5cf6" }} />
            Video Settings
          </h3>

          <div className="grid gap-4" style={{ gridTemplateColumns: inputMode === "topic" ? "1fr 1fr" : "1fr" }}>
            {/* Duration */}
            {inputMode === "topic" && (
              <div>
                <label className="block mb-2" style={{ color: "#9ca3af", fontSize: 13 }}>Duration</label>
                <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                  {DURATIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => set("duration", value)}
                      style={{
                        padding: "8px 4px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 500,
                        border: form.duration === value
                          ? "1px solid #3b82f6"
                          : "1px solid #1e2d45",
                        background: form.duration === value
                          ? "rgba(59,130,246,0.15)"
                          : "rgba(13,20,33,0.6)",
                        color: form.duration === value ? "#60a5fa" : "#6b7280",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Aspect ratio */}
            <div>
              <label className="block mb-2" style={{ color: "#9ca3af", fontSize: 13 }}>Aspect Ratio</label>
              <div className="flex flex-col gap-2">
                {ASPECT_RATIOS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set("aspect_ratio", value)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 500,
                      border: form.aspect_ratio === value
                        ? "1px solid #8b5cf6"
                        : "1px solid #1e2d45",
                      background: form.aspect_ratio === value
                        ? "rgba(139,92,246,0.15)"
                        : "rgba(13,20,33,0.6)",
                      color: form.aspect_ratio === value ? "#a78bfa" : "#6b7280",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Video style */}
            <div>
              <label className="block mb-2" style={{ color: "#9ca3af", fontSize: 13 }}>Video Style</label>
              <div className="relative">
                <select
                  className="select-dark"
                  style={{ width: "100%" }}
                  value={isOtherSelected ? "Other" : form.video_style}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "Other") {
                      setIsOtherSelected(true);
                      set("video_style", customStyle);
                    } else {
                      setIsOtherSelected(false);
                      set("video_style", val);
                    }
                  }}
                >
                  {VIDEO_STYLES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {isOtherSelected && (
                  <input
                    type="text"
                    placeholder="Enter custom video style..."
                    value={customStyle}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCustomStyle(val);
                      set("video_style", val);
                    }}
                    style={{
                      width: "100%",
                      padding: "10px",
                      borderRadius: 8,
                      background: "rgba(13,20,33,0.6)",
                      border: "1px solid #1e2d45",
                      color: "white",
                      fontSize: 13,
                      marginTop: 8,
                    }}
                  />
                )}
              </div>
            </div>

            {/* Language */}
            <div>
              <label className="block mb-2" style={{ color: "#9ca3af", fontSize: 13 }}>Language</label>
              <select
                className="select-dark"
                style={{ width: "100%" }}
                value={form.language}
                onChange={(e) => set("language", e.target.value)}
              >
                {LANGUAGES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Toggles */}
          <div className="flex gap-4 mt-4">
            <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 13, color: "#9ca3af" }}>
              <input
                type="checkbox"
                checked={form.subtitles_enabled}
                onChange={(e) => set("subtitles_enabled", e.target.checked)}
                style={{ accentColor: "#3b82f6" }}
              />
              Subtitles
            </label>
            <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 13, color: "#9ca3af" }}>
              <input
                type="checkbox"
                checked={form.background_music}
                onChange={(e) => set("background_music", e.target.checked)}
                style={{ accentColor: "#3b82f6" }}
              />
              Background Music
            </label>
          </div>
        </div>

        {/* Generation Mode */}
        <div className="glass-card" style={{ padding: "24px" }}>
          <h3 className="font-semibold mb-4" style={{ fontSize: 14 }}>
            <Zap size={14} className="inline mr-2" style={{ color: "#f59e0b" }} />
            Generation Mode
          </h3>
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {GENERATION_MODES.map(({ value, label, desc }) => (
              <button
                key={value}
                type="button"
                onClick={() => set("generation_mode", value)}
                style={{
                  padding: "12px 16px",
                  borderRadius: 10,
                  textAlign: "left",
                  border: form.generation_mode === value
                    ? "1px solid #f59e0b40"
                    : "1px solid #1e2d45",
                  background: form.generation_mode === value
                    ? "rgba(245,158,11,0.08)"
                    : "rgba(13,20,33,0.6)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: form.generation_mode === value ? "#fbbf24" : "#9ca3af", marginBottom: 3 }}>
                  {label}
                </div>
                <div style={{ fontSize: 11, color: "#4b5563" }}>{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 10,
            padding: "12px 16px",
            color: "#f87171",
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="btn-glow flex items-center justify-center gap-3"
          style={{ fontSize: 16, padding: "16px 32px" }}
        >
          {loading ? (
            <>
              <div className="animate-spin" style={{ width: 18, height: 18, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%" }} />
              Initializing pipeline...
            </>
          ) : (
            <>
              <Sparkles size={18} />
              Generate Video
              <ChevronRight size={18} />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
