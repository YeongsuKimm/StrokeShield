// Copy text to the clipboard with two fallbacks. The caller shows a selectable text area when this returns 'failed'.
// Nothing is kept: the text goes to the clipboard (or stays on screen) and nowhere else. No files, no history.

export type CopyOutcome = 'copied' | 'failed'

export interface ClipboardDeps {
  /** `navigator.clipboard.writeText`, when the browser has it (it needs a secure context and a user gesture). */
  writeText?: (text: string) => Promise<void>
  /** The old `document.execCommand('copy')` route through a hidden textarea; returns whether it worked. */
  execCopy?: (text: string) => boolean
}

function execCommandCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.tabIndex = -1
  area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
  document.body.appendChild(area)
  try {
    area.select()
    return document.execCommand('copy')
  } finally {
    area.remove()
  }
}

export function browserClipboard(): ClipboardDeps {
  const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  return {
    writeText: clip?.writeText ? (t) => clip.writeText(t) : undefined,
    execCopy: typeof document === 'undefined' ? undefined : execCommandCopy,
  }
}

export async function copyToClipboard(text: string, deps: ClipboardDeps = browserClipboard()): Promise<CopyOutcome> {
  if (deps.writeText) {
    try {
      await deps.writeText(text)
      return 'copied'
    } catch {
      // Permission denied or no user gesture: try the older route.
    }
  }
  try {
    if (deps.execCopy?.(text)) return 'copied'
  } catch {
    // fall through
  }
  return 'failed'
}
