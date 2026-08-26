import sys
from app.workers.script_tasks import generate_script_task

if __name__ == "__main__":
    project_id = "f1127928-b8e4-4189-a573-45814ef0a013"
    job_id = "be2f6349-418d-4050-b8e4-fbca5b55aa83"
    print(f"Triggering generate_script_task for project={project_id}, job={job_id}...")
    generate_script_task.delay(project_id, job_id)
    print("Task triggered successfully!")
