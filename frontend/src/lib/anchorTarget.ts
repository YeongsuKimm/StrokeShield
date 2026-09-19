// The menu can ask for "the info page, scrolled to section X". The page swap is animated, so the target element
// does not exist yet when the menu item is chosen; this remembers the request until the new page has mounted, and
// tells the route transition NOT to reset the scroll to the top in the meantime.
let pending: string | null = null
export const setPendingAnchor = (id: string | null) => {
  pending = id
}
/** Called once the old page has finished leaving. True means "a section jump is in progress, keep the scroll". */
export const consumePendingAnchor = () => {
  const had = pending !== null
  pending = null
  return had
}
