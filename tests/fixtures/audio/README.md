# Speech calibration fixtures

Short WAV clips used by `python -m models.calibrate` (see `docs/spec/03-speech.md`, "Calibration").

## Layout
```
tests/fixtures/audio/
  normal/    clips of natural, healthy speech       -> label "healthy"
  slurred/   clips of acted/simulated slurred speech -> label "deficit"
```
Any `.wav` file under a subfolder is picked up. An optional sidecar with the same name and a `.json` extension
(`clip.wav` + `clip.json`) overrides the folder label and supplies metadata:
`{ "schema": 1, "kind": "speech", "subject": "s1", "scenario": "normal-phrase", "expected": "healthy|borderline|deficit", "targetPhrase": "..." }`.
Clips with no folder and no sidecar label are reported as unlabeled and never pass or fail.

Format: 16 kHz mono PCM16 WAV (what the browser recorder produces).

## Rules for committing a clip
- **Only commit clips whose speaker gave explicit consent** to have their voice stored in this public repo. When in doubt, keep it in `recordings/speech/` (gitignored) and share via the team drive.
- **No personal data in file names or sidecars.** Use an anonymous id (`s01`, `s02`), never a real name, email or phone number. Don't say anything identifying in the clip itself.
- **Keep clips short:** the target phrase only, about 2 to 6 seconds (well under 1 MB each).
- Simulated slurred speech is an acted imitation, not a patient; say so in notes, not in the file name of a real person.
- Never commit raw session recordings, only the trimmed phrase clips.

Run the report with `conda run -n StrokeShield python -m models.calibrate` (or `python -m models.calibrate` in your venv).
