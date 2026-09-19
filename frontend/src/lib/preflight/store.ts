import { create } from 'zustand'

/** `?preflight=1` opens the demo preflight on load; the footer link toggles it. */
export const isPreflightSearch = (search: string): boolean => new URLSearchParams(search).get('preflight') === '1'

interface PreflightUi {
  open: boolean
  setOpen: (v: boolean) => void
}

export const usePreflightUi = create<PreflightUi>((set) => ({
  open: isPreflightSearch(globalThis.location?.search ?? ''),
  setOpen: (open) => set({ open }),
}))
