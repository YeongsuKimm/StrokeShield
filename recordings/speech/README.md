# recordings/speech/

Local speech calibration recordings. **Everything in this folder except this README is gitignored.**

- Produced by the browser's speech recorder in `?record=1` mode as `<subject>__<scenario>__<timestamp>.wav` plus a `.json` sidecar (`subject`, `scenario`, `expected`, `notes`, `targetPhrase`, `liveResult`, ...). Move the downloaded pairs here.
- Voice is personal data. Don't commit, post or paste these files. Share via the team drive.
- Replay and score them all: `python -m models.calibrate` (add `--csv out.csv` for spreadsheet analysis, `--verbose` for per-file metrics).
- To keep a consented clip as a permanent fixture, trim it and put it in `tests/fixtures/audio/{normal,slurred}/` (see the README there).

(The frontend's vision recordings live separately in `frontend/recordings/`.)
