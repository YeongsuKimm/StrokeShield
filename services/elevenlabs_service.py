# OWNER: Speech dev (STT) / Agent dev (signed URL). Spec: docs/spec/03-speech.md, 04-voice-agent.md
# TODO: transcribe(wav_bytes) -> {text, words:[{text,start,end}]} via ElevenLabs Scribe (ELEVENLABS_STT_MODEL),
#       get_signed_url() for the conversational agent (ELEVENLABS_AGENT_ID).
# Check the current ElevenLabs SDK docs for exact method names and response fields.
