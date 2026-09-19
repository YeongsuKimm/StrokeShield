@AGENTS.md

## Claude Code notes
- Plan before large changes; for anything touching `contracts.ts` / `schemas.py`, stop and confirm with the user.
- Prefer running `pnpm test` / `pytest` on the pure metric functions over launching the webcam UI.
- When you need current SDK details (ElevenLabs Agents SDK, MediaPipe Tasks Vision, Twilio), check the official docs rather than relying on memory — APIs here move fast.
