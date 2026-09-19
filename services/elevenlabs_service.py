# OWNER: Speech dev (STT) / Agent dev (signed URL). Spec: docs/spec/03-speech.md, 04-voice-agent.md
# TODO: transcribe(wav_bytes) -> {text, words:[{text,start,end}]} via ElevenLabs Scribe (ELEVENLABS_STT_MODEL),
#       get_signed_url() for the conversational agent (ELEVENLABS_AGENT_ID).
# Check the current ElevenLabs SDK docs for exact method names and response fields.
"""Small server-side wrappers for ElevenLabs APIs."""

import logging
import os

import httpx

log = logging.getLogger("agent")


class ElevenLabsConfigurationError(RuntimeError):
	"""Raised when the agent cannot be configured safely."""


class ElevenLabsAPIError(RuntimeError):
	"""Raised when ElevenLabs rejects a request."""


def agent_id_for(lang: str) -> str:
	"""The agent for a UI language: the Spanish agent (ELEVENLABS_AGENT_ID_ES) for 'es', otherwise the English one."""
	name = "ELEVENLABS_AGENT_ID_ES" if lang == "es" else "ELEVENLABS_AGENT_ID"
	return os.getenv(name, "").strip()


async def get_signed_url(lang: str = "en") -> str:
	api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
	agent_id = agent_id_for(lang)
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
		log.warning("elevenlabs signed-url request failed (%s)", type(exc).__name__)  # type only: messages can echo the URL
		raise ElevenLabsAPIError("Could not reach ElevenLabs") from exc

	if response.status_code >= 400:
		log.warning("elevenlabs signed-url request rejected (HTTP %d)", response.status_code)
		raise ElevenLabsAPIError("ElevenLabs rejected the signed URL request")
	try:
		payload = response.json()
	except ValueError as exc:
		raise ElevenLabsAPIError("ElevenLabs returned an invalid response") from exc
	signed_url = payload.get("signed_url") if isinstance(payload, dict) else None
	if not isinstance(signed_url, str) or not signed_url:
		raise ElevenLabsAPIError("ElevenLabs returned no signed URL")
	return signed_url
