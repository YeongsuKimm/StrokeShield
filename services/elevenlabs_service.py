# OWNER: Speech dev (STT) / Agent dev (signed URL). Spec: docs/spec/03-speech.md, 04-voice-agent.md
# TODO: transcribe(wav_bytes) -> {text, words:[{text,start,end}]} via ElevenLabs Scribe (ELEVENLABS_STT_MODEL),
#       get_signed_url() for the conversational agent (ELEVENLABS_AGENT_ID).
# Check the current ElevenLabs SDK docs for exact method names and response fields.
"""Small server-side wrappers for ElevenLabs APIs."""

import os

import httpx


class ElevenLabsConfigurationError(RuntimeError):
	"""Raised when the agent cannot be configured safely."""


class ElevenLabsAPIError(RuntimeError):
	"""Raised when ElevenLabs rejects a request."""


async def get_signed_url() -> str:
	api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
	agent_id = os.getenv("ELEVENLABS_AGENT_ID", "").strip()
	if not api_key or not agent_id:
		raise ElevenLabsConfigurationError("ElevenLabs agent is not configured")

	try:
		async with httpx.AsyncClient(timeout=10.0) as client:
			response = await client.get(
				"https://api.elevenlabs.io/v1/convai/conversation/get-signed-url",
				params={"agent_id": agent_id},
				headers={"xi-api-key": api_key},
			)
	except httpx.HTTPError as exc:
		raise ElevenLabsAPIError("Could not reach ElevenLabs") from exc

	if response.status_code >= 400:
		raise ElevenLabsAPIError("ElevenLabs rejected the signed URL request")
	try:
		payload = response.json()
	except ValueError as exc:
		raise ElevenLabsAPIError("ElevenLabs returned an invalid response") from exc
	signed_url = payload.get("signed_url") if isinstance(payload, dict) else None
	if not isinstance(signed_url, str) or not signed_url:
		raise ElevenLabsAPIError("ElevenLabs returned no signed URL")
	return signed_url
