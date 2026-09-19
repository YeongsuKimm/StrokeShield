// Lets code outside React (the "Clear my data" wipe) hang up the ElevenLabs voice guide. `useAgent` registers the
// SDK's endSession here; nothing else may keep a conversation open.
let endSession: (() => unknown) | null = null

export function registerAgentEnd(fn: (() => unknown) | null): void {
  endSession = fn
}

/** Disconnect the voice guide if one is running. Never throws. */
export async function endAgentSession(): Promise<void> {
  try {
    await endSession?.()
  } catch {
    /* already disconnected */
  }
}
