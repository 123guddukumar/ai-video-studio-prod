"""
SRT subtitle generator.

Creates .srt files from scene narrations with timing derived from
the actual audio duration (from ElevenLabs).
"""
from pathlib import Path

import structlog

logger = structlog.get_logger(__name__)


def _seconds_to_srt_time(seconds: float) -> str:
    """Convert seconds to SRT timestamp format: HH:MM:SS,mmm"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _split_narration_into_lines(narration: str, max_chars: int = 80) -> list[str]:
    """Split long narration into subtitle-sized lines."""
    words = narration.split()
    lines = []
    current = []
    current_len = 0

    for word in words:
        if current_len + len(word) + 1 > max_chars and current:
            lines.append(" ".join(current))
            current = [word]
            current_len = len(word)
        else:
            current.append(word)
            current_len += len(word) + 1

    if current:
        lines.append(" ".join(current))

    return lines


def generate_srt(
    scenes: list[dict],
    output_path: str | Path,
    audio_duration: float | None = None,
) -> str:
    """
    Generate an SRT subtitle file from scenes.

    Each scene dict must have:
        scene_number, start_time, end_time, duration, narration

    If audio_duration is provided, scale timings proportionally.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    total_declared_duration = sum(s["duration"] for s in scenes)
    scale_factor = (
        audio_duration / total_declared_duration
        if audio_duration and total_declared_duration > 0
        else 1.0
    )

    srt_entries = []
    cursor = 0.0
    entry_index = 1

    for scene in sorted(scenes, key=lambda s: s["scene_number"]):
        narration = scene["narration"].strip()
        if not narration:
            cursor += scene["duration"] * scale_factor
            continue

        scene_start = cursor
        scene_end = cursor + scene["duration"] * scale_factor

        # Split into subtitle blocks (max 2 lines per block, ~5s each)
        lines = _split_narration_into_lines(narration)

        # Group lines into blocks of 2
        for i in range(0, len(lines), 2):
            block_lines = lines[i : i + 2]
            block_text = "\n".join(block_lines)

            # Distribute time evenly across blocks in this scene
            n_blocks = (len(lines) + 1) // 2
            block_duration = (scene_end - scene_start) / n_blocks
            block_start = scene_start + (i // 2) * block_duration
            block_end = block_start + block_duration

            srt_entries.append(
                f"{entry_index}\n"
                f"{_seconds_to_srt_time(block_start)} --> {_seconds_to_srt_time(block_end)}\n"
                f"{block_text}\n"
            )
            entry_index += 1

        cursor = scene_end

    srt_content = "\n".join(srt_entries)
    output_path.write_text(srt_content, encoding="utf-8")

    logger.info(
        "srt_generated",
        output_path=str(output_path),
        entries=len(srt_entries),
        total_duration=cursor,
    )

    return str(output_path)
