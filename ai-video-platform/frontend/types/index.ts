/**
 * TypeScript types for the entire platform.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type ProjectStatus =
  | "draft"
  | "pending"
  | "processing"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type GenerationMode =
  | "fully_automatic"
  | "review_script"
  | "review_assets"
  | "review_before_final";

export type SceneStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "flow_automation_error"
  | "retrying";

export type AssetType = "image" | "video" | "audio" | "subtitle" | "final_video";
export type AssetStatus = "pending" | "generating" | "downloading" | "completed" | "failed" | "corrupted";

export type JobType =
  | "script_generation"
  | "scene_prompt_generation"
  | "flow_image_generation"
  | "flow_video_generation"
  | "elevenlabs_generation"
  | "video_composition"
  | "finalization";

export type JobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled" | "retrying";

// ─── API Models ───────────────────────────────────────────────────────────────

export interface Asset {
  id: string;
  asset_type: AssetType;
  status: AssetStatus;
  public_url: string | null;
  file_size: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface Scene {
  id: string;
  project_id: string;
  scene_number: number;
  start_time: string;
  end_time: string;
  duration: number;
  narration: string;
  image_prompt: string;
  video_prompt: string;
  visual_description: string | null;
  status: SceneStatus;
  image_status: SceneStatus;
  video_status: SceneStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  assets: Asset[];
}

export interface Project {
  id: string;
  user_id: string;
  title: string;
  prompt: string;
  duration: number;
  language: string;
  voice_id: string | null;
  video_style: string | null;
  image_style: string | null;
  aspect_ratio: string;
  resolution: string;
  background_music: boolean;
  subtitles_enabled: boolean;
  generation_mode: GenerationMode;
  status: ProjectStatus;
  progress: number;
  current_stage: string | null;
  error_message: string | null;
  script_data: ScriptData | null;
  visual_style_data: VisualStyleData | null;
  thumbnail_url: string | null;
  final_video_url: string | null;
  narration_url: string | null;
  subtitle_url: string | null;
  narration_duration: number | null;
  created_at: string;
  updated_at: string;
  scenes: Scene[];
}

export interface ProjectListItem {
  id: string;
  title: string;
  prompt: string;
  duration: number;
  status: ProjectStatus;
  progress: number;
  current_stage: string | null;
  thumbnail_url: string | null;
  final_video_url: string | null;
  created_at: string;
  updated_at: string;
  scene_count: number;
}

export interface DashboardStats {
  total_projects: number;
  processing_projects: number;
  completed_projects: number;
  failed_projects: number;
  total_videos: number;
}

// ─── Script data ──────────────────────────────────────────────────────────────

export interface VisualStyleData {
  visual_style: string;
  color_style: string;
  camera_style: string;
  character_consistency: string;
  environment_style: string | null;
}

export interface SceneData {
  scene_number: number;
  start_time: string;
  end_time: string;
  duration: number;
  narration: string;
  image_prompt: string;
  video_prompt: string;
  visual_description: string | null;
}

export interface ScriptData {
  title: string;
  description: string;
  duration: number;
  language: string;
  visual_style: VisualStyleData | null;
  scenes: SceneData[];
}

// ─── API Request types ────────────────────────────────────────────────────────

export interface CreateProjectRequest {
  prompt: string;
  duration: number;
  language?: string;
  voice_id?: string;
  video_style?: string;
  image_style?: string;
  aspect_ratio?: string;
  resolution?: string;
  background_music?: boolean;
  subtitles_enabled?: boolean;
  generation_mode?: GenerationMode;
}

export interface UpdateSceneRequest {
  narration?: string;
  image_prompt?: string;
  video_prompt?: string;
  visual_description?: string;
}

// ─── WebSocket messages ───────────────────────────────────────────────────────

export interface WSProgressMessage {
  type: "PROGRESS_UPDATE";
  project_id: string;
  stage: string;
  progress: number;
  status: string;
  message?: string;
  current_scene?: number;
  total_scenes?: number;
  title?: string;
  scene_count?: number;
  audio_url?: string;
  final_video_url?: string;
}

export interface WSCompletedMessage {
  type: "GENERATION_COMPLETED";
  project_id: string;
  final_video_url: string;
}

export interface WSErrorMessage {
  type: "GENERATION_ERROR";
  project_id: string;
  stage: string;
  error: string;
}

export type WSMessage = WSProgressMessage | WSCompletedMessage | WSErrorMessage;

// ─── Pipeline stages ──────────────────────────────────────────────────────────

export interface PipelineStage {
  id: string;
  label: string;
  icon: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress?: number;
  sub_items?: PipelineSubItem[];
}

export interface PipelineSubItem {
  label: string;
  status: "pending" | "processing" | "completed" | "failed";
}
