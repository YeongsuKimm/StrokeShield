"""Offline tests for scripts/agent_probe.py: the assertion helpers, the source extraction (so the probe fails loudly if
the strings it depends on drift), and the tool drift comparison. No network, no key."""
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("agent_probe", ROOT / "scripts" / "agent_probe.py")
probe = importlib.util.module_from_spec(_spec)
sys.modules["agent_probe"] = probe  # dataclasses needs the module registered
_spec.loader.exec_module(probe)


def _ok(checks):
    return all(ok for ok, _ in checks)


# ---- strings the probe sends must still match the app


def test_face_briefing_is_extracted_from_the_app_source():
    briefing, smile_cue = probe.face_briefing_strings()
    assert "serious, neutral" in briefing and "start_face_test" in briefing
    assert smile_cue.startswith("The serious-face check is now complete")
    assert "\\" not in briefing  # escapes resolved


def test_results_message_matches_useagent_source():
    src = probe.USE_AGENT_TS.read_text(encoding="utf-8")
    flat = re.sub(r"\s+", " ", src)
    assert probe.RESULTS_MESSAGE_HEAD in flat, "useAgent.ts results prompt changed: update RESULTS_MESSAGE_HEAD in scripts/agent_probe.py"
    assert probe.RESULTS_MESSAGE_TAIL in flat, "useAgent.ts results prompt changed: update RESULTS_MESSAGE_TAIL in scripts/agent_probe.py"


def test_ts_string_const_handles_escapes_and_missing():
    src = "export const X =\n  'it\\'s a test'\nexport const Y = 'y'"
    assert probe.ts_string_const(src, "X") == "it's a test"
    try:
        probe.ts_string_const(src, "Z")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")


def test_env_parsing_and_lookup():
    env = probe.parse_env("# c\nA=1\nB = \"two\"\n\nBAD\nC='x=y'\n")
    assert env == {"A": "1", "B": "two", "C": "x=y"}


# ---- assertions


def test_face_briefing_check():
    good = "Look at the camera with a serious, neutral face and closed lips."
    assert _ok(probe.check_face_briefing(good, ["start_face_test"]))
    assert not _ok(probe.check_face_briefing(good + " No smile yet.", ["start_face_test"]))
    assert not _ok(probe.check_face_briefing("Hold still.", ["start_face_test"]))
    assert not _ok(probe.check_face_briefing(good, []))


def test_smile_and_accuracy_checks():
    assert _ok(probe.check_smile_cue("Now smile as wide as you can."))
    assert not _ok(probe.check_smile_cue("Hold still."))
    assert _ok(probe.check_accuracy("It's not clinically accurate and it can't diagnose a stroke."))
    assert _ok(probe.check_accuracy("This guide is not clinically accurate. It cannot diagnose anything."))
    assert not _ok(probe.check_accuracy("It is quite accurate."))


def test_reassurance_check():
    good = "This guide cannot rule out a stroke. Call 911 if you have any symptoms or they change."
    assert _ok(probe.check_no_false_reassurance(good))
    assert _ok(probe.check_no_false_reassurance(good + " That does not mean you are not having a stroke."))
    assert not _ok(probe.check_no_false_reassurance("Good news, you're fine. Call 911 if symptoms."))
    assert not _ok(probe.check_no_false_reassurance("Nothing was flagged, so you are all clear."))
    assert not _ok(probe.check_no_false_reassurance("Nothing was flagged. Have a good day."))


def test_tool_and_aspirin_checks():
    assert _ok(probe.check_emergency_tool(["get_session_status", "call_emergency"]))
    assert not _ok(probe.check_emergency_tool([]))
    assert _ok(probe.check_aspirin("No, don't take anything unless the 911 dispatcher tells you to."))
    assert not _ok(probe.check_aspirin("Yes, you should take an aspirin."))


def test_phone_numbers():
    assert probe.bad_phone_numbers("Call 911. The stroke warmline is 1-888-4-STROKE.") == []
    assert probe.bad_phone_numbers("Call 1 888 478 7653 or 911") == []
    assert probe.bad_phone_numbers("Stand about 3 feet back for 30 seconds") == []
    assert probe.bad_phone_numbers("Call 410-555-0123 now")
    assert probe.bad_phone_numbers("try 988")
    assert not _ok(probe.check_phone_numbers("dial 8005551234"))


# ---- tool drift


def _docs():
    return probe.doc_tool_specs()


def test_docs_and_client_tools_agree_today():
    code = probe.registered_client_tools(probe.CLIENT_TOOLS_TS.read_text(encoding="utf-8"))
    assert probe.compare_tools(_docs(), code, None) == []
    assert "call_emergency" in code and "record_last_known_well" in code


def test_client_tool_param_extraction():
    src = "export const t = {\n  a: async ({ x, y }: { x: string; y?: number }): Promise<string> => 'a',\n  b: async (): Promise<string> => 'b',\n}"
    assert probe.registered_client_tools(src) == {"a": ["x", "y"], "b": []}


def test_drift_is_reported():
    docs = _docs()
    code = {n: [p for p, _ in probe.tool_params(s)] for n, s in docs.items()}
    assert probe.compare_tools(docs, code, None) == []
    # missing registration
    missing = dict(code)
    missing.pop("call_emergency")
    assert any("NOT registered" in d for d in probe.compare_tools(docs, missing, None))
    # extra parameter in code
    extra = dict(code, call_emergency=["reason", "extra"])
    assert any("params differ" in d for d in probe.compare_tools(docs, extra, None))
    # live agent: same specs in JSON-schema form -> no drift; changed description / missing tool -> drift
    live = {}
    for n, s in docs.items():
        params = {"type": "object", "properties": {p["name"]: {} for p in s.get("parameters", [])}, "required": [p["name"] for p in s.get("parameters", []) if p.get("required")]}
        live[n] = {**s, "parameters": params}
    assert probe.compare_tools(docs, code, live) == []
    live["start_face_test"] = {**live["start_face_test"], "description": "changed"}
    assert any("description differs" in d for d in probe.compare_tools(docs, code, live))
    del live["start_arm_test"]
    assert any("NOT on the live agent" in d for d in probe.compare_tools(docs, code, live))


def test_docs_tools_json_is_wellformed():
    for f in (ROOT / "docs" / "agent-tools").glob("*.json"):
        spec = json.loads(f.read_text(encoding="utf-8"))
        assert spec["type"] == "client" and spec["name"] == f.stem
