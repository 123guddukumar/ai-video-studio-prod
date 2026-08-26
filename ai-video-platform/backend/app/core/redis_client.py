"""
Redis client singleton.
"""
import redis.asyncio as aioredis
from redis.asyncio import Redis

from app.core.config import settings

_redis_client: Redis | None = None


async def get_redis() -> Redis:
    """Return the singleton async Redis client."""
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


async def close_redis() -> None:
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
