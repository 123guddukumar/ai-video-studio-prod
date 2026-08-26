"""
Tests for the script generation service.
"""
import pytest
import json

from app.schemas.script import ScriptSchema, SceneSchema, VisualStyleSchema
from app.services.script_service import _extract_json, _calculate_scene_distribution


class TestExtractJson:
    def test_clean_json(self):
        data = {"title": "test"}
        result = _extract_json(json.dumps(data))
        assert result == data

    def test_json_with_markdown_fence(self):
        data = {"title": "test"}
        text = f"```json\n{json.dumps(data)}\n```"
        result = _extract_json(text)
        assert result == data

    def test_json_with_prefix_text(self):
        data = {"title": "test"}
        text = f"Here is your script:\n{json.dumps(data)}"
        result = _extract_json(text)
        assert result == data

    def test_invalid_json_raises(self):
        with pytest.raises(ValueError):
            _extract_json("not json at all")


class TestSceneDistribution:
    def test_30_seconds(self):
        result = _calculate_scene_distribution(30)
        assert "30s" in result

    def test_60_seconds(self):
        result = _calculate_scene_distribution(60)
        assert "60s" in result


class TestScriptSchema:
    def _make_scene(self, n: int, start: str, end: str, dur: int) -> dict:
        return {
            "scene_number": n,
            "start_time": start,
            "end_time": end,
            "duration": dur,
            "narration": f"Narration for scene {n}",
            "image_prompt": f"Image prompt for scene {n}",
            "video_prompt": f"Video prompt for scene {n}",
        }

    def test_valid_script(self):
        script = ScriptSchema.model_validate({
            "title": "Test Video",
            "description": "A test",
            "duration": 24,
            "language": "en",
            "scenes": [
                self._make_scene(1, "00:00", "00:08", 8),
                self._make_scene(2, "00:08", "00:16", 8),
                self._make_scene(3, "00:16", "00:24", 8),
            ],
        })
        assert len(script.scenes) == 3
        assert sum(s.duration for s in script.scenes) == 24

    def test_duration_mismatch_fails(self):
        with pytest.raises(Exception):
            ScriptSchema.model_validate({
                "title": "Test",
                "description": "A test",
                "duration": 60,  # says 60 but scenes sum to 24
                "language": "en",
                "scenes": [
                    self._make_scene(1, "00:00", "00:08", 8),
                    self._make_scene(2, "00:08", "00:16", 8),
                    self._make_scene(3, "00:16", "00:24", 8),
                ],
            })

    def test_non_sequential_scene_numbers_fails(self):
        with pytest.raises(Exception):
            ScriptSchema.model_validate({
                "title": "Test",
                "description": "A test",
                "duration": 16,
                "language": "en",
                "scenes": [
                    self._make_scene(1, "00:00", "00:08", 8),
                    self._make_scene(3, "00:08", "00:16", 8),  # jumps to 3
                ],
            })

    def test_empty_narration_fails(self):
        with pytest.raises(Exception):
            SceneSchema.model_validate({
                "scene_number": 1,
                "start_time": "00:00",
                "end_time": "00:08",
                "duration": 8,
                "narration": "",   # empty!
                "image_prompt": "some prompt",
                "video_prompt": "some prompt",
            })

    def test_invalid_time_format_fails(self):
        with pytest.raises(Exception):
            SceneSchema.model_validate({
                "scene_number": 1,
                "start_time": "0:0",  # wrong format
                "end_time": "00:08",
                "duration": 8,
                "narration": "test",
                "image_prompt": "prompt",
                "video_prompt": "prompt",
            })


class TestSubtitleGenerator:
    def test_generate_srt_basic(self, tmp_path):
        from video_worker_compat import generate_srt_compat
        # Only run if video-worker subtitles module is importable
        pytest.skip("Requires video-worker module — run from video-worker dir")
