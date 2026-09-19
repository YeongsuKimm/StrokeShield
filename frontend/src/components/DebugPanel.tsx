import { useEffect, useState } from 'react'
import { useSession } from '../lib/session/store'
import { ARMS_CONFIG } from '../lib/vision/arms'
import { FACE_CONFIG } from '../lib/vision/face'
import { checkArmFraming, checkFaceFraming } from '../lib/vision/framing'
import { getVisionEngine, type VisionSnapshot } from '../lib/vision/useMediaPipe'

// ?debug=1 panel: the tool for confirming the LEFT/RIGHT mapping on a real camera (see the checklist below), plus live
// numbers and the metrics of the latest face/arms results. Polled at 5 Hz (not per frame).
const f = (x: number | undefined, d = 2) => (x === undefined || Number.isNaN(x) ? '-' : x.toFixed(d))

export function DebugPanel() {
  const engine = getVisionEngine()
  const [snap, setSnap] = useState<VisionSnapshot>(engine.latest)
  const results = useSession((s) => s.results)
  useEffect(() => {
    const id = setInterval(() => setSnap(engine.latest), 200)
    return () => clearInterval(id)
  }, [engine])

  const bs = snap.face?.blendshapes ?? {}
  const pose = snap.pose?.landmarks
  const faceFraming = checkFaceFraming(snap.face?.landmarks ?? null)
  const armFraming = checkArmFraming(pose ?? null)

  return (
    <div className="space-y-3 rounded-lg border border-fuchsia-800 bg-slate-900 p-3 font-mono text-xs">
      <div className="space-y-1 rounded bg-fuchsia-950/60 p-2 text-[13px] leading-snug text-fuchsia-100">
        <p className="font-bold">Verify LEFT/RIGHT on this camera (the display is mirrored like a mirror):</p>
        <ol className="list-decimal space-y-0.5 pl-5">
          <li>Raise ONLY your own RIGHT hand. The ORANGE pose labels 12/14/16 must follow it (they appear on the same side of the screen as your hand).</li>
          <li>Raise ONLY your own LEFT hand. The CYAN labels 11/13/15 must follow it.</li>
          <li>Face test: smile with ONLY the corner on your RIGHT (or wink your right eye). ORANGE 61 (mouth) / 33,159,145 (eye) must be on that side, and <b>mouthSmileRight</b> below must rise.</li>
          <li>If pose is swapped, flip <b>ARMS_CONFIG.swapLeftRight</b>. If blendshapes are swapped (Left/Right rise on the wrong side), flip <b>FACE_CONFIG.blendshapeLeftIsPatientLeft</b>. If landmark 61/33 are on the wrong side, tell the vision owner (face.ts landmark mapping).</li>
        </ol>
      </div>

      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <p>
          FACE_CONFIG.blendshapeLeftIsPatientLeft = <b className="text-amber-300">{String(FACE_CONFIG.blendshapeLeftIsPatientLeft)}</b>
        </p>
        <p>
          ARMS_CONFIG.swapLeftRight = <b className="text-amber-300">{String(ARMS_CONFIG.swapLeftRight)}</b>
        </p>
        <p>
          face: {snap.face ? 'detected' : 'none'} | yaw {f(snap.face?.yawDeg, 1)} deg | brightness {f(snap.brightness, 0)}/255
        </p>
        <p>aspect {f(snap.aspect, 3)} | frame t {f(snap.t / 1000, 1)} s</p>
        <p>
          mouthSmileLeft {f(bs.mouthSmileLeft)} | mouthSmileRight {f(bs.mouthSmileRight)}
        </p>
        <p>
          eyeBlinkLeft {f(bs.eyeBlinkLeft)} | eyeBlinkRight {f(bs.eyeBlinkRight)}
        </p>
        <p>
          pose wrist y: L(15) {f(pose?.[15]?.y)} R(16) {f(pose?.[16]?.y)}
        </p>
        <p>
          pose wrist x (raw): L(15) {f(pose?.[15]?.x)} R(16) {f(pose?.[16]?.x)}
        </p>
        <p>
          face framing: <span className={faceFraming.ok ? 'text-emerald-400' : 'text-red-400'}>{faceFraming.hint}</span>
        </p>
        <p>
          arm framing: <span className={armFraming.ok ? 'text-emerald-400' : 'text-red-400'}>{armFraming.hint}</span>
        </p>
      </div>

      {(['face', 'arms'] as const).map((t) => {
        const r = results[t]
        return (
          <div key={t} className="border-t border-slate-700 pt-2">
            <p className="font-bold text-sky-300">latest {t} result</p>
            {!r ? (
              <p className="text-slate-500">none yet</p>
            ) : (
              <>
                <p>
                  severity {f(r.severity)} | confidence {f(r.confidence)} | side {r.side ?? '-'} | retry {String(!!r.needsRetry)}
                </p>
                {r.flags.length > 0 && <p className="text-amber-300">flags: {r.flags.join(' | ')}</p>}
                <p className="break-words text-slate-300">
                  {Object.entries(r.metrics)
                    .map(([k, v]) => `${k}=${f(v, 3)}`)
                    .join('  ')}
                </p>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
