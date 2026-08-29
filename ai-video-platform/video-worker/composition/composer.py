"""
Video Composer — orchestrates the complete FFmpeg pipeline.
"""
import os
import tempfile
from pathlib import Path
from typing import Optional

import structlog

from ffmpeg.processor import (
    concatenate_videos,
    create_concat_file,
    create_image_video,
    normalize_video,
    add_audio_to_video,
    add_background_music,
    burn_subtitles,
    get_duration,
    extend_video_to_duration,
)
from subtitles.generator import generate_srt

logger = structlog.get_logger(__name__)


class VideoComposer:
    """Full pipeline: scenes → normalized → concat → audio → subtitles → final MP4."""

    def __init__(
        self,
        project_id: str,
        resolution: str = "1920x1080",
        fps: int = 30,
    ) -> None:
        self.project_id = project_id
        self.resolution = resolution
        self.fps = fps

    def compose(
        self,
        scene_videos: list[dict],
        audio_path: str,
        output_path: str,
        subtitle_path: str,
        audio_duration: float | None = None,
        subtitles_enabled: bool = True,
        subtitle_style: str = "minimalist_white",
        background_music_path: str | None = None,
    ) -> str:
        """
        Full composition pipeline.

        scene_videos: list of dicts with keys:
            scene_number, video_path, duration, narration
            (Also looks for image_path as fallback if video_path missing/failed)
        """
        logger.info(
            "composition_started",
            project_id=self.project_id,
            scene_count=len(scene_videos),
            resolution=self.resolution,
            fps=self.fps,
        )

        with tempfile.TemporaryDirectory(prefix="aivp_compose_") as tmp_dir:
            tmp = Path(tmp_dir)

            # ── Step 1: Generate SRT subtitles ──────────────────────────────────
            if subtitles_enabled:
                logger.info("[COMPOSE] Generating subtitles")
                generate_srt(
                    scenes=scene_videos,
                    output_path=subtitle_path,
                    audio_duration=audio_duration,
                )

            # ── Step 2: Normalize each scene video ──────────────────────────────
            logger.info("[COMPOSE] Normalizing scene videos")
            normalized_paths = []

            for scene in sorted(scene_videos, key=lambda s: s["scene_number"]):
                scene_num = scene["scene_number"]
                scene_duration = float(scene["duration"])
                video_path = scene.get("video_path", "")
                image_path = video_path.replace("video.mp4", "image.png")

                norm_path = str(tmp / f"scene_{scene_num:03d}_norm.mp4")

                if video_path and Path(video_path).exists() and Path(video_path).stat().st_size > 100_000:
                    # Normalize the existing video
                    actual_dur = get_duration(video_path)

                    if actual_dur < scene_duration - 0.5:
                        # Video is shorter than expected — extend by looping
                        extended = str(tmp / f"scene_{scene_num:03d}_extended.mp4")
                        extend_video_to_duration(video_path, extended, scene_duration)
                        normalize_video(extended, norm_path, self.resolution, self.fps, scene_duration)
                    else:
                        normalize_video(video_path, norm_path, self.resolution, self.fps, scene_duration)

                elif Path(image_path).exists():
                    # Fallback: use the static image
                    logger.warning(
                        "using_image_fallback",
                        scene_number=scene_num,
                        reason="video missing or too small",
                    )
                    create_image_video(image_path, norm_path, scene_duration, self.resolution, self.fps)
                else:
                    logger.error(
                        "no_scene_asset",
                        scene_number=scene_num,
                        video_path=video_path,
                    )
                    # Create a black screen fallback
                    black_path = str(tmp / f"scene_{scene_num:03d}_black.mp4")
                    self._create_black_screen(black_path, scene_duration)
                    normalize_video(black_path, norm_path, self.resolution, self.fps, scene_duration)

                normalized_paths.append(norm_path)
                logger.info("[COMPOSE] Scene normalized", scene_number=scene_num)

            # ── Step 3: Concatenate ─────────────────────────────────────────────
            logger.info("[COMPOSE] Concatenating scenes")
            concat_file = str(tmp / "concat.txt")
            create_concat_file(normalized_paths, concat_file)
            concat_output = str(tmp / "concatenated.mp4")
            concatenate_videos(concat_file, concat_output)

            # ── Step 4: Add narration audio ─────────────────────────────────────
            logger.info("[COMPOSE] Adding narration audio")
            video_with_audio = str(tmp / "with_audio.mp4")

            if Path(audio_path).exists():
                add_audio_to_video(
                    video_path=concat_output,
                    audio_path=audio_path,
                    output_path=video_with_audio,
                    video_duration=audio_duration,
                )
            else:
                logger.warning("narration_audio_not_found", audio_path=audio_path)
                video_with_audio = concat_output

            # ── Step 5: Add background music (optional) ─────────────────────────
            if background_music_path and Path(background_music_path).exists():
                logger.info("[COMPOSE] Adding background music")
                with_music = str(tmp / "with_music.mp4")
                add_background_music(video_with_audio, background_music_path, with_music)
                video_with_audio = with_music

            # ── Step 6: Burn subtitles (optional) ───────────────────────────────
            final_input = video_with_audio

            if subtitles_enabled and Path(subtitle_path).exists():
                logger.info("[COMPOSE] Burning subtitles", style=subtitle_style)
                with_subs = str(tmp / "with_subtitles.mp4")
                try:
                    burn_subtitles(final_input, subtitle_path, with_subs, style=subtitle_style)
                    final_input = with_subs
                except Exception as e:
                    logger.warning(
                        "subtitle_burn_failed",
                        error=str(e),
                        message="Continuing without subtitles burned in.",
                    )

            # ── Step 7: Copy to final output ────────────────────────────────────
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            import shutil
            shutil.copy2(final_input, output_path)

            final_duration = get_duration(output_path)
            logger.info(
                "composition_completed",
                project_id=self.project_id,
                output_path=output_path,
                duration=final_duration,
            )

            return output_path

    def _create_black_screen(self, output_path: str, duration: float) -> None:
        """Create a black screen video as last-resort fallback."""
        from ffmpeg.processor import _run_ffmpeg
        _run_ffmpeg([
            "-f", "lavfi",
            "-i", f"color=c=black:size={self.resolution}:rate={self.fps}",
            "-t", str(duration),
            "-c:v", "libx264",
            output_path,
        ], "create_black_screen")
