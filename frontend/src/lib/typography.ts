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

/**
 * Removes expressive-speech tone tags such as "[calm]" or "[warm, slow]" that the voice agent may put in its text so
 * ElevenLabs reads it a certain way. They are instructions to the voice, not words to show. Only short bracketed
 * runs of letters are treated as tags, so anything else in square brackets is left alone. Render-time only, like
 * smartQuotes: never apply it to text that is sent, stored or compared.
 */
export function stripToneTags(text: string): string {
  if (!text.includes('[')) return text
  return text
    .replace(/\[\s*[A-Za-z][A-Za-z\s,'-]{0,39}\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim()
}
