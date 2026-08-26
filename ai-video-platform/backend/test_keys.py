import os
import requests
from dotenv import load_dotenv

# Load env variables from .env file
load_dotenv()

groq_key = os.getenv("GROQ_API_KEY")
eleven_key = os.getenv("ELEVENLABS_API_KEY")

print("=== API KEYS DIAGNOSTIC ===")
print(f"Loaded GROQ_API_KEY: {groq_key[:10]}... (len: {len(groq_key) if groq_key else 0})")
print(f"Loaded ELEVENLABS_API_KEY: {eleven_key[:10]}... (len: {len(eleven_key) if eleven_key else 0})")
print("-" * 30)

# 1. Test Groq
print("Testing Groq API...")
if not groq_key or "xxxx" in groq_key:
    print("[FAIL] Groq key is empty or a placeholder!")
else:
    try:
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {groq_key}",
            "Content-Type": "application/json"
        }
        data = {
            "model": os.getenv("GROQ_MODEL", "groq/compound-mini"),
            "messages": [{"role": "user", "content": "Hello"}],
            "max_tokens": 10
        }
        resp = requests.post(url, headers=headers, json=data, timeout=10)
        if resp.status_code == 200:
            print("[SUCCESS] Groq API Key is VALID!")
        else:
            print(f"[FAIL] Groq API Key is INVALID! Status: {resp.status_code}")
            print(f"Response: {resp.text}")
    except Exception as e:
        print(f"[FAIL] Groq test failed: {e}")

print("-" * 30)

# 2. Test ElevenLabs
print("Testing ElevenLabs API...")
if not eleven_key or "xxxx" in eleven_key:
    print("[FAIL] ElevenLabs key is empty or a placeholder!")
else:
    try:
        url = "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM"
        headers = {
            "xi-api-key": eleven_key,
            "Content-Type": "application/json"
        }
        data = {
            "text": "test",
            "model_id": os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")
        }
        resp = requests.post(url, headers=headers, json=data, timeout=10)
        if resp.status_code == 200:
            print("[SUCCESS] ElevenLabs API Key is VALID!")
        else:
            print(f"[FAIL] ElevenLabs API Key is INVALID! Status: {resp.status_code}")
            print(f"Response: {resp.text}")
    except Exception as e:
        print(f"[FAIL] ElevenLabs test failed: {e}")

print("==========================")
