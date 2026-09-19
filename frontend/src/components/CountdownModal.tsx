import { useEffect, useState } from 'react'
import { COUNTDOWN_SECONDS, USER_REQUEST_COUNTDOWN_SECONDS } from '../lib/config'
import { useSession } from '../lib/session/store'

export function CountdownModal() {
  const { alertReason, cancelCountdown, confirmCountdown } = useSession()
  const total = alertReason === 'user_request' ? USER_REQUEST_COUNTDOWN_SECONDS : COUNTDOWN_SECONDS
  const [left, setLeft] = useState(total)

  useEffect(() => {
    if (left <= 0) {
      confirmCountdown()
      return
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [left, confirmCountdown])

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/80">
      <div className="w-full max-w-md rounded-2xl bg-red-950 p-8 text-center">
        <p className="text-lg">Signs that need urgent attention.</p>
        <p className="my-4 text-7xl font-bold">{left}</p>
        <p className="mb-6">Contacting emergency services…</p>
        <button onClick={cancelCountdown} className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-black">
          Cancel — I'm OK
        </button>
      </div>
    </div>
  )
}
