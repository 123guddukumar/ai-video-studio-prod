"""
Image generator — automates Google Flow's image generation UI.
"""
import asyncio
from pathlib import Path

from playwright.async_api import Page

import flow_selectors as S
from downloader import Downloader
from retry import FlowAutomationError, retry_async
from logging_setup import get_logger

logger = get_logger(__name__)


class ImageGenerator:
    """Generates images via Google Flow's browser UI."""

    def __init__(self, page: Page, downloader: "Downloader") -> None:
        self.page = page
        self.downloader = downloader

    async def generate(
        self,
        project_id: str,
        scene_number: int,
        image_prompt: str,
        output_path: Path,
        aspect_ratio: str = "16:9",
    ) -> bool:
        """
        Generate an image for the given prompt and save it to output_path.

        Returns True on success, False on failure (with screenshot saved).
        """
        logger.info(
            "image_generation_started",
            project_id=project_id,
            scene_number=scene_number,
            prompt=image_prompt[:80],
            aspect_ratio=aspect_ratio,
        )

        try:
            return await retry_async(
                self._generate_attempt,
                project_id=project_id,
                scene_number=scene_number,
                image_prompt=image_prompt,
                output_path=output_path,
                aspect_ratio=aspect_ratio,
                max_attempts=3,
                delay_seconds=5.0,
                operation_name=f"image_generation_scene_{scene_number}",
            )
        except FlowAutomationError as e:
            logger.error(
                "image_generation_failed",
                project_id=project_id,
                scene_number=scene_number,
                error=str(e),
            )
            return False

    async def _generate_attempt(
        self,
        project_id: str,
        scene_number: int,
        image_prompt: str,
        output_path: Path,
        aspect_ratio: str = "16:9",
    ) -> bool:
        """One attempt at generating an image."""

        # ── Step 1: Navigate to 'New project' and go to canvas ────────────────
        logger.info("[FLOW] Opening project canvas", scene=scene_number)
        
        try:
            # If the "New project" button is visible, click it to open a new canvas
            new_project_btn = await self.page.wait_for_selector(S.CREATE_NEW_BUTTON, timeout=4000)
            if new_project_btn:
                logger.info("[FLOW] Clicking 'New project' button", scene=scene_number)
                await new_project_btn.click()
                await asyncio.sleep(2.0)
        except Exception:
            # Button not found/already on canvas, proceed
            pass

        # ── Step 2: Select 'Image' generation mode ───────────────────────────
        logger.info("[FLOW] Selecting Image mode", scene=scene_number)
        try:
            # Try to select the 'Image' mode tab directly
            image_mode_btn = await self.page.wait_for_selector(S.IMAGE_MODE_BUTTON, timeout=3000)
            await image_mode_btn.click()
        except Exception:
            # Fallback: Click 'Create' dropdown and select 'Image'
            try:
                create_btn = await self.page.wait_for_selector("button:has-text('Create')", timeout=2000)
                await create_btn.click()
                await asyncio.sleep(0.5)
                image_opt = await self.page.wait_for_selector("[role='menuitem']:has-text('Image'), button:has-text('Image')", timeout=2000)
                await image_opt.click()
            except Exception as e:
                logger.warning(f"[FLOW] Could not click Image mode button: {e}")

        # ── Step 3: Enter prompt ─────────────────────────────────────────────
        try:
            prompt_input = await self.page.wait_for_selector(
                S.PROMPT_TEXTBOX,
                timeout=S.ELEMENT_VISIBLE_TIMEOUT,
            )
            await prompt_input.click()
            # Clear input
            await self.page.keyboard.press("Control+A")
            await self.page.keyboard.press("Backspace")
            await prompt_input.fill("")
            await prompt_input.type(image_prompt, delay=30)
            logger.info("[FLOW] Image prompt entered", scene=scene_number)
        except Exception as e:
            screenshot = await self._screenshot(project_id, f"scene_{scene_number}_prompt_input_error")
            raise FlowAutomationError(
                f"Could not enter prompt in textbox: {e}",
                scene_number=scene_number,
                operation="enter_prompt",
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

        # ── Step 5: Click generate ────────────────────────────────────────────
        try:
            generate_btn = await self.page.wait_for_selector(
                S.GENERATE_BUTTON,
                timeout=S.ELEMENT_VISIBLE_TIMEOUT,
            )
            await generate_btn.click()
            logger.info("[FLOW] Generate button clicked", scene=scene_number)
        except Exception as e:
            screenshot = await self._screenshot(project_id, f"scene_{scene_number}_generate_btn_error")
            raise FlowAutomationError(
                f"Could not find generate button: {e}",
                scene_number=scene_number,
                operation="click_generate",
                screenshot_path=screenshot,
            )

        # ── Step 6: Wait for generation ───────────────────────────────────────
        logger.info("[FLOW] Waiting for image generation...", scene=scene_number)
        try:
            # Wait for loading indicator to disappear
            await self.page.wait_for_selector(
                S.IMAGE_LOADING_INDICATOR,
                state="hidden",
                timeout=S.IMAGE_GENERATION_TIMEOUT,
            )
        except Exception:
            pass  # Loading indicator may not be found in all cases

        # Wait for result container
        try:
            await self.page.wait_for_selector(
                S.IMAGE_RESULT_CONTAINER,
                timeout=S.IMAGE_GENERATION_TIMEOUT,
            )
            logger.info("[FLOW] Image generation completed", scene=scene_number)
        except Exception as e:
            screenshot = await self._screenshot(project_id, f"scene_{scene_number}_generation_timeout")
            raise FlowAutomationError(
                f"Image generation timed out or result not found: {e}",
                scene_number=scene_number,
                operation="wait_for_result",
                screenshot_path=screenshot,
            )

        # ── Step 7: Download ──────────────────────────────────────────────────
        downloaded = await self.downloader.download_image(
            page=self.page,
            output_path=output_path,
            project_id=project_id,
            scene_number=scene_number,
        )

        if not downloaded:
            screenshot = await self._screenshot(project_id, f"scene_{scene_number}_download_failed")
            raise FlowAutomationError(
                "Image download failed",
                scene_number=scene_number,
                operation="download",
                screenshot_path=screenshot,
            )

        logger.info(
            "[FLOW] Image saved",
            scene=scene_number,
            path=str(output_path),
        )
        return True

    async def _screenshot(self, project_id: str, name: str) -> str:
        from browser import browser_manager
        return await browser_manager.take_screenshot(name, project_id, page=self.page)
