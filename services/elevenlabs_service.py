import os
import requests
from fastapi import HTTPException

def get_signed_url() -> str:
    api_key = os.getenv("ELEVENLABS_API_KEY")
    agent_id = os.getenv("ELEVENLABS_AGENT_ID")

    if not api_key or not agent_id:
        raise Exception("ElevenLabs credentials not configured")

    url = f"https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id={agent_id}"
    headers = {"xi-api-key": api_key}

    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        raise Exception(f"Failed to get signed URL: {response.text}")

    return response.json().get("signed_url")
