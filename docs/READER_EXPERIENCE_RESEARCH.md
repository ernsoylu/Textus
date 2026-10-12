# Reader experience research and delivery plan

**2026-10-12 · design complete; M7.1–M7.3 implemented in code, physical-device validation (M7.0/M7.4) pending.** Source baseline: `d8cb5df`. Companion documents: [requirements](../ARCHITECTURE_AND_REQUIREMENTS.md#reading-m1-m4-m7), [roadmap](ROADMAP.md#m7--immersive-touch-reader-planned), [Figma screen index](FRONTEND_DESIGN.md#planned-reader-evolution--2026-10-12).

## Target and evidence boundary

The owner uses an **M2 iPad Pro 12.9-inch with the magnetically/wirelessly charged Apple Pencil 2** and an **iPhone 15 Pro Max**, with the latest installed OS versions. Exact OS build numbers were not supplied; capture them at testing time. Apple lists Pencil 2 compatibility with the 12.9-inch third–sixth generations; Pencil Pro is for newer models. iPhone has no Apple Pencil support. USB-C Pencil pressure support must not be assumed if testing another accessory. [Apple compatibility](https://support.apple.com/en-us/108937)

This review combines repository inspection with official product documentation accessed 2026-10-12. Competitor capabilities below are documented features, not hands-on benchmarks. Textus interaction findings are code evidence; gesture failures, performance and ergonomics still need reproduction on the owner's devices. Do not equate the underlying rendering library's capabilities with integrated app behavior.

Design reference canvases: iPad landscape 1366 × 1024, portrait 1024 × 1366, compact Split View 678 × 1024; iPhone portrait 430 × 932. These are logical design sizes, not guaranteed Safari viewports. Also test landscape, 320 CSS px available width, browser chrome expanded/collapsed, keyboard, browser text zoom and iPad window resizing. Use actual `visualViewport`, dynamic viewport units and safe-area insets in implementation; do not hard-code mockup OS padding.

## Comparable products

| Product / platform examined | Documented behavior | Lesson for Textus |
| --- | --- | --- |
| **PDF Expert / iPhone and iPad** | iPhone Reading Mode presents a single text column with size/theme controls. iPad offers themes and crop mode; reading has distinct annotation tools. | Prioritize readable phone content and a deliberate Read/Mark distinction. PDF reflow is a separate project, not a zoom toggle. [Reading mode](https://support.readdle.com/pdfexpert/en_US/reading-pdfs/reading-mode) |
| **PDF Expert / iPad Pencil** | Dedicated Apple Pencil workflow and Pencil settings. | Make pen intent explicit and verify device-specific behavior rather than promising native parity. [Pencil support](https://support.readdle.com/pdfexpert/en_US/tips-and-tricks/work-with-apple-pencil-in-pdf-expert) |
| **Readwise Reader / web and mobile** | Mobile pinch zoom, PDF region snapshots, annotated-PDF download, and enhanced text view. Highlights in PDF and text views do not overlay into the other view; both appear in the notebook. | Keep a unified notebook, but preserve source anchors and disclose conversion limits. Text view cannot safely inherit page rectangles without mapping. [PDF FAQ](https://docs.readwise.io/reader/docs/faqs/pdfs) |
| **Zotero / iOS** | Highlight, note, image and ink annotations, PDF dark mode, research-library sync and note reuse on desktop. | Add page ink and figure/scan annotations to the existing asset-linked notes model; keep research context. [Zotero for iOS](https://www.zotero.org/support/ios) |
| **Goodnotes / documented Pencil workflow** | Palm rejection and writing-posture settings; Pencil has its own palm-rejection support. | Separate drawing from navigation. Native behavior is a usability benchmark, not evidence that Safari offers equivalent palm rejection. [Palm rejection](https://support.goodnotes.com/hc/en-us/articles/7353727026959-Configure-palm-rejection-for-comfortable-writing) |
| **Xodo / web** | Browser PDF annotation includes notes, highlighting, freehand drawing and an annotated download. | Web ink is a reasonable product target; validate our stack before selecting implementation details. [Web annotator](https://xodo.com/pdf-annotator) |
| **Xodo / iPhone and iPad** | Pen tool supports finger/stylus/Pencil writing, with stroke size, opacity and color controls. | Offer a small reachable toolset and explicit finger drawing. [iOS workflow](https://xodo.com/blog/how-to-write-on-pdf-on-iphone-or-ipad) |

No prices, subscription recommendation, universal feature-parity claim or competitor latency claim is inferred from these sources. Borrow interaction patterns, not proprietary screen assets. Figma document text is illustrative.

## Gaps against the current app

Priority is delivery order within M7: **P0** correctness/feasibility gates, **P1** core experience, **P2** subsequent improvements.

| Gap | Current evidence | Proposed behavior / requirement | Priority |
| --- | --- | --- | --- |
| G01 · Immersion | `src/pages/Reader.tsx` reserves `100dvh - 13rem` on mobile and retains status/notes/fullscreen controls. The reader route remains inside `AppShell`; fullscreen already has a CSS fallback in `useFullscreen.ts`. | Reader owns available screen space; library chrome disappears inside the reading route. Focus hides secondary controls and retains a reachable exit. FR-READ-7. | P1 |
| G02 · Navigation density | `PdfViewer.tsx` wraps all controls in one toolbar; outline is a fixed 256 px sidebar. `BookViewer.tsx` uses a 288 px contents/search sidebar. Both can consume most of a narrow viewport. | Pages/contents/search in a bottom sheet on phones; sidebar only when adequate reading width remains. Always offer page jump without an outline. FR-READ-11. | P1 |
| G03 · Document zoom | PDF fit presets, +/- and keyboard scale controls exist; DjVu has fit/scale controls. No app-owned pinch/focal-point/double-tap integration is wired in these viewers. Browser zoom behavior is not measured. | Focal pinch, pan and reset for fixed-page content, explicit +/-/fit alternatives, no page turn while panning a zoomed page. FR-READ-8. | P0 spike → P1 |
| G04 · Touch selection | PDF/DjVu capture on mouse-up/key-up and context menu. BookViewer also listens to pointer-up, but its menu still relies on context menu; native selection handle changes are not tracked consistently. | Preserve native selection, detect stable selection changes, present reachable highlight/comment actions without right-click. FR-READ-9. | P1 |
| G05 · Small hit areas | `SelectionMenu.tsx`, `AnnotationForm.tsx` and `PageOverlay.tsx` use 24 × 24 px color buttons/markers. Several reader buttons are 36 px tall. | 44 × 44 CSS px minimum interaction boxes, typically 48 px reader buttons; non-overlapping marker hit regions and labeled colors. NFR-A11Y-2. | P1 |
| G06 · No ink | `useAnnotations.ts` accepts only `pdf_page` page/rectangles or `epub_cfi`. `PageOverlay.tsx` draws rectangles and comment markers; there is no stroke model or pen event handling. | Pen, freehand highlighter, stroke eraser, undo/redo and finger-input switch, starting with PDF. FR-READ-10. | P0 spike → P1 |
| G07 · Save failure loses context | `Reader.highlight()` closes the menu/bubble before mutation succeeds; `AnnotationForm.handleSubmit()` immediately clears the textarea. Errors are presented in the notes panel, which may be closed. | Keep the draft and anchor on error, show retry beside it, prevent duplicate submissions and confirm deliberate discard. FR-READ-12. | P0 |
| G08 · Navigation landmarks | PDF supports page labels/outline/search and annotations deep-link to their location; there is no thumbnail overview, bookmark model or return-location UI. | Thumbnail/page overview, return after a search/note jump; later explicit bookmarks. FR-READ-11/14. | P1 / P2 bookmarks |
| G09 · Scans/figures | PDF/DjVu text highlights depend on available text/OCR; page notes exist. PDF selections crossing pages keep first-page rectangles while selected text can span more. | Ink without OCR; bounded region anchors; never silently mismatch selected text and geometry across pages. FR-READ-9/10/14. | P1 ink / P2 region |
| G10 · Phone reading conversion | Reflowable books already offer font/spacing/themes; fixed PDFs have neither text-reading view nor crop-margin UI. | First improve fit/zoom, then non-destructive crop. Evaluate text view only with reading-order and source-location mapping. FR-READ-13. | P2 |
| G11 · Offline and portable ink | Notes are direct Supabase mutations. No durable reader outbox was found. Markdown/JSON export exists (`src/lib/annotationExport.ts`); annotated-PDF generation does not. | Honest pending/error state first; durable outbox/offline documents and derived annotated PDFs need explicit later contracts. FR-READ-12/14. | P1 errors / P2 offline-export |

Preserve existing strengths: asset-specific resume, private signed files, PDF range loading and visible-page rendering, PDF labels/search/spreads, EPUB CFI anchoring and themes, tagged notes, Markdown/JSON export, hostile-book isolation and keyboard navigation.

## Interaction contract

| Input / mode | Reading | Marking |
| --- | --- | --- |
| One finger | Scroll/pan; long-press text selects. Links remain links. | With **Draw with finger off**, navigate/select as in Reading. With it on, draw only on the page surface. |
| Two fingers | Pinch at focal point; pan when zoomed. | Pan/zoom; cancel an unfinished finger stroke before switching to navigation. |
| Pencil 2 | No accidental ink. Use explicit Mark/Pen activation. | Pencil draws with selected tool; finger drawing defaults off. Pressure is an enhancement, with fixed-width fallback. |
| Mouse / keyboard | Existing scroll, selection, page and zoom controls remain. | Click/drag tool behavior plus labeled undo/redo/eraser controls. Shortcuts do not run inside inputs. |

In Pencil mode ignore touch-generated ink; while the pen is down, ignore incidental touch navigation. Resume deliberate finger navigation after the pen lifts. Treat `pointercancel`, lost capture, orientation change and app backgrounding explicitly: never join a new stroke to an interrupted one. Two-finger navigation wins over an uncommitted finger stroke. Double-tap zoom/reset applies only to blank document space in Read mode; do not steal text selection, links, annotation taps or accessibility gestures.

Use Pointer Events with pointer capture and capability detection. Coalesced events may improve strokes when available; persist real samples, not prediction-only points. Restrict custom `touch-action` handling to the page interaction surface and active mode; keep browser zoom and accessible controls available elsewhere. Native palm rejection, hover, hardware double-tap, squeeze and barrel-roll are not browser promises. [Pointer Events standard](https://www.w3.org/TR/pointerevents3/), [WebKit's Safari pointer support](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/)

A focus toggle must be explicit and keyboard/VoiceOver reachable. A blank-margin tap may also reveal controls, but must not be the only route out. Do not auto-hide controls while selection, keyboard, an unsaved draft, a modal or accessibility focus is active. Settings/status/download remain under More. Phone notes and tool sheets preserve the selected passage and adapt to the software keyboard; wide iPad layouts may keep notes beside the page. Closing a sheet restores focus and reading position.

The 44 CSS px minimum is a deliberate Textus usability target, matching WCAG's enhanced target-size guidance; it is not a claim that all WCAG AA targets must be 44 px. Existing AA work remains required. [W3C guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)

## Data and format boundaries

- Keep source assets immutable. Ink is annotation data keyed to the existing owned record and asset; export produces a derived download, never overwrites the source.
- Before schema implementation, agree a versioned page-ink payload: page index, unrotated normalized source coordinates, bounded points, optional pressure, stroke color/width and tool. Width uses source-page units; view transforms must not change it. Validate finite values/ranges, byte size, point count and ownership on server and client. Define measured ceilings during M7.0; do not send one database write per pointer sample.
- Maintain old `pdf_page`/`epub_cfi` records and deep links. Add an additive migration only where needed; regenerate database types. Decide the discriminator before shipping ink. Existing renderers/Notes/exports must display a safe fallback for unknown kinds instead of dropping annotations silently.
- Support undo/redo for ink as complete user actions, including erasing a stroke; undo after save must persist the reversal. Multi-device edits require a revision/conflict policy before release: never silently overwrite a newer note.
- Retrying creation must be idempotent with a stable client operation ID. Distinguish **Saving**, **Saved**, **Could not save** and **Offline / not saved**. “Saved” requires server acknowledgement. Keep failed drafts in the current session and block accidental navigation/discard; durable recovery after tab loss is a separate P2 feature until implemented and tested.
- Reflowable EPUB/MOBI/AZW3 keep CFI text annotations. Do not attach freehand ink to changing viewport coordinates. PDF ink first; DjVu/CBZ parity follows dedicated coordinate and pagination fixtures. Do not advertise all-format ink.
- Crop changes only the view transform. PDF text mode must preserve source page links and expose missing/incorrect extraction; tables, columns, formulas and OCR are an explicit quality gate. Start read-only if reliable text-to-page annotation mapping is unavailable.
- JSON export must preserve the complete new payload; Markdown must identify ink/regions with a source link or explicit representation, not omit them. Embedded/flattened annotated-PDF export and importing third-party annotations are separately scoped.

## Acceptance and real-device release gates

These are proposed pass criteria, not measurements from this research.

| Gate | Required evidence |
| --- | --- |
| A01 · Reading space | At every target viewport, enter/exit focus, open/close notes and rotate without losing the visible passage. Reader chrome never causes horizontal overflow; only a deliberately zoomed document pans. The reading surface occupies at least 85% of available app viewport in Focus, excluding OS/browser chrome. |
| A02 · Zoom | Ten pinch/pan/reset cycles on text, mixed-size and rotated PDFs; point under pinch centroid remains within 8 CSS px after settling. Annotation source coordinates are unchanged. Fit presets recompute after resize without overwriting explicit manual zoom. Zoom controls remain usable at 200% browser zoom. |
| A03 · Selection | Finger-select and adjust both handles in PDF, EPUB and OCR DjVu; highlight in one action after selection, or add a comment without reopening Notes. Scanned pages show an understandable no-text state. Multi-page selection is either correctly split into linked anchors or visibly restricted with matching quote text. |
| A04 · Pen/finger | On the actual M2 + Pencil 2, repeat 20 write/palm-rest/pan cycles per orientation with zero unintended strokes in Pencil-only mode. Verify finger mode on iPhone, cancellation on second touch, stroke erasure and undo/redo before/after saving. Record limitations rather than silently accepting failures. |
| A05 · Durable server save | Simulate disconnect, 401, 500, lost response and duplicate retry. Draft/anchor remain recoverable; reconnect creates exactly one annotation. An acknowledged save survives reload on both devices. Unsaved navigation prompts; latest server revision is not overwritten silently. |
| A06 · Geometry | Landmarks align within 2 CSS px after stable render at 50%, 100%, 200%, rotation, crop and device resize; verify PDF CropBox/rotation, pages of different sizes, DPR and deep links. No screenshot-only persistence. |
| A07 · Accessibility | VoiceOver, external keyboard and touch: named controls/colors, selected state beyond color, 44 px hit boxes, sheet focus/escape/return, visible focus, text reflow at 200%, reduced motion and no keyboard-covered Save. Automated axe plus manual checks; no gesture-only essential function. |
| A08 · Performance | Proposed p95 input-to-visible-ink target ≤50 ms on the M2 and iPhone in finger mode, using at least 100 measured samples after warm-up; report instrument and conditions. Run 30-minute sessions with a 300-page text PDF, 100-page scanned PDF and 500-page mixed PDF, plus 1,000 annotations. No tab reload, sustained blank pages or unbounded memory growth; record traces and baseline-relative results. Retain bounded rendering/range loading. |
| A09 · Isolation / regressions | Two-user tests reject forged record/asset links and oversized/malformed stroke payloads. Old annotations/CFIs/exports and WorkDetail embedded previews still work. Hostile EPUB isolation remains intact. |

Test Safari on the actual latest installed iOS/iPadOS builds and standalone home-screen mode **if available**; do not assume installability/offline support. Add Playwright WebKit and Chromium touch coverage for reproducible UI behavior, but treat emulation as insufficient evidence for Apple Pencil, palm rejection, keyboard occlusion or native selection. Exact build numbers, orientation, accessory, fixture sizes and results belong in the delivery log.

## Delivery sequence and reach

| Work item | Depends on | Scope / affected code and artifacts | Exit / estimate |
| --- | --- | --- | --- |
| **M7.0 / P0 — compatibility and measurement spike** | None | `PdfViewer`, `BookViewer`, `DjvuViewer`, `pageGeometry`; run real-device selection/pinch/Pencil spike, record baseline and supported browser features. Set annotation payload limits and measured performance budgets. | A02/A04 feasibility report; exact OS/device record. 2–3 engineer-days plus device access. |
| **M7.1 / P1 — immersive responsive shell** | M7.0 | `Reader`, `AppShell`, `TopBar`, `Sidebar`, `MobileNav`, `useFullscreen`, `useReaderPrefs`, `Popover`/`ModalDialog`; share the existing components. Keep embedded viewers in `WorkDetail` usable. Add compact sheets and reachable controls. | A01/A07; R01/R03/R04/R05/R08/R10. 3–5 days. |
| **M7.2 / P0–P1 — touch navigation, highlights and safe saves** | M7.0; integrate with M7.1 | All three viewers, `SelectionMenu`, `AnnotationForm`, `AnnotationPanel`, `PageOverlay`, `Reader`, `useAnnotations`, `useReadingState`, `pageGeometry`; fit/pinch/pan, selection-change handling, no-outline navigation, return position, retry/idempotency/conflict contract. | A02/A03/A05/A06 for existing annotations; R06/R07/R08/R09. 4–7 days. Draft-retention fix can be delivered first. |
| **M7.3 / P1 — PDF ink** | M7.0, M7.2 | Extend shared annotation validation/types/rendering, `NoteCard`, `Notes`, tags/deep links, `annotationExport`; additive migration/RLS validation, generated DB types, history and export consumers. Pen/finger routing, normalized strokes, stroke eraser, undo/redo. | A04/A05/A06/A09; R02/R11. 6–10 days. |
| **M7.4 / release gate — hardware and regression sign-off** | M7.1–3 | Unit/component geometry and error-state tests; `e2e/flows.spec.ts`, `e2e/reader-security.spec.ts`, Playwright config/WebKit, format fixtures, database isolation tests. Update README, requirements, Figma status and this log only on actual delivery. | A01–A09, both physical devices, no unresolved data-loss issues. 3–5 days. |
| **M7.5 / P2 — subsequent reading improvements** | Core gates pass | View-only crop, evaluate mapped PDF text view, region annotations/bookmarks, DjVu/CBZ ink parity, derived annotated-PDF export; scope durable offline queue/downloads separately with auth cleanup and storage quotas. | Each feature needs its own acceptance/format matrix. Not estimated or represented as committed delivery. |

Core planning range: **18–30 engineer-days**, excluding scheduling for device testing. Estimates are provisional; re-estimate after M7.0. No new rendering stack, native wrapper, paid SDK, AI summarizer or handwriting recognition is required for the core plan. Document requirements/test fixtures first when changing persistence contracts; preserve the existing security boundaries.

## Research and decision log

| Date | Decision / work | Status / evidence |
| --- | --- | --- |
| 2026-10-12 | Inspected reader shell, all three viewers, selection/forms/overlays, annotation anchors and exports, prefs/fullscreen, AppShell, requirements and browser fixtures at `d8cb5df`. | Complete source review; no physical-device measurements. |
| 2026-10-12 | Compared five products across web/mobile using official pages above. | Complete desk research; feature availability is platform-specific. |
| 2026-10-12 | Owner confirmed M2 and wireless-charging Pencil; target recorded as Pencil 2. Latest OS stated, exact builds pending test record. | Design constraint adopted; no Pencil Pro dependency. |
| 2026-10-12 | Preserve rendering stack, private immutable assets and existing annotations. Deliver shell/touch/error handling before richer ink. | FR-READ-7–14 and M7 backlog added; implementation open. |
| 2026-10-12 | Added eleven editable planned reader mockups and two prototype entry points in the existing Figma file. | See linked screen index and validation evidence in `FRONTEND_DESIGN.md`. Prototype shows transitions, not functional gestures. |
| 2026-10-12 | **M7.1–M7.3 implemented** on baseline `d8cb5df` (G01–G09, G07 fixed first). Pinch uses touch events so one-finger scrolling stays native; ink is one row per stroke so undo/erase are single idempotent writes. | Status **implemented, not hardware-verified**. Hardware/OS: none yet. Tests: Vitest, pgTAP `pdf_ink`, Chromium Playwright at 430/678/1366 px. Limits and open gates in ROADMAP “M7.1–M7.3 implementation”. |

Next delivery log entries must include work-item ID, code revision, exact hardware/OS, tests/fixtures, measured results, known limitations and whether the feature is designed, implemented or hardware-verified. Do not mark M7 complete from a mockup or desktop test alone.
