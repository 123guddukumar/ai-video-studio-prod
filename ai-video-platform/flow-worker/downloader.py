"""
Downloader — handles asset downloads from Google Flow.

Supports both:
1. Click-to-download button approach
2. Intercept network response approach (more reliable)
"""
import asyncio
import hashlib
import shutil
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, Download

import flow_selectors as S
from logging_setup import get_logger

logger = get_logger(__name__)

MIN_IMAGE_SIZE_BYTES = 10_000    # 10KB minimum — anything smaller is likely corrupt
MIN_VIDEO_SIZE_BYTES = 100_000   # 100KB minimum


class Downloader:
    """Downloads generated assets from the browser."""

    async def download_image(
        self,
        page: Page,
        output_path: Path,
        project_id: str,
        scene_number: int,
    ) -> bool:
        """Download the generated image via the download button."""
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            # Approach 1: Click download button and intercept the download
            async with page.expect_download(timeout=S.DOWNLOAD_TIMEOUT) as dl_info:
                download_btn = await page.wait_for_selector(
                    S.IMAGE_DOWNLOAD_BUTTON,
                    timeout=S.ELEMENT_VISIBLE_TIMEOUT,
                )
                await download_btn.click()
                logger.info("[FLOW] Image download button clicked", scene=scene_number)

            download: Download = await dl_info.value
            await download.save_as(str(output_path))

            # Verify file integrity
            return self._verify_file(output_path, MIN_IMAGE_SIZE_BYTES, "image", scene_number)

        except Exception as e:
            logger.warning(
                "download_button_approach_failed",
                scene=scene_number,
                error=str(e),
            )

        # Approach 2: Try to grab image src directly
        try:
            img_element = await page.wait_for_selector(
                S.IMAGE_RESULT_CONTAINER,
                timeout=S.ELEMENT_VISIBLE_TIMEOUT,
            )
            img_src = await img_element.get_attribute("src")
            if img_src:
                # Download via CDP
                response = await page.evaluate(
                    """async (url) => {
                        const r = await fetch(url);
                        const buf = await r.arrayBuffer();
                        return Array.from(new Uint8Array(buf));
                    }""",
                    img_src,
                )
                image_bytes = bytes(response)
                output_path.write_bytes(image_bytes)
                return self._verify_file(output_path, MIN_IMAGE_SIZE_BYTES, "image", scene_number)
        except Exception as e:
            logger.error("image_download_fallback_failed", scene=scene_number, error=str(e))

        return False

    async def download_video(
        self,
        page: Page,
        output_path: Path,
        project_id: str,
        scene_number: int,
    ) -> bool:
        """Download the generated video."""
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            async with page.expect_download(timeout=S.DOWNLOAD_TIMEOUT) as dl_info:
                download_btn = await page.wait_for_selector(
                    S.VIDEO_DOWNLOAD_BUTTON,
                    timeout=S.ELEMENT_VISIBLE_TIMEOUT,
                )
                await download_btn.click()
                logger.info("[FLOW] Video download button clicked", scene=scene_number)

            download: Download = await dl_info.value
            await download.save_as(str(output_path))

            return self._verify_file(output_path, MIN_VIDEO_SIZE_BYTES, "video", scene_number)

        except Exception as e:
            logger.warning("video_download_failed", scene=scene_number, error=str(e))

        # Fallback: try to get video src and download
        try:
            video_element = await page.wait_for_selector(
                S.VIDEO_RESULT_CONTAINER,
                timeout=S.ELEMENT_VISIBLE_TIMEOUT,
            )
            video_src = await video_element.get_attribute("src")
            if video_src:
                response = await page.evaluate(
                    """async (url) => {
                        const r = await fetch(url);
                        const buf = await r.arrayBuffer();
                        return Array.from(new Uint8Array(buf));
                    }""",
                    video_src,
                )
                video_bytes = bytes(response)
                output_path.write_bytes(video_bytes)
                return self._verify_file(output_path, MIN_VIDEO_SIZE_BYTES, "video", scene_number)
        except Exception as e:
            logger.error("video_download_fallback_failed", scene=scene_number, error=str(e))

        return False

    def _verify_file(
        self, path: Path, min_size: int, file_type: str, scene_number: int
    ) -> bool:
        """Verify file exists and meets minimum size requirements."""
        if not path.exists():
            logger.error(
                "file_not_found_after_download",
                file_type=file_type,
                scene=scene_number,
                path=str(path),
            )
            return False

        file_size = path.stat().st_size
        if file_size < min_size:
            logger.error(
                "file_too_small",
                file_type=file_type,
                scene=scene_number,
                size=file_size,
                min_size=min_size,
            )
            path.unlink()  # Remove corrupt file
            return False

        md5 = self._compute_md5(path)
        logger.info(
            "file_verified",
            file_type=file_type,
            scene=scene_number,
            size=file_size,
            md5=md5,
        )
        return True

    def _compute_md5(self, path: Path) -> str:
        md5 = hashlib.md5()
        with open(path, "rb") as f:
            while chunk := f.read(8192):
                md5.update(chunk)
        return md5.hexdigest()
