"""
UI selectors for Google Flow (Veo).

IMPORTANT: These selectors are based on the current Google Flow / Veo UI.
They MUST be updated if Google changes their interface.
Centralizing them here makes maintenance easy — only this file needs updating.

The user confirmed they will provide/tune the selectors after the skeleton is built.
Each selector has a descriptive comment explaining what it targets.
"""

# ── Navigation ──────────────────────────────────────────────────────────────
# URL of Google Flow
FLOW_URL = "https://labs.google/fx/tools/flow"

# The main page title or element to confirm you're on the right page
PAGE_LOADED_INDICATOR = "text=Flow"

# The "Create" or "New project" button on the main Flow interface
CREATE_NEW_BUTTON = "button:has-text('New project')"

# ── General Editor ───────────────────────────────────────────────────────────
# The unified text box for image/video prompts in the project canvas
PROMPT_TEXTBOX = "div[role='textbox'], div[data-slate-editor='true']"

# Unified Generate button (has arrow_forward icon or Create text)
GENERATE_BUTTON = "button:has(i:has-text('arrow_forward')), button:has-text('Create')"

# Mode select buttons
IMAGE_MODE_BUTTON = "button:has-text('Image')"
VIDEO_MODE_BUTTON = "button:has-text('Video')"

# Aspect ratio selector button (contains the crop icon or model configurations)
ASPECT_RATIO_BUTTON = "button:has(i:has-text('crop_')), button[id^='radix-']:has(i)"

# ── Image Generation ─────────────────────────────────────────────────────────
# The text input area for image prompts
IMAGE_PROMPT_INPUT = "div[role='textbox'], div[data-slate-editor='true']"

# The "Generate" button for images
IMAGE_GENERATE_BUTTON = "button:has(i:has-text('arrow_forward')), button:has-text('Create')"

# Loading/progress indicator while image is being generated
IMAGE_LOADING_INDICATOR = "[data-testid='loading'], .loading-spinner, [aria-label*='generating']"

# The generated image container
IMAGE_RESULT_CONTAINER = "[data-testid='image-result'], img[src], .generated-image, img[alt*='generated']"

# The download button for images
IMAGE_DOWNLOAD_BUTTON = "button[aria-label*='Download'], button:has-text('Download'), i:has-text('download')"

# ── Video Generation ─────────────────────────────────────────────────────────
# The text input area for video/motion prompts
VIDEO_PROMPT_INPUT = "div[role='textbox'], div[data-slate-editor='true']"

# The "Generate video" button
VIDEO_GENERATE_BUTTON = "button:has(i:has-text('arrow_forward')), button:has-text('Create')"

# Loading indicator while video is generating (can take 2-5 minutes)
VIDEO_LOADING_INDICATOR = "[data-testid='video-loading'], .video-generating"

# The generated video element
VIDEO_RESULT_CONTAINER = "video[src], [data-testid='video-result']"

# The video download button
VIDEO_DOWNLOAD_BUTTON = "button[aria-label*='Download video'], button[aria-label*='Download'], a[download], i:has-text('download')"

# ── Error states ─────────────────────────────────────────────────────────────
# Error message container
ERROR_MESSAGE = "[data-testid='error'], .error-message, [role='alert']"

# Session expired / login required
SESSION_EXPIRED = "text=Sign in, text=Log in, button:has-text('Sign in')"

# ── Auth verification ────────────────────────────────────────────────────────
# Element that only appears when logged in
AUTH_INDICATOR = "[data-testid='user-avatar'], [aria-label*='Account'], img[alt*='profile'], button:has-text('New project')"

# ── Timeouts (milliseconds) ──────────────────────────────────────────────────
PAGE_LOAD_TIMEOUT = 30_000
IMAGE_GENERATION_TIMEOUT = 120_000   # 2 minutes max for image
VIDEO_GENERATION_TIMEOUT = 360_000   # 6 minutes max for video
ELEMENT_VISIBLE_TIMEOUT = 15_000
DOWNLOAD_TIMEOUT = 60_000
