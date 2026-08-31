"""
ScriptService — Groq-powered AI script generation.

Multi-director pipeline:
  Creative Director → Script Director → Timeline Director → Visual Director
  → Image Director → Video Director

Each director has a validator and a retry mechanism.
"""
import json
import re
from typing import Any

from groq import Groq
from pydantic import ValidationError
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings
from app.core.logging_config import get_logger
from app.schemas.script import ScriptSchema

logger = get_logger(__name__)


# ─── Prompt templates ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an elite AI video production system. You generate precise, 
production-ready video scripts in strict JSON format. You never return anything outside 
the JSON object. Your output is consumed directly by code — any non-JSON text will 
cause a system failure.

RULES:
- Return ONLY a valid JSON object, no markdown code fences, no explanations.
- Each scene duration MUST be maximum 6 seconds (e.g. 5s or 6s). No scene can be longer than 6 seconds.
- Scene durations must sum exactly to the requested total duration.
- Narration must be natural, engaging, and match scene duration (approximately 
  2.5 words per second).
- Image and video prompts must be highly cinematic, descriptive, but concise (maximum 35 words each) to stay within token limits.
- Include camera movements, lighting, subject, environment, composition.
- Never include text overlays, logos, or watermarks in prompts.
- Maintain visual consistency across all scenes using the visual_style object.
- Scene numbers must be sequential starting at 1.
- MULTI-LANGUAGE RULE: If the target language is NOT English, write ONLY the `narration` (voiceover) and the `title` in that language. All other JSON fields (image_prompt, video_prompt, visual_description, visual_style, color_style, camera_style, environment_style) MUST be in English. This is required because image generation models only understand English prompts, and it prevents token count overflow.
- REAL ESTATE & PREMIUM BUSINESS RULE: If the project topic is about real estate, property sales, or premium/corporate business, you MUST generate highly realistic, photorealistic, luxury-focused, and premium prompts. Avoid terms like "illustration", "cartoon", "3D render", "unreal engine". Instead, use descriptors like "photorealistic", "ultra-high-end modern architectural photography", "soft morning volumetric lighting", "immaculately styled luxury interior design", "sleek, modern, and realistic drone shots", "high-end real estate presentation", "professional cinematography with shallow depth of field". Ensure the subject is portrayed in a premium, elegant, and realistic light.
"""

def _build_user_prompt(
    prompt: str,
    duration: int,
    language: str,
    video_style: str,
    image_style: str,
    aspect_ratio: str,
    has_ref_image: bool = False,
) -> str:
    # Calculate scene distribution
    scenes_hint = _calculate_scene_distribution(duration)

    is_script = "\n" in prompt and (any(kw in prompt.lower() for kw in ["scene", "sec", "visual", "vo:", "bgm:", "narrator", "hook", "comparison", "fact"]))

    script_guideline = ""
    if is_script:
        script_guideline += f"""
- The user has provided a pre-written script below. Parse and map their script directly into the required JSON structure.
- DO NOT invent a new script or modify their narrative. Keep the scenes, durations/timings, and narrations (voiceovers) exactly as they specified in their script.
- DO NOT use the pre-calculated scene distribution hint. Create exactly the number of scenes present in the user's script.
- For each scene, compute its duration directly from the specified timestamp ranges (e.g. "0-3 sec" = 3 seconds duration, "6-10 sec" = 4 seconds duration).
- If they didn't write explicit cinematic image/video prompts, generate beautiful, cinematic prompts in English matching their visual descriptions.
- The input script:
\"\"\"
{prompt}
\"\"\"
"""
    else:
        script_guideline += f"Create a complete video script for the following topic.\n\nTOPIC: {prompt}"

    if has_ref_image:
        script_guideline += "\n- A reference image is provided for this project ([HAS_REFERENCE_IMAGE: TRUE]). Decide which scene(s) (typically the emotional hook, the brand intro, or where it is visually most appropriate) should use this reference image. For those scenes, prepend the exact string `[USE_REF_IMAGE] ` (with brackets and a space) to the very beginning of their `image_prompt`."

    requirements = f"""- Language: {language}
- Video style: {video_style}
- Image style: {image_style}
- Aspect ratio: {aspect_ratio}"""

    if not is_script:
        requirements += f"""\n- Total video duration: {duration} seconds
- Each scene duration MUST be maximum 6 seconds.
- Scene distribution: {scenes_hint}"""
    else:
        requirements += """\n- Create exactly the number of scenes present in the user's script.
- Assign the exact duration to each scene based on the user's timestamp ranges."""

    duration_json_val = "sum of all parsed scene durations in the script (seconds)" if is_script else str(duration)

    scenes_spec_bottom = ""
    if not is_script:
        scenes_spec_bottom = f"""
Scene durations must sum to exactly {duration} seconds.
Suggested scene breakdown: {scenes_hint}
Generate ALL scenes in the single JSON response."""
    else:
        scenes_spec_bottom = """
Scene durations and start/end times must be mapped exactly from the user's manual script.
Generate ALL scenes from the user's script in the single JSON response."""

    return f"""{script_guideline}

REQUIREMENTS:
{requirements}

VISUAL STYLE GUIDE:
- Style: {video_style}, {image_style}
- Camera: Cinematic professional camera
- Lighting: Natural, dramatic, cinematic
- Color: Rich, saturated, filmic

Return ONLY the following JSON structure with no additional text:

{{
  "title": "video title here",
  "description": "brief description of the video",
  "duration": {duration_json_val},
  "language": "{language}",
  "visual_style": {{
    "visual_style": "{video_style}",
    "color_style": "natural cinematic",
    "camera_style": "professional film camera",
    "character_consistency": "consistent visual treatment across all scenes",
    "environment_style": "immersive, detailed environments"
  }},
  "scenes": [
    {{
      "scene_number": 1,
      "start_time": "00:00",
      "end_time": "00:06",
      "duration": 6,
      "narration": "Natural narration for this scene in {language}",
      "image_prompt": "Cinematic image prompt in English. Style: {image_style}. No text or watermarks.",
      "video_prompt": "Cinematic video motion prompt in English. Style: {video_style}.",
      "visual_description": "Brief description of what appears in this scene visually."
    }}
  ]
}}
{scenes_spec_bottom}"""


def _calculate_scene_distribution(duration: int) -> str:
    """Calculate a natural scene breakdown where each scene is max 6 seconds."""
    import math
    n_scenes = math.ceil(duration / 6.0)

    base = duration // n_scenes
    remainder = duration % n_scenes
    parts = [base] * n_scenes
    for i in range(remainder):
        parts[i] += 1

    return " + ".join(str(p) for p in parts) + f" = {duration}s ({n_scenes} scenes)"


def _extract_json(text: str) -> dict:
    """Extract JSON from a string, handling code fences and extra text."""
    # Remove markdown code fences
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    text = text.strip()

    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON object boundaries
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not extract valid JSON from response: {text[:200]}")


class ScriptService:
    """Handles all AI script generation using the multi-director pipeline."""

    def __init__(self) -> None:
        self.client = Groq(api_key=settings.groq_api_key)
        self.model = settings.groq_model
        self.max_retries = settings.groq_max_retries

    async def generate_script(
        self,
        project_id: str,
        prompt: str,
        duration: int,
        language: str = "en",
        video_style: str = "cinematic documentary",
        image_style: str = "cinematic realistic",
        aspect_ratio: str = "16:9",
    ) -> ScriptSchema:
        """
        Generate and validate a complete script using the Groq API.
        Retries up to max_retries times if validation fails.
        """
        logger.info(
            "script_generation_started",
            project_id=project_id,
            prompt=prompt[:80],
            duration=duration,
        )

        last_error: Exception | None = None

        # Check if project has a reference image
        from app.core.storage import storage
        ref_image_path = f"{project_id}/reference_image.png"
        has_ref = await storage.file_exists(ref_image_path)

        for attempt in range(1, self.max_retries + 1):
            try:
                logger.info("groq_attempt", project_id=project_id, attempt=attempt)

                raw_response = await self._call_groq(
                    prompt=prompt,
                    duration=duration,
                    language=language,
                    video_style=video_style,
                    image_style=image_style,
                    aspect_ratio=aspect_ratio,
                    has_ref_image=has_ref,
                    attempt=attempt,
                    previous_error=str(last_error) if last_error else None,
                )

                script_data = _extract_json(raw_response)
                script = ScriptSchema.model_validate(script_data)

                logger.info(
                    "script_generation_completed",
                    project_id=project_id,
                    title=script.title,
                    scene_count=len(script.scenes),
                    total_duration=sum(s.duration for s in script.scenes),
                )

                return script

            except (ValidationError, ValueError, json.JSONDecodeError) as e:
                last_error = e
                logger.warning(
                    "script_validation_failed",
                    project_id=project_id,
                    attempt=attempt,
                    error=str(e),
                )
                if attempt < self.max_retries:
                    import asyncio
                    await asyncio.sleep(1)
            except Exception as e:
                last_error = e
                logger.error(
                    "script_generation_error",
                    project_id=project_id,
                    attempt=attempt,
                    error=str(e),
                )
                if attempt < self.max_retries:
                    import asyncio
                    wait_time = 3 * attempt
                    logger.info("waiting_before_retry", project_id=project_id, wait_time=wait_time)
                    await asyncio.sleep(wait_time)

        raise RuntimeError(
            f"Script generation failed after {self.max_retries} attempts. "
            f"Last error: {last_error}"
        )

    async def _call_groq(
        self,
        prompt: str,
        duration: int,
        language: str,
        video_style: str,
        image_style: str,
        aspect_ratio: str,
        has_ref_image: bool = False,
        attempt: int = 1,
        previous_error: str | None = None,
    ) -> str:
        """Call the Groq API and return the raw text response."""
        user_prompt = _build_user_prompt(
            prompt=prompt,
            duration=duration,
            language=language,
            video_style=video_style,
            image_style=image_style,
            aspect_ratio=aspect_ratio,
            has_ref_image=has_ref_image,
        )

        if previous_error and attempt > 1:
            user_prompt += f"""

IMPORTANT: The previous attempt failed validation with this error:
{previous_error}

Please fix the issue and return a perfectly valid JSON response this time."""

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=settings.groq_temperature,
            max_tokens=settings.groq_max_tokens,
            response_format={"type": "json_object"},
        )

        return response.choices[0].message.content or ""

    async def regenerate_scene_prompts(
        self,
        project_id: str,
        scene_number: int,
        narration: str,
        visual_style: dict,
        duration: int,
    ) -> dict[str, str]:
        """Regenerate image/video prompts for a single scene."""
        logger.info(
            "scene_prompt_regeneration",
            project_id=project_id,
            scene_number=scene_number,
        )

        user_prompt = f"""Generate new image and video prompts for this scene.

Scene number: {scene_number}
Scene duration: {duration} seconds
Narration: {narration}
Visual style: {json.dumps(visual_style, indent=2)}

Return ONLY this JSON:
{{
  "image_prompt": "highly detailed cinematic image prompt",
  "video_prompt": "cinematic video motion prompt for {duration}s",
  "visual_description": "brief description of what appears visually"
}}"""

        for attempt in range(1, self.max_retries + 1):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.8,
                    max_tokens=1024,
                    response_format={"type": "json_object"},
                )

                raw = response.choices[0].message.content or ""
                data = _extract_json(raw)

                required_keys = {"image_prompt", "video_prompt", "visual_description"}
                if not required_keys.issubset(data.keys()):
                    raise ValueError(f"Missing keys: {required_keys - data.keys()}")

                return data

            except Exception as e:
                logger.warning(
                    "scene_prompt_regen_failed",
                    scene_number=scene_number,
                    attempt=attempt,
                    error=str(e),
                )
                if attempt == self.max_retries:
                    raise

        raise RuntimeError("Scene prompt regeneration failed")
