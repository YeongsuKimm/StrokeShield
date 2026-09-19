// Render-time typography. Pure: string in, string out; no DOM, no network.
//
// Several on-screen messages are written with straight quotes (they are also matched exactly by code, sent to the
// alert text and compared with the transcript, so the SOURCE strings stay plain ASCII). This helper is applied only
// where a string is drawn on screen, so the page uses one kind of apostrophe and quote everywhere. Never call it on
// anything that is sent over the network, stored, or compared.

/** Straight quotes and apostrophes to typographic ones; text without any is returned unchanged. */
export function smartQuotes(text: string): string {
  if (!text.includes("'") && !text.includes('"')) return text
  return text
    .replace(/"([^"]*)"/g, '“$1”') // "quoted" pairs
    .replace(/(^|[\s([“])'/g, '$1‘') // opening single quote at a word start
    .replace(/'/g, '’') // everything else is an apostrophe or a closing quote
}
