# Human polish: craft audit of the StrokeShield frontend

Purpose: make the site look and read like it was made by a careful person, without touching the main style choices. This is a craft-quality list only. It does not hide or misrepresent how the site was built, and it never asks to weaken a disclaimer or add a medical claim.

- Audited: `frontend/` at commit `6615bff` (line numbers refer to that commit; other agents are editing, so re-grep before applying).
- Scope of this doc: research + audit + ordered edit list. **No code was changed.**
- Effort tags: **S** = a few lines, minutes. **M** = one file or a small helper, under an hour.
- Risk notes say whether an edit touches layout (L), accessibility contrast or size (A), or the safety and honesty rules in `AGENTS.md` (H).

---

## 1. Researched tells

A caveat first. No single tell proves anything. Adrian Krebs, the only source here that measured something, scored 1,590 Show HN pages against 16 patterns (22% heavy, 32% mild, 46% clean) and reports roughly 5 to 10% false positives; the same goes for writing tells ("one em dash is nothing, six patterns together is a signal"). The tells matter cumulatively: they read as "nobody decided this". Several sources below are agency or tool-vendor blogs with an angle; I kept only points that at least two sources repeat, or that I could check against the code.

### (a) Visual

| Tell | Why it reads as generated | Sources |
|---|---|---|
| Purple/indigo-to-blue gradient, "VibeCode purple", gradient text, aurora blobs, colored glows | Statistical default of image models and tutorials. Called the loudest tell of 2026. | [Krebs](https://www.adriankrebs.ch/blog/design-slop/), [925 Studios](https://www.925studios.co/blog/ai-slop-design-tells), [slop-detect](https://github.com/ravidsrk/slop-detect) |
| Framework defaults left untouched: shadcn/ui, `rounded-2xl shadow-lg p-6` cards, default Tailwind palette | No token was ever chosen. | [DEV: Purple Gradient Problem](https://dev.to/james_anderson_h/the-purple-gradient-problem-why-ai-ui-all-looks-alike-and-how-to-fix-it-3j65), [Sinton](https://www.sinton.agency/blog/how-to-spot-a-vibe-coded-website) |
| Uniform radius, padding and shadow on everything; perfect symmetry; equal spacing | "Mathematically perfect but emotionally cold". Real designs make the important thing bigger, closer, heavier. | [Mania](https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/), [Impeccable](https://mintlify.wiki/pbakaus/impeccable/concepts/anti-patterns) |
| Row of 3 (or 6) identical cards, each with an icon on top, heading and two lines | A "perfectly balanced trio" is a layout the model reached for, not a hierarchy. | [vibecodekit](https://vibecodekit.dev/ai-slop-design), [Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it) |
| Icon (or emoji) in a tinted rounded box above headings | Impeccable rule: "DON'T put large icons with rounded corners above every heading". | [Impeccable](https://mintlify.wiki/pbakaus/impeccable/concepts/anti-patterns), [Fountain Institute](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui) |
| Colored 3 to 4 px left (or top) border stripe on a card or callout | Called "almost as reliable a sign as em dashes"; slop-detect weights it 6. | [Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), [slop-detect](https://github.com/ravidsrk/slop-detect) |
| Pill/badge eyebrow above the H1; all-caps section labels | Hero recipe: badge, H1, subhead, two buttons. | [Krebs](https://www.adriankrebs.ch/blog/design-slop/), [slop-detect](https://github.com/ravidsrk/slop-detect) |
| Numbered "1, 2, 3" steps, stat banners (big number + small label), FAQ accordion | Part of the standard landing-page kit. Weight is low individually. | [slop-detect](https://github.com/ravidsrk/slop-detect) |
| Glassmorphism (`backdrop-blur` on translucent layers), dark-mode neon | Decorative blur with no function. Permanent dark theme was the most common tell (34% of pages in one crawl). | [Impeccable](https://mintlify.wiki/pbakaus/impeccable/concepts/anti-patterns), [Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it) |
| Cards inside cards; everything in a card | Flattens hierarchy. Use whitespace and type to group. | [Fountain Institute](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui) |
| Emoji or Lucide sparkles as icons; the same thin-line icon set on every element | Interchangeable icons carry no meaning. | [Fountain Institute](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui), [925 Studios](https://www.925studios.co/blog/ai-slop-design-tells) |
| Meaningless status dots and colored tabs; color used as decoration rather than state | Every color should map to a defined meaning. | [Fountain Institute](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui) |
| Pure `#000` / `#fff`, gray text on colored backgrounds | Impeccable: tint neutrals; use a darker shade of the background instead of gray. | [Impeccable](https://mintlify.wiki/pbakaus/impeccable/concepts/anti-patterns) |
| Cream page background (slop-detect scores it 7) | The "warm off-white + serif" look is now itself a fingerprint. Ours is nearly white and paired with a blue accent, so it is fine; see section 4. | [slop-detect](https://github.com/ravidsrk/slop-detect) |

### (b) Typographic

| Tell | Note | Sources |
|---|---|---|
| Inter/Roboto/system default; Space Grotesk, Geist, Instrument Serif italic accent as the "safe unusual" picks | Font is "the single highest-leverage move". We already have a deliberate pair. | [Mania](https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/), [Anthropic cookbook](https://platform.claude.com/cookbook/coding-prompting-for-frontend-aesthetics) |
| Flat hierarchy (sizes within 2x), many weights, mushy 1 px size differences | slop-detect: 3+ sizes with max/min under 2x. | [slop-detect](https://github.com/ravidsrk/slop-detect) |
| Crushed tracking on headings (tighter than -0.05em) or wide tracking on body | | [slop-detect](https://github.com/ravidsrk/slop-detect) |
| Straight quotes and apostrophes; hyphen with spaces where a dash belongs | "A typewriter habit"; curly quotes "match the other characters better". Mixing both in one product is the giveaway. | [Butterick, Practical Typography](https://practicaltypography.com/straight-and-curly-quotes.html) |
| No `text-wrap: balance` on headings, no `pretty` on paragraphs (orphans, ragged last lines) | One line of CSS each. `balance` for short blocks (browsers cap at about 6 lines), `pretty` for paragraphs. | [Chrome](https://developer.chrome.com/blog/css-text-wrap-pretty), [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap) |
| Numbers that change in place without tabular numerals | Digits jitter in timers and scores. | [Emil Kowalski skill](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md) |
| ALL-CAPS labels for every heading and label | Weight 3 in slop-detect; a "16 patterns" item. | [Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it) |

### (c) Copy

| Tell | Examples | Sources |
|---|---|---|
| Negation pivot: "It's not X, it's Y", "not just X but Y" | The most cited single pattern. | [Copy Ads Content](https://copyadscontent.com/signs-of-ai-writing/), [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| Rule of three and staccato triplets; metronomic sentence length | "Fast, simple, secure." | [Copy Ads Content](https://copyadscontent.com/signs-of-ai-writing/) |
| Vocabulary: seamless, elevate, unlock, empower, leverage, robust, comprehensive, holistic, navigate, journey, landscape, delve, pivotal, testament, "serves as" | The word list shifts every 6 months; the pattern (abstract verbs and adjectives with no object) does not. | [Copy Ads Content](https://copyadscontent.com/signs-of-ai-writing/), [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| Em dash on every other sentence. Caveat: the mark is legitimate; the tell is density, and dashes as a substitute for a comma or full stop. | One or two in a page is fine. | [Copy Ads Content](https://copyadscontent.com/signs-of-ai-writing/), [Good Story](https://goodstory.substack.com/p/in-defense-of-the-em-dash) |
| Filler and empathy boilerplate: "It's worth noting", "completely human", "Here's the thing" | Restating the heading in the first line under it. | [Copy Ads Content](https://copyadscontent.com/signs-of-ai-writing/), [Impeccable](https://mintlify.wiki/pbakaus/impeccable/concepts/anti-patterns) |
| Boosters with no number, generic headlines ("Scale without limits"), no named person or date | Real copy has specifics: counts, distances, sources, dates. | [Mania](https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/), [Copy Ads Content](https://copyadscontent.com/signs-of-ai-writing/) |
| Exclamation marks, "Oops!", cheerful error text; or the opposite, "An error occurred" | Good errors say what happened and what to do next, in plain words. | [Raw.Studio](https://raw.studio/blog/empty-states-error-states-onboarding-the-hidden-ux-moments-users-notice/) |
| Perfect grammar with no voice; one dialect in one paragraph and another in the next | | [Copy Ads Content](https://copyadscontent.com/signs-of-ai-writing/) |

### (d) Interaction and craft

| Tell | Note | Sources |
|---|---|---|
| Bounce or elastic easing; the same fade-up on everything; built-in CSS `ease` | Real things decelerate. Use a strong custom ease-out such as `cubic-bezier(0.23, 1, 0.32, 1)`, keep UI motion under about 300 ms, never `ease-in` on UI. | [Impeccable](https://mintlify.wiki/pbakaus/impeccable/concepts/anti-patterns), [Emil Kowalski skill](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md), [emilkowal.ski](https://emilkowal.ski/ui/7-practical-animation-tips) |
| Hover scale on cards; animation on things seen hundreds of times | Gate hover behind `(hover: hover)`; press feedback of 0.95 to 0.98 is what people feel. | [Emil Kowalski skill](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md) |
| Animating width/height/padding instead of transform and opacity | | [Impeccable](https://mintlify.wiki/pbakaus/impeccable/concepts/anti-patterns) |
| Only happy-path screens: no empty, error or loading state | | [Mania](https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/) |
| Shipped without the last 5%: no favicon or the framework's default one, no meta description or Open Graph image, duplicate titles, no 404, no `::selection`, no print styles | Reads as "nobody opened the site in a browser tab or shared it once". | [Sinton](https://www.sinton.agency/blog/how-to-spot-a-vibe-coded-website), [Fountain Institute](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui) |
| Layout that overlaps or overflows at sizes nobody prompted for; missing alt text, unlabeled buttons, weak keyboard support | | [Sinton](https://www.sinton.agency/blog/how-to-spot-a-vibe-coded-website) |
| Uniform, identical structure everywhere ("clean sites encode their choices somewhere durable") | Tokens in one file, used consistently, is the good version of this. Ours mostly is. | [Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it) |

Sources I only saw as search-result summaries and did not read in full: [Tahi Gichigi, 12 red flags](https://tahigichigi.substack.com/p/12-red-flags-of-ai-writing-and-how), [Anthropic cookbook on frontend aesthetics](https://platform.claude.com/cookbook/coding-prompting-for-frontend-aesthetics), [Yuwen Lu on X](https://x.com/yuwen_lu_/article/2041187936738447565), [GIGAZINE on the Krebs study](https://gigazine.net/gsc_news/en/20260423-design-slop/). The Tom's Guide article could not be fetched.

---

## 2. Audit of our frontend

### What already reads as human (keep it that way)

Own hand-drawn icon set (no Lucide), no emoji, no gradients, no glow, no glassmorphism on content; one blue accent; red used for emergency; tinted ink `#12161b` instead of `#000`; `font-synthesis-weight: none`; visible `:focus-visible`; skip link; reduced-motion support; a tinted, low-opacity shadow; `text-wrap: balance/pretty` already on 12 headings and lede paragraphs; hairline `gap-px` tables instead of rounded card grids; asymmetric hero (form left, content right, not a centered hero); hand-drawn arrow; sourced statistics with citations; concrete details ("about three feet", "ten seconds", 4.5 hours, "unlock the front door"); alt text on the pose photos; sentence-case headings; no exclamation marks anywhere in the UI copy; a loading state for the camera (`CameraView.tsx:204`). The Tailwind `--ease-out` token is redefined in `@theme` (`index.css:66`), which in Tailwind v4 also overrides the `ease-out` utility, so the 15 `ease-out` classes already use the custom curve.

### Findings, sorted by visibility x safety

"Where" is `file:line` at `6615bff`. All paths under `frontend/`.

#### Tier 1: highest visibility, near-zero risk

| # | Tell | Where | Fix | Effort / risk |
|---|---|---|---|---|
| 1 | **Framework default favicon.** `public/favicon.svg` is still the Vite lightning bolt, in purple `#863bff` with blurred purple/cyan gradient blobs. It is shown on every visit, contradicts the single-blue-accent rule and is the exact "vibecode purple" tell. | `public/favicon.svg`; `index.html:5` | Replace with the existing brand shield (`SiteHeader.tsx` `BrandMark`, viewBox 24). Full file below in 3.1. Add `apple-touch-icon` (180 px PNG export of the same mark) and `<meta name="theme-color" content="#fbfbf9">`. | S. No layout, no contrast issue. |
| 2 | **No Open Graph or social meta; long, doubled-up title.** Only `<title>` and `description` exist. The title is 58 characters and reads "StrokeShield: BE-FAST check guide (not a medical device)". | `index.html:7-11` | Add `og:title`, `og:description` (keep the honest sentence), `og:type`, `og:image` (1200x630 PNG), `twitter:card=summary_large_image`, `theme-color`, `color-scheme`. Shorter title: `StrokeShield, a guided BE-FAST check (not a medical device)`. Full block in 3.2. The OG image needs the deployed absolute URL; leave it as a TODO until the Vercel domain is known. | S. H: keep "not a medical device" in title and description. |
| 3 | **Em dashes in visible copy (4 places).** | `infoContent.ts:169`, `EyeTest.tsx:35`, `ArmsTest.tsx:38`, `capture.ts:384` (on-camera caption) | See the exact strings in 3.3 (copy table, rows C1 to C4). | S. Copy only. Check tests that assert captions. |
| 4 | **Negation pivot plus empathy filler in the "Why it matters" section.** "So the real question isn't whether to get checked. It's how quickly." and "That's completely human." | `InfoPage.tsx:86-99` | Replacement paragraphs in 3.3 (C5 to C7). Keeps the 1.9 million figure and the "cannot rule out" honesty, drops the pivot and the boilerplate. | S. H: keeps every disclaimer statement; still no medical claim beyond the cited figure. |
| 5 | **Colored left-border stripe on the main disclaimer**, and it is red although red is reserved for emergency. | `InfoPage.tsx:51` (`border-l-4 border-danger pl-4`) | Full hairline box in ink: `rounded-[var(--radius-control)] border border-line-strong bg-surface px-5 py-4 text-lg font-medium leading-snug`. Same text, same size, no stripe, no red. | S. A: ink on surface is 16:1, better than before. L: about 8 px more padding; none in flow. |
| 6 | **Straight apostrophes mixed with curly ones.** `infoContent.ts`, `InfoPage.tsx` (`&rsquo;`) and `eyeAdvice.ts` TIPS use curly; `capture.ts:214,220,327,345`, `speechRunner.ts:23-27`, `framing.ts:21`, `useTestRunner.ts:266`, `arms.ts:187`, and `SPEECH_TARGET_PHRASE` (`config.ts:48`) use straight ones that reach the screen. The mix is itself the tell. | as listed | **Do not edit the source strings.** Add a pure render helper `smartQuotes()` in `lib/typography.ts` (regex: `(\w)'(\w)` -> `$1’$2`; `"…"` -> `“…”`; leading `'` -> `‘`) and call it at the render sites (`TestScreen` title/lede, `CameraView` captions/hints, `SpeechTest` hint and blockquote, `VisionRetryButton` advice, `TranscriptStrip`). Add a 10-line unit test. Reasons not to touch the sources: (1) `flags[0]` strings are matched exactly by `eyeCauseOf`; (2) flags flow into the alert `symptoms` and the SMS is limited to one 160-character segment, and a single curly quote forces a non-GSM (UCS-2) encoding with a 70-character limit, so **anything sent to SMS or the agent must stay ASCII**; (3) the speech target phrase is compared with the transcript. | M. H: the alert path stays byte-identical. |

#### Tier 2: high visibility, low risk

| # | Tell | Where | Fix | Effort / risk |
|---|---|---|---|---|
| 7 | **Eyebrow labels above headings** (uppercase, tracked, bold) on nearly every block: hero "BE-FAST guide" above an H1 that says BE-FAST; "First" above "Before we start"; "Result"; "The pose"; "The sentence"; `01 · Eyes`. About 34 uses of `label-micro`. | `HomePage.tsx:47`, `PermissionsCard.tsx:118`, `ResultScreen.tsx:37`, `ArmsTest.tsx` (MicroLabel), `SpeechTest.tsx` (MicroLabel), `InfoPage.tsx:61,73` | Delete the eyebrows that repeat the heading: `HomePage.tsx:47` and `PermissionsCard.tsx:118` (the word "First" adds nothing). Keep uppercase only for data column labels (Dashboard "Confidence", "Max weight", "Combined risk") and section index numerals. On `.label-micro` itself: `font-weight: 600; letter-spacing: 0.07em` (was 700 and 0.09em). Size stays 0.8125rem so nothing shrinks. | S. L: hero shifts up about 24 px. A: none. |
| 8 | **Identical trio of icon-in-circle cards** on the result screen: `grid sm:grid-cols-3`, each card `size-10 rounded-full` tinted icon, `h3`, body, action. | `ResultScreen.tsx:71` (circle), `:146` (grid) | (a) Drop the circle background: `<span className={tone === 'danger' ? 'text-danger' : 'text-accent'}><Icon name={icon} size={22} /></span>` (still with the 911 card in red). (b) Break the symmetry so Call 911 is visibly the lead: `grid gap-4 sm:grid-cols-[1.35fr_1fr_1fr]`. Keep tap targets (whole card is the link). | S. L: yes, card widths change; check 640 to 900 px. Not a size or contrast reduction. |
| 9 | **Icon-in-circle on the emergency button.** | `EmergencyButton.tsx:13` (`size-9 rounded-full bg-white/15`) | Remove the inner circle; keep the 19 px phone icon and `gap-3`. Do not shrink the button (`min-h-14`) or change its position. | S. Keep it prominent (safety). |
| 10 | **Pill = default shadcn "badge" recipe** (tinted fill, same-hue 25% border, uppercase). | `Primitives.tsx` Pill (about l.35); used in `Dashboard.tsx:34-42` | Use sentence case and no letter-spacing: replace `label-micro` in Pill with `text-[0.8125rem] font-semibold`; drop the border on `neutral`. Add `tnum` to the severity pill. | S. A: unchanged size. L: pills get slightly narrower. |
| 11 | **Missing global `text-wrap`.** Only headings and a few ledes have it. Orphans in the consent list, FAQ answers, stat captions, action-card bodies, hotline details, the three "Why" paragraphs. | `index.css` (base) | Add: `h1,h2,h3,blockquote,figcaption{text-wrap:balance} p,li,dd,dt{text-wrap:pretty}` (exact block in 3.4). Unsupported browsers ignore it. | S. L: only where lines wrap. |
| 12 | **No custom `::selection`, no caret color.** | `index.css` | See 3.4. Selection: `color-mix(in srgb, var(--color-accent) 24%, white)` with ink text (ink on that fill is above 10:1). | S. A: fine. |
| 13 | **Raw error text shown to the patient.** If the alert request throws, `String(e)` (for example `TypeError: Failed to fetch`) is rendered in red under "The alert did not go through." | `App.tsx:125`, `ResultScreen.tsx:138-141` | In `App.tsx:125` keep the stored error but in `ResultScreen` show friendly text: `The text did not go through. Call 911 yourself, or press Send the alert to try again.` and render `alertResponse.error` only when it is a short server message (for example under 80 characters and not starting with `TypeError`). | S to M. H: this improves safety; still no diagnosis language. |
| 14 | **Result-band copy: heading repeated in the body, and an inaccurate "Several".** Caution: label "Something showed up", body "The checks found something borderline." (heading restated). High: "Several checks came back abnormal", but the score is a noisy-OR where one strong signal is enough (`Dashboard.tsx` note), so "several" can be false. | `ResultScreen.tsx:16-30` | Caution label `One check was borderline`; body `This tool cannot tell whether it means anything. If this is new, or you are worried, call 911 or get seen right away.` High body: `One or more checks came back abnormal. This is not a diagnosis, but treat it as an emergency: call 911 now.` Low band unchanged. | S. H: disclaimer and "call 911" text preserved; wording gets more accurate. |
| 15 | **"Test" and "check" used interchangeably.** Button says "Start the test"; copy, headings and other buttons say "check" ("Run the check again", "Skip this check", "four checks"). | `HomePage.tsx:60`, `InfoPage.tsx:200` (the menu's "Back to the check" already says check) | Use "check" everywhere: `Start the check`. (Agent prompt says "check"; the live agent is unaffected.) | S. Copy only. Search tests for the string first. |

#### Tier 3: medium visibility, low risk

| # | Tell | Where | Fix | Effort / risk |
|---|---|---|---|---|
| 16 | **Two spelling systems.** US: "minimize" (FAQ), "center" (eyeAdvice). UK: "analysed" (`consentText.ts:19`), "Analysing" (`SpeechTest.tsx:30,74`), "normalised" (`infoContent.ts:68`), "before you reach hospital" (`ResultScreen.tsx:151`). The app dials 911, so use US. | as listed | `analyzed`, `Analyzing your speech…`, `Analyzing…`, `normalized`, `before you reach the hospital`. Also comments `centre`/`colour` are invisible; leave. | S. Copy only. |
| 17 | **Red used for non-emergency marks.** The five "What it won't do" bullets use red `×` icons. Red is reserved for emergency. | `InfoPage.tsx:108` (`text-danger`) | `text-ink-3`. | S. A: ink-3 is 4.6:1 on paper, fine for a decorative glyph next to text. |
| 18 | **Bounce on the skip offer.** `ss-pop` overshoots (`scale(1.02)`, `translateY(-3px)`). | `index.css:138-155` | Keyframes: `0%{opacity:0;transform:translateY(8px)} 100%{opacity:1;transform:none}`, 260 ms, same ease. Keep the `border-2 border-accent` so it is still noticed. | S. |
| 19 | **Framework easing outside the token.** `ease:'easeOut'` (framer's built-in) and inline `ease-out` in two `transition:` strings. | `App.tsx:216`; `HomePage.tsx:23`; `InfoPage.tsx:45` | `App.tsx`: `ease: [0.16, 1, 0.3, 1]`. Inline strings: `'transform 300ms var(--ease-out), opacity 300ms var(--ease-out)'`. | S. |
| 20 | **Dead or decorative blur.** `backdrop-blur-sm` on an opaque `bg-surface` nav does nothing; the countdown scrim is already 80% ink. | `SiteHeader.tsx:102`; `CountdownModal.tsx:41` | Remove both. Keep it on `Button` `stage` (`Button.tsx:15`): there it separates controls from moving video. | S. |
| 21 | **`transition-all`** and layout-property transitions. | `ProgressDots.tsx:46`, `DrilldownMenu.tsx:224`, `Primitives` Meter (`transition-[width]`, fine as data), `SiteHeader.tsx:102` | Replace `transition-all` with `transition-[width,background-color]` on the dots. Leave the meter and menu width (they are functional). | S. |
| 22 | **Double icons and generic refresh icon on buttons.** "Skip this check" has `skip` + `arrowRight`; "Clear my data" uses the refresh glyph (which means "again", not "delete"). | `TestScreen.tsx:119`, `ClearDataButton.tsx:18` (`icon="refresh"`) | Skip: remove the leading `icon="skip"`. Clear my data: no icon. | S. |
| 23 | **Mushy type sizes.** Arbitrary `text-[0.875rem]` (17 uses), `[0.9375rem]` (19), `[1rem]` (16), `[0.8125rem]` (2), `[1.0625rem]` (1). One-pixel steps do not create hierarchy. | across `components/` | Define `--text-note: 0.875rem; --text-small: 0.9375rem` in `@theme` and collapse `[1rem]` uses that sit next to `[0.9375rem]` into one. Do not go below 0.875rem. | M. L: small wraps. A: no shrink. |
| 24 | **Weights.** `font-bold` x8 plus `label-micro` 700 plus `font-semibold` x22 plus `font-medium` x17. The unlayered serif rule (`index.css:186-195`) forces headings to 500, so the `font-semibold` on h1 to h3 is dead code. | `TestScreen.tsx:114`, `CameraView.tsx:144,155,175`, others | `font-bold` -> `font-semibold` in the app (not `DebugPanel`). Effective weights become 400/500/600. Remove dead `font-semibold` from h1 to h3 only when touching those lines. | S. A: over video, 600 at 24 px is still legible; keep the captions' `text-2xl`. |
| 25 | **`.tnum` is silently overridden on serif numbers.** The unlayered `.font-serif { font-variant-numeric: lining-nums }` (`index.css:189-195`) beats the layered `.tnum`, so `Dashboard.tsx:120` (combined risk %, `tnum font-serif`) and `SlotNumber` are not tabular. Also the Ring countdown digits (`Primitives.tsx` Ring `<text>`) are proportional, so "3 2 1" shifts. | `index.css:84-86, 189-195`; `Primitives.tsx` Ring | CSS: after the serif rule add `.tnum{font-variant-numeric:lining-nums tabular-nums}`. Ring: add `style={{fontVariantNumeric:'tabular-nums'}}` to the `<text>`. | S. L: SlotNumber digits get equal width (imperceptible). |
| 26 | **Uniform radius.** `--radius-panel` (1.25rem) is on 21 elements, including the hairline data tables (stats, team, dashboard grid), which suit a smaller radius. | `InfoPage.tsx:121,177`, `Dashboard.tsx:110` | Add `--radius-sheet: 0.5rem;` to `@theme` and use it for those three `gap-px` tables. Panels, hero and menu stay 1.25rem. | S. L: corners only. |
| 27 | **Numbered section labels and numbered step circles.** `SectionHead` shows `01` to `05`; the home step list uses `size-6 rounded-full` number badges plus arrows. | `Primitives.tsx:16` (index), `HomePage.tsx:72` | Keep the section rule and index (this is the storyboard's hand-drawn structure, see section 4). On the home list, replace the circle by a plain serif numeral: `<span className="font-serif tnum text-ink-3">{i + 1}</span>`. | S. |

#### Tier 4: craft additions (new files or blocks, no edits to existing UI)

| # | Tell | Fix | Effort / risk |
|---|---|---|---|
| 28 | **No 404 page.** There is no router, so Vercel's default 404 shows for any bad path. | Add `public/404.html` in the same paper style; copy in 3.5. | S. |
| 29 | **No `<noscript>`.** With JavaScript off the page is blank. For a stroke tool that is a safety gap. | Add a plain paragraph and a `tel:911` link in `index.html` (3.2). | S. H: adds an emergency route. |
| 30 | **No print styles.** The result summary prints with the fixed 911 button, the guide control, the header and colored backgrounds that vanish. | Add the `@media print` block in 3.4; optionally a `hidden print:block` line in `ResultScreen` "Checked on <date and time>" (a real, dated detail). The footer disclaimer must stay visible in print. | S for CSS, M with the date line. |
| 31 | **`scrollbar-gutter`.** Home (short) to info (long) changes scrollbar presence, so the page jumps sideways during the route transition. | `html{scrollbar-gutter:stable}` | S. L: reserves about 15 px on Windows. |
| 32 | **Stat block: identical 2x2 cells.** | `InfoPage.tsx:121`: `sm:grid-cols-[3fr_2fr]` makes each row unequal and lets the lead figure breathe; keep hairlines. Also fix the duplicated word in the fourth stat: `unit: 'percent'` and caption `percent of strokes missed...` -> caption `of strokes missed by FAST versus BE-FAST, in one published study. A finding about the clinical BE-FAST scale, not about this app.` | S. L: column widths. |
| 33 | **Stat sources are plain text.** Real writing links its sources. | Add `href` (DOI) to each `STATS[].source`; check each DOI before adding, do not guess. Add a line under the section: `Figures checked September 2026.` if the owner confirms. | S. |
| 34 | **Team block: four identical cells with one repeated affiliation.** | Replace with one sentence plus the names: `Four students at Johns Hopkins University, built for HopHacks, September 2026.` (owner to confirm event and month; add one-line roles only if the team supplies them, never invented). | S. |
| 35 | **`SlotNumber`: 1.6 to 3.6 s slot-machine reels** on figures a reader is trying to read. A "delight" gimmick on content. | `SlotNumber.tsx:54`: `1600 + r * 260` -> `900 + r * 120`, delay `r * 90` -> `r * 50`. Optional: drop it entirely. | S. Optional. |
| 36 | **Dashboard vocabulary.** "Waiting", "Max weight", "noisy-OR" read as generated or developer-facing. | `Dashboard.tsx:42,58,153`. `Waiting` -> `Not run yet`; `Max weight` -> `Counts up to`; keep the noisy-OR line but put the whole "How it adds up" block inside `<details><summary>How the score is worked out</summary>`. | S. |

### Owner decisions (not in the batches)

1. **Disclaimer is stacked.** On the home screen the long form appears in the hero and again as the first consent bullet, plus the short footer; on test screens `TestScreen.tsx:96` and the global footer (`App.tsx:223-225`) print the same short sentence twice. Repetition of an identical sentence is itself a generated-text tell, but the coverage is deliberate (`lib/disclaimer.test.ts`). Safe option: keep every placement, but show the long form once per screen and the short form elsewhere. Do not remove any placement without the owner.
2. **"Emergency contact" wording.** `HomePage.tsx:54-55`, `CountdownModal.tsx:53`, `ResultScreen.tsx:158` say the app texts "your emergency contact"; in the demo it texts one fixed demo phone. More specific and more honest: "it can text the demo phone we set up ahead of time (standing in for your emergency contact)". Decide once, apply in every place.
3. **Deletion contact.** `docs/PRIVACY.md` lists a missing deletion-request contact. A real address is a human detail; only the owner can supply it.

---

## 3. Exact snippets

### 3.1 `public/favicon.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <style>
    .s { fill: #0b5cab }
    .p { stroke: #fbfbf9 }
    @media (prefers-color-scheme: dark) { .s { fill: #8fc2f5 } .p { stroke: #0e1216 } }
  </style>
  <path class="s" d="M12 2.2 3.8 5.4v6.2c0 4.7 3.3 8.9 8.2 10.2 4.9-1.3 8.2-5.5 8.2-10.2V5.4Z"/>
  <path class="p" d="M6.9 12.4h2.8l1.6-3.6 2 7 1.6-3.4h2.2" fill="none" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### 3.2 `index.html` head additions

```html
<title>StrokeShield, a guided BE-FAST check (not a medical device)</title>
<meta name="theme-color" content="#fbfbf9" />
<meta name="color-scheme" content="light" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta property="og:type" content="website" />
<meta property="og:title" content="StrokeShield, a guided BE-FAST check" />
<meta property="og:description" content="A camera and microphone walk-through of the BE-FAST signs. Only a guide: not clinically accurate, not a medical device, cannot diagnose or rule out a stroke." />
<meta property="og:image" content="https://TODO-DEPLOYED-DOMAIN/og.png" />
<meta name="twitter:card" content="summary_large_image" />
```

Inside `<body>`, before `#root`:

```html
<noscript>
  <p style="max-width:34rem;margin:4rem auto;padding:0 1rem;font:1.125rem/1.5 Georgia,serif">
    StrokeShield needs JavaScript to run its camera and microphone checks.
    If you think someone may be having a stroke, do not wait: <a href="tel:911">call 911</a>.
  </p>
</noscript>
```

OG image (1200 x 630 PNG, exported from a hand-written SVG once; no new dependency): paper `#fbfbf9` background, the shield mark at left in `#0b5cab`, the wordmark "StrokeShield" in the serif stack at about 96 px, one line under it: "A guided BE-FAST check. Not a medical device." No gradient, no device mock-up.

### 3.3 Copy edits (exact strings)

| Id | File | Now | Replace with |
|---|---|---|---|
| C1 | `infoContent.ts:169` | `Any suspected stroke. Do not drive yourself — paramedics start treatment on the way.` | `Any suspected stroke. Do not drive yourself; paramedics start treatment on the way.` |
| C2 | `EyeTest.tsx:35` | `Move your eyes only — let your head stay exactly where it is. The dot travels left, then right.` | `Move only your eyes and keep your head where it is. The dot travels left, then right.` |
| C3 | `ArmsTest.tsx:38` | `Straight out to your sides, palms turned up. Hold still — I am watching for ten seconds.` | `Straight out to your sides, palms turned up. Hold still for ten seconds while I watch.` |
| C4 | `capture.ts:384` | `Follow the dot with your eyes — keep your head still` | `Follow the dot with your eyes. Keep your head still.` (this is a caption string, not a flag; confirm with `capture.test.ts` before editing) |
| C5 | `InfoPage.tsx:86-88` | `... The medicines that can reverse it only work for the first few hours. So the real question isn't whether to get checked. It's how quickly.` | `Every minute a stroke goes untreated, the brain loses roughly 1.9 million neurons. The medicines that can reverse it only work for the first few hours. That is why a stroke is treated as an emergency even when the signs are mild or come and go.` |
| C6 | `InfoPage.tsx:90-94` | `Most people don't call right away. They're on their own, or they don't want to overreact, or they figure it will pass. That's completely human. But waiting is what makes a stroke worse. A guided two-minute check ...` | `Many people wait because they are alone, or because they do not want to overreact. The wait is the costly part. A guided two-minute check walks you through the signs, but it is only a prompt to call 911, never a substitute for it.` |
| C7 | `InfoPage.tsx:96-99` | `We also tried to be honest about what this can't see. If the camera can't get a good look at you, that check gets left out and we tell you so. ...` | `If the camera cannot get a good look at you, that check is left out and the result says so. Even when every check works, this tool cannot rule a stroke out, so it can never reassure you.` |
| C8 | `ResultScreen.tsx:22-24` | label `Something showed up`, body `The checks found something borderline. This tool cannot tell ...` | label `One check was borderline`, body `This tool cannot tell whether it means anything. If this is new, or you are worried, call 911 or get seen right away.` |
| C9 | `ResultScreen.tsx:19` | `Several checks came back abnormal. ...` | `One or more checks came back abnormal. This is not a diagnosis, but treat it as an emergency: call 911 now.` |
| C10 | `ResultScreen.tsx:138` | `The alert did not go through.` (plus raw error) | `The text did not go through. Call 911 yourself, or press Send the alert to try again.` |
| C11 | `HomePage.tsx:60`, `InfoPage.tsx:200` | `Start the test` | `Start the check` |
| C12 | `consentText.ts:19`, `SpeechTest.tsx:30,74`, `infoContent.ts:68`, `ResultScreen.tsx:151` | analysed / Analysing / normalised / reach hospital | analyzed / Analyzing / normalized / reach the hospital |
| C13 | `infoContent.ts` STATS[3] | unit `percent`, caption `percent of strokes missed ...` | caption `of strokes missed by FAST versus BE-FAST, in one published study. A finding about the clinical BE-FAST scale, not about this app.` |
| C14 | `InfoPage.tsx:108` | `text-danger` on the `×` | `text-ink-3` |

### 3.4 `index.css` additions

```css
/* Selection and caret: one blue, ink text on top (>= 10:1). */
::selection { background: color-mix(in srgb, var(--color-accent) 24%, white); color: var(--color-ink); }
.on-stage ::selection { background: #8fc2f5; color: var(--color-stage); }
input, textarea { caret-color: var(--color-accent); }

html { scrollbar-gutter: stable; }

/* Line breaking: balance short blocks, avoid single-word last lines in paragraphs. */
h1, h2, h3, blockquote, figcaption { text-wrap: balance; }
p, li, dd, dt { text-wrap: pretty; }

/* .tnum must survive the unlayered serif rule (which sets lining-nums). Place after it. */
.tnum { font-variant-numeric: lining-nums tabular-nums; }

/* label-micro: quieter (was 700 / 0.09em). Size unchanged so nothing shrinks. */
.label-micro { font-weight: 600; letter-spacing: 0.07em; }

/* Skip-offer entrance without the overshoot (replaces ss-pop's 60% keyframe). */
@keyframes ss-pop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.pop { animation: ss-pop 260ms var(--ease-out) both; }

@theme { --radius-sheet: 0.5rem; }  /* hairline data tables */

@media print {
  html { cursor: auto; }
  body { background: #fff; }
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  header, .fixed, button, [role="region"][aria-label="Skip this check"] { display: none !important; }
  main { overflow: visible; }
  article, section, .rounded-\[var\(--radius-panel\)\] { break-inside: avoid; }
  footer { padding-bottom: 0; }          /* the disclaimer footer stays in print */
  a[href^="tel:"]::after { content: " (" attr(href) ")"; font-size: 0.85em; }
}
```

The `.fixed` rule also hides the Call 911 button and the guide control on paper, which is intended. Verify `.pop` and `@theme` placement compile under Tailwind v4 (`@theme` must be top level; move the token into the existing block).

### 3.5 `public/404.html` copy

Title `Page not found | StrokeShield`. Body, serif heading: "That page is not here." Paragraph: "The check lives on the home page. If you think someone may be having a stroke, do not spend time looking for it: call 911." Two links: "Go to the check" (`/`) and "Call 911" (`tel:911`, red). Same `paper`, `ink`, `accent` values inline in a `<style>` block (no external font, no script).

---

## 4. Do not change (style choices to preserve)

- The single blue accent (`--color-accent #0b5cab`) and the rule that red is reserved for emergency (only tighten strays, finding 17 and 5).
- No gradients, no glows, no glassmorphism on content; one hairline; the tinted single-family shadow.
- Serif titles (Tiempos Headline / Text with Newsreader fallback) and Avenir Next / Nunito Sans body; sentence-case headings; the unlayered heading rule that switches every h1 to h3 at once.
- The paper background `#fbfbf9` and off-black ink `#12161b`. slop-detect flags "cream", but ours is almost white, paired with blue and not with terracotta; changing it would be churn for no gain.
- The layout of each screen and the existing components (asymmetric home, hairline `gap-px` tables, drilldown menu, camera stage, progress dots, ring countdown).
- The storyboard details: the hand-drawn arrow, the heavy section rule with `01` to `05` index, the hand-drawn icon set (one 1.75 stroke), no emoji.
- The 2x custom cursors (unusual and clearly deliberate).
- Scroll hand-off between home and info (keep the visible bar and the explicit buttons).
- All disclaimer text and its placements, the consent wording that mirrors the real data flow, "cannot rule out / can never reassure", the sourced statistics and their "not a result from StrokeShield" framing, `tel:911` always on screen.
- Reduced-motion handling, focus rings, skip link, `inert` behind the countdown, `font-synthesis-weight: none`.
- Tailwind and the token file as the single place for values.

---

## 5. Implementation order (conflict-safe batches)

Different agents own different files today; batches are chosen so that two batches never edit the same file in parallel.

**Batch A: copy only** (strings, no classes). Files: `infoContent.ts`, `consentText.ts`, `EyeTest.tsx`, `ArmsTest.tsx`, `capture.ts` (caption only), `SpeechTest.tsx` (two strings), `HomePage.tsx:60`, `InfoPage.tsx` (paragraphs at 86-99 and button label), `ResultScreen.tsx` (banner copy, alert failure copy, "reach the hospital"). Rows C1 to C14, findings 3, 4, 13, 14, 15, 16. Run `pnpm test` (disclaimer test and caption tests), `pnpm typecheck`.

**Batch B: tokens and head only** (no component files). Files: `index.css` (3.4), `index.html` (3.2), `public/favicon.svg`, `public/404.html`, `public/apple-touch-icon.png`, `public/og.png`. Findings 1, 2, 11, 12, 18, 24 (CSS half), 25 (CSS half), 28 to 31. Visual check at 320, 768, 1440 px; print preview of the result screen.

**Batch C: components** (class changes), in this order so each file is touched once: `Primitives.tsx` (Pill, Ring tnum, SectionHead unchanged), `HomePage.tsx` (eyebrow, step numerals), `PermissionsCard.tsx` ("First"), `ResultScreen.tsx` (circle, grid, icon), `EmergencyButton.tsx`, `InfoPage.tsx` (disclaimer box, radius-sheet, stat grid, red ×), `Dashboard.tsx` (radius-sheet, vocabulary, details), `TestScreen.tsx` + `CameraView.tsx` (`font-bold` to semibold), `ProgressDots.tsx`, `SiteHeader.tsx` + `CountdownModal.tsx` (blur), `Button` users (icons), `App.tsx:216` (ease), `SlotNumber.tsx`. Findings 5 to 10, 17, 19 to 27, 32, 35, 36. Check 320 to 1024 px and 200% zoom after the grid and pill changes.

**Batch D: typography helper** (new `lib/typography.ts` + test, then call sites in `TestScreen`, `CameraView`, `SpeechTest`, `VisionRetryButton`, `TranscriptStrip`). Finding 6. Last, because it touches many files, and must not alter anything sent to SMS or the agent.

**Batch E: content that needs the owner** (team line, DOIs, "Figures checked" date, deletion contact, disclaimer stacking, "emergency contact" wording).

After each batch: `pnpm typecheck && pnpm lint && pnpm test`, update `docs/STATUS.md` and, if wording in a spec changed, `docs/spec/06-frontend-ux.md`.
