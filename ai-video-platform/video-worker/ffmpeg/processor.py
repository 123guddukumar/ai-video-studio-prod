"""
FFmpeg wrapper — all low-level FFmpeg subprocess calls.
"""
import asyncio
import json
import subprocess
from pathlib import Path
from typing import Optional

import structlog

logger = structlog.get_logger(__name__)

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"


def _run_ffmpeg(args: list[str], log_context: str = "ffmpeg") -> subprocess.CompletedProcess:
    """Run FFmpeg synchronously and raise on non-zero exit."""
    cmd = [FFMPEG, "-y"] + args
    logger.info(f"[FFMPEG] {log_context}", cmd=" ".join(cmd))

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        logger.error(
            "ffmpeg_error",
            context=log_context,
            stderr=result.stderr[-2000:],
        )
        raise RuntimeError(f"FFmpeg failed [{log_context}]: {result.stderr[-500:]}")

    return result


def get_media_info(file_path: str) -> dict:
    """Return probe data for a media file."""
    cmd = [
        FFPROBE, "-v", "quiet", "-print_format", "json",
        "-show_streams", "-show_format", file_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    return json.loads(result.stdout)


def get_duration(file_path: str) -> float:
    """Return duration in seconds of a media file."""
    info = get_media_info(file_path)
    return float(info.get("format", {}).get("duration", 0))


def normalize_video(
    input_path: str,
    output_path: str,
    resolution: str = "1920x1080",
    fps: int = 30,
    duration: Optional[float] = None,
) -> str:
    """
    Normalize a video clip to a consistent codec, resolution, and FPS.
    Optionally trim/extend to exact duration.
    """
    width, height = resolution.split("x")

    filter_complex = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps}"

    if duration:
        try:
            actual_duration = get_duration(input_path)
            if actual_duration > duration + 0.1:
                speed_ratio = duration / actual_duration
                filter_complex += f",setpts={speed_ratio:.4f}*PTS"
                logger.info("[FFMPEG] Speeding up scene video to fit duration", input=input_path, actual=actual_duration, target=duration, ratio=speed_ratio)
        except Exception as e:
            logger.warning("[FFMPEG] Failed to compute duration for speed up check", error=str(e))

    args = [
        "-i", input_path,
        "-vf", filter_complex,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-c:a", "aac",
        "-ar", "44100",
        "-ac", "2",
        "-movflags", "+faststart",
    ]

    if duration:
        args += ["-t", str(duration)]

    args.append(output_path)
    _run_ffmpeg(args, f"normalize_video:{Path(input_path).stem}")
    return output_path


def extend_video_to_duration(input_path: str, output_path: str, target_duration: float) -> str:
    """Extend a short video by looping it to reach target_duration."""
    args = [
        "-stream_loop", "-1",
        "-i", input_path,
        "-t", str(target_duration),
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-c:a", "aac",
        output_path,
    ]
    _run_ffmpeg(args, f"extend_video:{Path(input_path).stem}")
    return output_path


def create_concat_file(video_paths: list[str], concat_file_path: str) -> str:
    """Create an FFmpeg concat file listing all video paths."""
    with open(concat_file_path, "w") as f:
        for path in video_paths:
            f.write(f"file '{path}'\n")
    return concat_file_path


def concatenate_videos(concat_file_path: str, output_path: str) -> str:
    """Concatenate videos listed in a concat file."""
    args = [
        "-f", "concat",
        "-safe", "0",
        "-i", concat_file_path,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-c:a", "aac",
        "-movflags", "+faststart",
        output_path,
    ]
    _run_ffmpeg(args, "concatenate_videos")
    return output_path


def add_audio_to_video(
    video_path: str,
    audio_path: str,
    output_path: str,
    video_duration: float | None = None,
) -> str:
    """Merge narration audio with video. Video length wins if audio is longer."""
    args = [
        "-i", video_path,
        "-i", audio_path,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
    ]

    if video_duration:
        args += ["-t", str(video_duration)]

    args.append(output_path)
    _run_ffmpeg(args, "add_audio")
    return output_path


def add_background_music(
    video_path: str,
    music_path: str,
    output_path: str,
    music_volume: float = 0.15,
) -> str:
    """Mix background music under the narration track."""
    args = [
        "-i", video_path,
        "-i", music_path,
        "-filter_complex",
        f"[0:a]volume=1.0[narration];"
        f"[1:a]volume={music_volume},aloop=loop=-1:size=2e+09[music];"
        f"[narration][music]amix=inputs=2:duration=first[mixed]",
        "-map", "0:v",
        "-map", "[mixed]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        output_path,
    ]
    _run_ffmpeg(args, "add_background_music")
    return output_path


def burn_subtitles(
    video_path: str,
    subtitle_path: str,
    output_path: str,
    font_size: int = 24,
    font_color: str = "white",
) -> str:
    """Burn subtitles into the video (hard subtitles)."""
    safe_subtitle = subtitle_path.replace("\\", "/").replace(":", "\\:")
    args = [
        "-i", video_path,
        "-vf", f"subtitles='{safe_subtitle}':force_style='FontSize={font_size},"
               f"PrimaryColour=&H00FFFFFF,Outline=2,Shadow=0,BorderStyle=3'",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-c:a", "copy",
        output_path,
    ]
    _run_ffmpeg(args, "burn_subtitles")
    return output_path


def create_image_video(
    image_path: str,
    output_path: str,
    duration: float,
    resolution: str = "1920x1080",
    fps: int = 30,
) -> str:
    """Create a static image video as fallback when video generation failed."""
    width, height = resolution.split("x")
    args = [
        "-loop", "1",
        "-i", image_path,
        "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
               f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-t", str(duration),
        "-pix_fmt", "yuv420p",
        "-r", str(fps),
        output_path,
    ]
    _run_ffmpeg(args, "create_image_video")
    return output_path
