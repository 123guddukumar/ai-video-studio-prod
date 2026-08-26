# AI Video Platform — Complete Setup & Usage Guide

## 🎬 AI Script-to-Video Automation Platform

A production-grade, full-stack platform that transforms a text prompt into a complete cinematic MP4 video using a multi-director AI pipeline.

### Architecture

```
User Prompt
  → Groq AI (Script)
  → Google Flow Browser Automation (Images + Videos)
  → ElevenLabs (Voice)
  → FFmpeg (Composition)
  → Final MP4
```

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Groq API key
- ElevenLabs API key
- Google account with Google Flow / Veo access (already logged in)

### 1. Clone & Configure

```bash
cd ai-video-platform
cp .env.example .env
# Edit .env — fill in GROQ_API_KEY, ELEVENLABS_API_KEY
```

### 2. Start All Services

```bash
docker compose up -d
```

Services started:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Flow Worker: http://localhost:8001
- Video Worker: http://localhost:8002

### 3. Run Database Migrations

```bash
docker compose exec backend alembic upgrade head
```

### 4. Set Up Google Flow Authentication

The flow-worker uses a persistent Chromium profile. On first run, you need to log in:

```bash
# Edit flow-worker/browser.py — set headless=False temporarily
# Restart the flow-worker
docker compose restart flow-worker

# Navigate to Google Flow in the opened browser
# Log in with your Google account
# Verify you have access to Veo (video generation)
# Close the browser — your session is saved to /app/chrome-profile
# Set headless=True again and restart
```

### 5. Update Google Flow Selectors

After inspecting the Google Flow UI, update `flow-worker/selectors.py` with the correct CSS selectors for your current Google Flow UI.

---

## 📁 Project Structure

```
ai-video-platform/
├── frontend/          # Next.js 14 + TypeScript + Tailwind
│   ├── app/
│   │   ├── dashboard/ # Stats dashboard
│   │   ├── projects/  # Project list + detail
│   │   └── projects/new/  # Create project
│   ├── components/    # Reusable UI components
│   ├── hooks/         # useWebSocket, useProject
│   ├── lib/api.ts     # API client
│   └── types/         # TypeScript interfaces
│
├── backend/           # FastAPI + SQLAlchemy + Celery
│   ├── app/
│   │   ├── api/routes/    # REST API endpoints
│   │   ├── models/        # SQLAlchemy ORM models
│   │   ├── schemas/       # Pydantic schemas
│   │   ├── services/      # Business logic
│   │   └── workers/       # Celery tasks
│   └── migrations/    # Alembic DB migrations
│
├── flow-worker/       # Playwright browser automation
│   ├── browser.py     # Persistent Chrome profile
│   ├── image_generator.py
│   ├── video_generator.py
│   ├── downloader.py
│   ├── selectors.py   # ← UPDATE THESE after inspecting Flow UI
│   └── main.py        # FastAPI server
│
├── video-worker/      # FFmpeg video composition
│   ├── ffmpeg/processor.py
│   ├── composition/composer.py
│   ├── subtitles/generator.py
│   └── main.py
│
├── docker/            # Dockerfiles
├── docker-compose.yml
└── .env.example
```

---

## 🔑 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/projects | List all projects |
| POST | /api/projects | Create project |
| GET | /api/projects/{id} | Get project details |
| DELETE | /api/projects/{id} | Delete project |
| POST | /api/projects/{id}/generate-script | Start script generation |
| POST | /api/projects/{id}/approve-script | Approve script (review mode) |
| POST | /api/projects/{id}/generate-assets | Trigger asset generation |
| POST | /api/projects/{id}/generate-voice | Generate voice |
| POST | /api/projects/{id}/render | Render final video |
| POST | /api/projects/{id}/cancel | Cancel project |
| GET | /api/projects/{id}/status | Get current status |
| PATCH | /api/scenes/{id} | Edit scene prompts |
| POST | /api/scenes/{id}/regenerate-image | Regenerate scene image |
| POST | /api/scenes/{id}/regenerate-video | Regenerate scene video |
| WS | /ws/projects/{id} | Real-time progress updates |

---

## 🏗️ Generation Pipeline

```
1. SCRIPT_GENERATION     → Groq API → validated JSON script
2. FLOW_IMAGE_GENERATION → Playwright → Google Flow → PNG per scene
3. FLOW_VIDEO_GENERATION → Playwright → Google Flow → MP4 per scene
4. ELEVENLABS_GENERATION → ElevenLabs API → narration.mp3
5. VIDEO_COMPOSITION     → FFmpeg → normalize → concat → audio → subtitles → final.mp4
6. FINALIZATION          → Update DB → notify frontend
```

---

## ⚙️ Generation Modes

| Mode | Behavior |
|------|----------|
| `fully_automatic` | Prompt → Final Video with zero interruption |
| `review_script` | Pause for script approval before assets |
| `review_assets` | Pause for asset review |
| `review_before_final` | Approve everything before final render |

---

## 🔧 Development

### Run backend locally

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Run tests

```bash
cd backend
pytest tests/ -v
```

### Run frontend locally

```bash
cd frontend
npm install
npm run dev
```

---

## 📐 Storage Structure

```
storage/projects/{project_id}/
  script.json
  scenes/
    scene_001/
      image.png
      video.mp4
  audio/
    narration.mp3
  subtitles/
    subtitles.srt
  final/
    final.mp4
```

---

## 🔒 Security Notes

- All API keys are stored server-side only — never exposed to the frontend
- Running in dev mode (single-user, no auth required)
- For production: enable auth in `backend/app/core/security.py`

---

## 🐛 Troubleshooting

### Flow worker says "session not authenticated"
→ Set `headless=False` in `browser.py`, restart flow-worker, log in manually, set back to `True`

### Selectors not found
→ Google Flow UI may have changed. Inspect the page and update `flow-worker/selectors.py`

### FFmpeg errors
→ Check that the video-worker container has FFmpeg: `docker compose exec video-worker ffmpeg -version`

### Database errors
→ Run migrations: `docker compose exec backend alembic upgrade head`
