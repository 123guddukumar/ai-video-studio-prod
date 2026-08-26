import asyncio
import sys
from sqlalchemy import text
from app.core.database import AsyncSessionFactory

async def check():
    async with AsyncSessionFactory() as db:
        projects = await db.execute(text("select id, title, status, progress, current_stage from projects"))
        print("PROJECTS:", projects.all())
        jobs = await db.execute(text("select id, project_id, job_type, status, celery_task_id, error_message from jobs"))
        print("JOBS:", jobs.all())

if __name__ == "__main__":
    asyncio.run(check())
