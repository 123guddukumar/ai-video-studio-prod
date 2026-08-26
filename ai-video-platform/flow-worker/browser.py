"""
Browser manager — launches and manages a persistent Chromium profile.

Uses Playwright's persistent context so the user's Google Flow login session
is maintained between runs.
"""
import asyncio
from pathlib import Path
from typing import Optional

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    async_playwright,
)

from flow_selectors import AUTH_INDICATOR, FLOW_URL, PAGE_LOAD_TIMEOUT, SESSION_EXPIRED
from logging_setup import get_logger

logger = get_logger(__name__)

CHROME_PROFILE_PATH = Path("/app/chrome-profile")


class BrowserManager:
    """Manages a single persistent Chromium browser context."""

    def __init__(self) -> None:
        self._playwright: Optional[Playwright] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None

    async def start(self) -> None:
        """Launch Playwright and open a persistent browser context."""
        if self._page is not None:
            logger.info("browser_already_running")
            return

        CHROME_PROFILE_PATH.mkdir(parents=True, exist_ok=True)

        # Clear stale SingletonLock link left by crashed/restarted containers
        lock_file = CHROME_PROFILE_PATH / "SingletonLock"
        if lock_file.is_symlink() or lock_file.exists():
            try:
                lock_file.unlink(missing_ok=True)
                logger.info("Removed stale chrome SingletonLock")
            except Exception as e:
                logger.warning("Could not remove SingletonLock", error=str(e))

        self._playwright = await async_playwright().start()

        self._context = await self._playwright.chromium.launch_persistent_context(
            user_data_dir=str(CHROME_PROFILE_PATH),
            headless=True,  # Set to False for debugging with a visible browser
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-web-security",
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-gpu",
                "--disable-software-rasterizer",
            ],
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
            timezone_id="America/New_York",
        )

        self._page = await self._context.new_page()

        # Enable console logging
        self._page.on("console", lambda msg: logger.debug("browser_console", text=msg.text))
        self._page.on("pageerror", lambda exc: logger.error("browser_page_error", error=str(exc)))

        logger.info("browser_started", profile_path=str(CHROME_PROFILE_PATH))

    async def stop(self) -> None:
        if self._context:
            await self._context.close()
            self._context = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
        self._page = None
        logger.info("browser_stopped")

    @property
    def page(self) -> Page:
        if not self._page:
            raise RuntimeError("Browser not started. Call start() first.")
        return self._page

    @property
    def context(self) -> BrowserContext:
        if not self._context:
            raise RuntimeError("Browser not started. Call start() first.")
        return self._context

    async def navigate_to_flow(self) -> bool:
        """Navigate to Google Flow and verify the session is authenticated."""
        if not self._page:
            await self.start()
        try:
            logger.info("navigating_to_flow", url=FLOW_URL)
            await self._page.goto(FLOW_URL, wait_until="networkidle", timeout=PAGE_LOAD_TIMEOUT)

            # Check if we're on the login page
            try:
                await self._page.wait_for_selector(SESSION_EXPIRED, timeout=3000)
                logger.error("session_expired_or_not_logged_in")
                return False
            except Exception:
                pass  # Good — login page not visible

            logger.info("flow_navigation_successful")
            return True

        except Exception as e:
            logger.error("navigation_failed", error=str(e))
            await self.take_screenshot("navigation_failed")
            return False

    async def verify_authenticated(self) -> bool:
        """Return True if the Google session appears to be active."""
        if not self._page:
            return False
        try:
            await self._page.wait_for_selector(AUTH_INDICATOR, timeout=5000)
            logger.info("session_authenticated")
            return True
        except Exception:
            # Try navigating to Flow as a harder check
            return await self.navigate_to_flow()

    async def take_screenshot(self, name: str, project_id: str = "unknown", page: Optional[Page] = None) -> str:
        """Take a screenshot for debugging failed automations."""
        screenshots_dir = Path("/app/storage/projects") / project_id / "screenshots"
        screenshots_dir.mkdir(parents=True, exist_ok=True)

        target_page = page or self._page
        path = screenshots_dir / f"{name}.png"
        if target_page:
            try:
                await target_page.screenshot(path=str(path), full_page=False, timeout=5000)
                logger.info("screenshot_saved", path=str(path))
            except Exception as e:
                logger.error("screenshot_failed", error=str(e))
        return str(path)

    async def new_tab(self) -> Page:
        """Open a fresh page/tab in the persistent context."""
        page = await self._context.new_page()
        page.on("console", lambda msg: logger.debug("tab_console", text=msg.text))
        return page


# Global singleton — initialized when the worker starts
browser_manager = BrowserManager()
