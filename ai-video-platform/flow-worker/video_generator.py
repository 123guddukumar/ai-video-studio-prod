"""
Video generator — automates Google Flow's video/animation generation UI.
"""
import asyncio
from pathlib import Path

from playwright.async_api import Page

import flow_selectors as S
from downloader import Downloader
from retry import FlowAutomationError, retry_async
from logging_setup import get_logger

logger = get_logger(__name__)


class VideoGenerator:
    """Generates videos via Google Flow's browser UI (image-to-video / Veo)."""

    def __init__(self, page: Page, downloader: "Downloader") -> None:
        self.page = page
        self.downloader = downloader

    async def generate(
        self,
        project_id: str,
        scene_number: int,
        video_prompt: str,
        duration: int,
        output_path: Path,
        reference_image_path: Path | None = None,
        aspect_ratio: str = "16:9",
    ) -> bool:
        """
        Generate a video for the given prompt.
        Optionally uses a reference image (from the image generation step).
        """
        logger.info(
            "video_generation_started",
            project_id=project_id,
            scene_number=scene_number,
            prompt=video_prompt[:80],
            duration=duration,
            aspect_ratio=aspect_ratio,
        )

        try:
            return await retry_async(
                self._generate_attempt,
                project_id=project_id,
                scene_number=scene_number,
                video_prompt=video_prompt,
                duration=duration,
                output_path=output_path,
                reference_image_path=reference_image_path,
                aspect_ratio=aspect_ratio,
                max_attempts=3,
                delay_seconds=10.0,
                operation_name=f"video_generation_scene_{scene_number}",
            )
        except FlowAutomationError as e:
            logger.error(
                "video_generation_failed",
                project_id=project_id,
                scene_number=scene_number,
                error=str(e),
            )
            return False

    async def _generate_attempt(
        self,
        project_id: str,
        scene_number: int,
        video_prompt: str,
        duration: int,
        output_path: Path,
        reference_image_path: Path | None = None,
        aspect_ratio: str = "16:9",
    ) -> bool:
        """One attempt at generating a video."""

        # ── Step 1: Navigate to 'New project' if needed ──────────────────────
        try:
            # If the "New project" button is visible, we're not inside canvas yet
            new_project_btn = await self.page.wait_for_selector(S.CREATE_NEW_BUTTON, timeout=4000)
            if new_project_btn:
                logger.info("[FLOW] Clicking 'New project' button for video generation", scene=scene_number)
                await new_project_btn.click()
                await asyncio.sleep(2.0)
        except Exception:
            # Already inside a project/canvas
            pass

        # ── Step 2: Switch to 'Video' or 'Animate' mode ──────────────────────
        animated_mode = False
        if reference_image_path:
            logger.info("[FLOW] Attempting to click 'Animate' on generated image", scene=scene_number)
            try:
                # Find and click 'Animate' button (or icon)
                animate_btn = await self.page.wait_for_selector(
                    "button:has-text('Animate'), button[aria-label*='Animate'], [data-testid='animate-button']",
                    timeout=4000
                )
                await animate_btn.click()
                animated_mode = True
                logger.info("[FLOW] Clicked 'Animate' on image", scene=scene_number)
                await asyncio.sleep(1.0)
            except Exception as e:
                logger.info(f"[FLOW] Direct 'Animate' button not found: {e}. Switching mode manually.")

        if not animated_mode:
            logger.info("[FLOW] Selecting Video mode manually", scene=scene_number)
            try:
                video_mode_btn = await self.page.wait_for_selector(S.VIDEO_MODE_BUTTON, timeout=3000)
                await video_mode_btn.click()
            except Exception:
                # Fallback: Click 'Create' dropdown and select 'Video'
                try:
                    create_btn = await self.page.wait_for_selector("button:has-text('Create')", timeout=2000)
                    await create_btn.click()
                    await asyncio.sleep(0.5)
                    video_opt = await self.page.wait_for_selector("[role='menuitem']:has-text('Video'), button:has-text('Video')", timeout=2000)
                    await video_opt.click()
                except Exception as e:
                    logger.warning(f"[FLOW] Could not select Video mode: {e}")

        # ── Step 3: Enter video/motion prompt ────────────────────────────────
        logger.info("[FLOW] Entering video prompt", scene=scene_number)
        try:
            prompt_input = await self.page.wait_for_selector(
                S.PROMPT_TEXTBOX,
                timeout=S.ELEMENT_VISIBLE_TIMEOUT,
            )
            await prompt_input.click()
            # Clear text box
            await self.page.keyboard.press("Control+A")
            await self.page.keyboard.press("Backspace")
            await prompt_input.fill("")
            await prompt_input.type(video_prompt, delay=30)
        except Exception as e:
            screenshot = await self._screenshot(project_id, f"scene_{scene_number}_video_prompt_error")
            raise FlowAutomationError(
                f"Could not enter video prompt: {e}",
                scene_number=scene_number,
                operation="enter_video_prompt",
                screenshot_path=screenshot,
            )

        # ── Step 4: Select aspect ratio ──────────────────────────────────────
        logger.info(f"[FLOW] Selecting aspect ratio: {aspect_ratio}", scene=scene_number)
        try:
            ratio_btn = None
            for icon in ["crop_16_9", "crop_portrait", "crop_square"]:
                try:
                    ratio_btn = await self.page.wait_for_selector(f"button:has(i:has-text('{icon}'))", timeout=2000)
                    if ratio_btn:
                        break
                except Exception:
                    pass
            
            if not ratio_btn:
                ratio_btn = await self.page.wait_for_selector(S.ASPECT_RATIO_BUTTON, timeout=2000)
                
            if ratio_btn:
                await ratio_btn.click()
                await asyncio.sleep(1.0)
                
                target_option = None
                if aspect_ratio == "16:9":
                    selectors = ["[role='menuitem'] :text('16:9')", "text=16:9", "[role='menuitem']:has-text('crop_16_9')", "button:has-text('16:9')"]
                elif aspect_ratio == "9:16":
                    selectors = ["[role='menuitem'] :text('9:16')", "text=9:16", "[role='menuitem']:has-text('crop_portrait')", "button:has-text('9:16')"]
                else:  # 1:1
                    selectors = ["[role='menuitem'] :text('1:1')", "text=1:1", "[role='menuitem']:has-text('crop_square')", "button:has-text('1:1')"]
                    
                for sel in selectors:
                    try:
                        target_option = await self.page.wait_for_selector(sel, timeout=2000)
                        if target_option:
                            await target_option.click()
                            logger.info(f"[FLOW] Selected ratio {aspect_ratio} via selector: {sel}")
                            break
                    except Exception:
                        pass
                
                if not target_option:
                    logger.warning(f"[FLOW] Option for ratio {aspect_ratio} not clicked, attempting fallback")
                    await self.page.click(f"text={aspect_ratio}", timeout=2000)
            else:
                logger.warning("[FLOW] Aspect ratio button not found")
        except Exception as e:
            logger.warning(f"[FLOW] Failed to select aspect ratio: {e}")

        # ── Step 5: Select duration ──────────────────────────────────────────
        logger.info(f"[FLOW] Selecting duration: {duration}s", scene=scene_number)
        try:
            duration_str = f"{duration}s"
            duration_btn = None
            try:
                duration_btn = await self.page.wait_for_selector(f"button:has-text('{duration_str}')", timeout=3000)
                if duration_btn:
                    await duration_btn.click()
                    logger.info(f"[FLOW] Clicked duration button: {duration_str}")
            except Exception:
                pass
                
            if not duration_btn:
                try:
                    duration_btn = await self.page.wait_for_selector("button:has-text('s')", timeout=2000)
                    await duration_btn.click()
                    await asyncio.sleep(0.5)
                    await self.page.click(f"[role='menuitem']:has-text('{duration_str}'), button:has-text('{duration_str}')")
                    logger.info(f"[FLOW] Selected video duration: {duration_str} via menu")
                except Exception as e:
                    logger.warning(f"[FLOW] Could not find duration settings toggle: {e}")
        except Exception as e:
            logger.warning(f"[FLOW] Failed to select video duration: {e}")

        # ── Step 6: Click generate video ──────────────────────────────────────
        logger.info("[FLOW] Clicking generate button", scene=scene_number)
        try:
            generate_btn = await self.page.wait_for_selector(
                S.GENERATE_BUTTON,
                timeout=S.ELEMENT_VISIBLE_TIMEOUT,
            )
            await generate_btn.click()
        except Exception as e:
            screenshot = await self._screenshot(project_id, f"scene_{scene_number}_video_gen_btn_error")
            raise FlowAutomationError(
                f"Could not find generate video button: {e}",
                scene_number=scene_number,
                operation="click_video_generate",
                screenshot_path=screenshot,
            )

        # ── Step 7: Wait for video generation ────────────────────────────────
        # Videos take much longer than images (2-6 minutes)
        logger.info(
            "[FLOW] Waiting for video generation (this may take several minutes)...",
            scene=scene_number,
        )
        try:
            await self.page.wait_for_selector(
                S.VIDEO_LOADING_INDICATOR,
                state="hidden",
                timeout=S.VIDEO_GENERATION_TIMEOUT,
            )
        except Exception:
            pass

        try:
            await self.page.wait_for_selector(
                S.VIDEO_RESULT_CONTAINER,
                timeout=S.VIDEO_GENERATION_TIMEOUT,
            )
            logger.info("[FLOW] Video generation completed", scene=scene_number)
        except Exception as e:
            screenshot = await self._screenshot(project_id, f"scene_{scene_number}_video_timeout")
            raise FlowAutomationError(
                f"Video generation timed out: {e}",
                scene_number=scene_number,
                operation="wait_for_video",
                screenshot_path=screenshot,
            )

        # ── Step 8: Download video ────────────────────────────────────────────
        downloaded = await self.downloader.download_video(
            page=self.page,
            output_path=output_path,
            project_id=project_id,
            scene_number=scene_number,
        )

        if not downloaded:
            screenshot = await self._screenshot(project_id, f"scene_{scene_number}_video_download_failed")
            raise FlowAutomationError(
                "Video download failed",
                scene_number=scene_number,
                operation="download_video",
                screenshot_path=screenshot,
            )

        logger.info("[FLOW] Video saved", scene=scene_number, path=str(output_path))
        return True

    async def _screenshot(self, project_id: str, name: str) -> str:
        from browser import browser_manager
        return await browser_manager.take_screenshot(name, project_id, page=self.page)
