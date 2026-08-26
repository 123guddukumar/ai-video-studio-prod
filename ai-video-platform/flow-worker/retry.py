"""
Retry utilities with exponential backoff and structured error reporting.
"""
import asyncio
import functools
import traceback
from typing import Any, Callable, TypeVar

from logging_setup import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


class FlowAutomationError(Exception):
    """Raised when the Google Flow automation encounters an unrecoverable error."""

    def __init__(
        self,
        message: str,
        scene_number: int | None = None,
        operation: str | None = None,
        screenshot_path: str | None = None,
    ) -> None:
        super().__init__(message)
        self.scene_number = scene_number
        self.operation = operation
        self.screenshot_path = screenshot_path
        self.error_code = "FLOW_AUTOMATION_ERROR"

    def to_dict(self) -> dict:
        return {
            "error_code": self.error_code,
            "message": str(self),
            "scene_number": self.scene_number,
            "operation": self.operation,
            "screenshot_path": self.screenshot_path,
        }


async def retry_async(
    func: Callable,
    *args,
    max_attempts: int = 3,
    delay_seconds: float = 2.0,
    backoff_factor: float = 2.0,
    operation_name: str = "operation",
    scene_number: int | None = None,
    **kwargs,
) -> Any:
    """
    Retry an async function with exponential backoff.

    On all attempts failing:
        Raises FlowAutomationError with context.
    """
    last_exc: Exception | None = None
    delay = delay_seconds

    # If scene_number is captured by this function's parameters, inject it back
    # into kwargs so the underlying target function receives it.
    if scene_number is not None and "scene_number" not in kwargs:
        kwargs["scene_number"] = scene_number

    for attempt in range(1, max_attempts + 1):
        try:
            logger.info(
                "retry_attempt",
                operation=operation_name,
                attempt=attempt,
                max_attempts=max_attempts,
            )
            return await func(*args, **kwargs)

        except FlowAutomationError:
            raise  # Don't retry unrecoverable errors

        except Exception as exc:
            last_exc = exc
            logger.warning(
                "retry_attempt_failed",
                operation=operation_name,
                attempt=attempt,
                error=str(exc),
                traceback=traceback.format_exc(),
            )

            if attempt < max_attempts:
                logger.info("retry_waiting", delay_seconds=delay)
                await asyncio.sleep(delay)
                delay *= backoff_factor
            else:
                logger.error(
                    "retry_exhausted",
                    operation=operation_name,
                    max_attempts=max_attempts,
                    last_error=str(exc),
                )

    raise FlowAutomationError(
        message=f"{operation_name} failed after {max_attempts} attempts: {last_exc}",
        scene_number=scene_number,
        operation=operation_name,
    )


class SceneResult:
    """Result of processing a single scene."""

    def __init__(
        self,
        scene_number: int,
        success: bool,
        image_path: str | None = None,
        video_path: str | None = None,
        error: str | None = None,
        error_code: str | None = None,
        screenshot_path: str | None = None,
    ) -> None:
        self.scene_number = scene_number
        self.success = success
        self.image_path = image_path
        self.video_path = video_path
        self.error = error
        self.error_code = error_code
        self.screenshot_path = screenshot_path

    def to_dict(self) -> dict:
        return {
            "scene_number": self.scene_number,
            "success": self.success,
            "image_path": self.image_path,
            "video_path": self.video_path,
            "error": self.error,
            "error_code": self.error_code,
            "screenshot_path": self.screenshot_path,
        }
