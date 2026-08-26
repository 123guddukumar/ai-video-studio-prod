"""
Celery application configuration.
"""
from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "ai_video_platform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.workers.script_tasks",
        "app.workers.asset_tasks",
        "app.workers.voice_tasks",
        "app.workers.video_tasks",
    ],
)

celery_app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    # Timezone
    timezone="UTC",
    enable_utc=True,
    # Timeouts
    task_soft_time_limit=600,   # 10 minutes soft limit
    task_time_limit=900,        # 15 minutes hard limit
    # Retry settings
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Result expiry
    result_expires=86400,       # 24 hours
    # Routing
    task_routes={
        "app.workers.script_tasks.*": {"queue": "script"},
        "app.workers.asset_tasks.*": {"queue": "assets"},
        "app.workers.voice_tasks.*": {"queue": "voice"},
        "app.workers.video_tasks.*": {"queue": "video"},
    },
    # Beat schedule (timeout detection)
    beat_schedule={
        "detect-stuck-jobs": {
            "task": "app.workers.script_tasks.detect_stuck_jobs",
            "schedule": 60.0,  # every 60 seconds
        },
    },
)
