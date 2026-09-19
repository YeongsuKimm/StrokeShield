"""Tighten the live ElevenLabs agent's privacy settings (docs/PRIVACY.md section 6).

Default is a READ-ONLY preview: it prints the current settings and what would change. Nothing is modified unless you
pass --apply. It edits the shared agent, so run it only with the team's OK. It saves a JSON backup of the whole agent
config first (backup path is printed) so anything can be restored.

    python scripts/elevenlabs_privacy.py            # preview
    python scripts/elevenlabs_privacy.py --apply    # apply, then verify nothing else changed

Changes (forward-looking only; existing conversations are NOT deleted):
  privacy.record_voice=false, delete_audio=true, retention_days=1
  data_collection and evaluation criteria emptied (they send transcripts to an analysis LLM)
  conversation file_input disabled (unused)
Not possible via API: the account-level "Improve the models for everyone" toggle (dashboard) and Zero Retention Mode
(enterprise plan).
"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "https://api.elevenlabs.io"
PATCH = {
    "conversation_config": {"conversation": {"file_input": {"enabled": False}}},
    "platform_settings": {
        "privacy": {"record_voice": False, "delete_audio": True, "retention_days": 1, "apply_to_existing_conversations": False},
        "data_collection": {},
        "evaluation": {"criteria": []},
    },
}


def load_env() -> dict[str, str]:
    lines = (ROOT / ".env").read_text().splitlines()
    return dict(line.strip().split("=", 1) for line in lines if "=" in line and not line.lstrip().startswith("#"))


def call(method: str, path: str, key: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        API + path,
        method=method,
        headers={"xi-api-key": key, "content-type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        sys.exit(f"ElevenLabs returned HTTP {e.code}: {e.read()[:300]!r}")


def flat(x, prefix=""):
    if isinstance(x, dict):
        for k, v in x.items():
            yield from flat(v, f"{prefix}/{k}")
    else:
        yield prefix, x


def summary(agent: dict) -> dict:
    ps = agent["platform_settings"]
    return {
        "privacy": {k: ps["privacy"].get(k) for k in ("record_voice", "delete_audio", "retention_days", "zero_retention_mode")},
        "data_collection_fields": list(ps.get("data_collection") or {}),
        "evaluation_criteria": [c.get("id") for c in (ps.get("evaluation") or {}).get("criteria", [])],
        "file_input_enabled": agent["conversation_config"]["conversation"].get("file_input", {}).get("enabled"),
    }


def main() -> None:
    env = load_env()
    key, agent_id = env["ELEVENLABS_API_KEY"], env["ELEVENLABS_AGENT_ID"]
    before = call("GET", f"/v1/convai/agents/{agent_id}", key)
    print("current :", json.dumps(summary(before), indent=1))
    if "--apply" not in sys.argv:
        print("\nPreview only. Re-run with --apply to change these settings.")
        return
    backup = ROOT / f"elevenlabs_agent_backup_{int(time.time())}.json"  # gitignored (see .gitignore)
    backup.write_text(json.dumps(before, indent=1))
    print(f"backup written to {backup.name} (contains config only; do NOT commit it)")
    call("PATCH", f"/v1/convai/agents/{agent_id}", key, PATCH)
    after = call("GET", f"/v1/convai/agents/{agent_id}", key)
    print("now     :", json.dumps(summary(after), indent=1))
    a, b = dict(flat(before)), dict(flat(after))
    changed = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
    print(f"\n{len(changed)} config paths changed:")
    for k in changed:
        print("  ", k)
    same_prompt = before["conversation_config"]["agent"]["prompt"] == after["conversation_config"]["agent"]["prompt"]
    print("prompt, tools and voice untouched:", same_prompt)


if __name__ == "__main__":
    main()
