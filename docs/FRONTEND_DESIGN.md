# Textus frontend design

[Figma design file](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3) · [Complete screen index](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=29-2)

Updated from the implemented frontend on 2026-10-09 (code revision `a12d152`). All original desktop/mobile frames have been refreshed, with their IDs preserved, and missing implemented states added. The frontend is the source of truth for behavior; Figma uses editable layers and illustrative content.

**252 screen states:** 126 desktop/mobile pairs, comprising 246 active states and six retired references. The original 210 states are retained, with 42 additional states. Public signup, duplicate confirmation and add-edition flows are marked retired. Former dialog states now show inline forms where the code implements them. Three Figma pages organize the guide/components, desktop designs, and mobile designs. Main journeys have prototype links; the index links to every state.

## Visual system

- **Default:** [Everforest Dark Medium](https://github.com/sainnhe/everforest/blob/master/autoload/everforest.vim), using the upstream palette with the frontend’s action-color override.
- Background `#2D353B`; navigation `#232A2E`; surface `#343F44`; elevated surface `#3D484D`.
- Text `#D3C6AA`; secondary text `#9DA9A0` where contrast permits; action `#B4CA92`; warning `#DBBC7F`; destructive `#E67E80`.
- Lora for editorial headings and reading; Inter for forms, navigation, and metadata.
- 57 Figma variables in three collections, eight text styles, and 16 reusable components. Fills and spacing/radii use variable bindings.
- Desktop frames are 1440px wide; mobile frames are 390px wide. Long frames show full scrollable content. Below 768px, forms stack, tables become cards, navigation moves to the bottom, and dialogs become focused sheets.
- Keep mobile navigation fixed in the frontend, respect safe areas, and keep reader controls reachable. Actual device and keyboard behavior needs implementation testing.

## Requirement coverage

| Requirements | Designed surfaces |
| --- | --- |
| FR-AUTH-1–2 | Sign in, closed public signup, magic-link confirmation, password recovery, account settings, privacy messaging |
| FR-CAT-1–5 | Work and edition details/editors, identifiers, duplicate warning, delete confirmations |
| FR-CONTRIB-1–4 | Person/organization forms, pasted-name preview, ordered role credits, printed names, editor fallback |
| FR-CONTRIB-5–9 | Names and authority identifiers, evidence review, merge/conflict/forced merge, split, distinction, duplicate queue |
| FR-CONTRIB-10 | Chapter/article record, container picker, issue/volume relationship and citation guidance |
| FR-FILE-1–6 | Upload, attachment roles, progress, reuse/deduplication, rejection, retry, file removal |
| FR-SRCH-1; FR-ORG-1–5 | Library/search, filters, sort, tags, collections, ordering, bulk actions, saved searches |
| FR-META-1–6 | Identifier lookup, selected-field preview, locks, source/time, invalid/not-found/rate-limit/provider failures |
| FR-READ-1–6 | PDF/EPUB readers, position/progress, contents, reading status, highlights/notes, export, download-only formats |
| FR-RES-1–3 | Citation export, linked versions, CSV column mapping, DOI-list import and review |
| FR-SER-1–3 | Serial/issue details, expected-issue range, completeness, OPDS configuration state |
| NFR-A11Y-1 | Visible focus/error/disabled/loading components, text contrast, labeled state colors, minimum 44px actions, documented keyboard behavior |

## Validation and boundaries

All 252 desktop/mobile frames were checked for horizontal overflow, duplicate names, editable text and local component instances. Fonts are Inter and Lora. Frames are arranged without canvas overlap. Representative renders were visually inspected for library, work details, readers, notes, authentication, workers and account deletion. This is a code-informed design sync, not a pixel-perfect capture or a WCAG certification. Keyboard semantics, focus trapping, screen readers, zoom/reflow and device behavior still need implementation tests.

The prototype illustrates navigation and decisions. Inputs, provider requests, downloads, persistence and export generation are design states rather than working application behavior. Book covers and bibliographic examples are illustrative.

Implementation decisions and changes since the design:

- The implementation offers email/password and magic links. Public signup is closed; administrators create accounts.
- OPDS uses HTTP Basic with any username and a read-only agent token as the password. Account passwords are not accepted. The endpoint is `/functions/v1/opds` on the Supabase host.
- Expected issue ranges persist in `works.metadata.expected_issues` (FR-SER-2).
- Readers use pdf.js, foliate-js (EPUB/MOBI/AZW3/CBZ) and DjVu.js. They support fullscreen, selection-based highlights, comment markers and note deep links. PDF has continuous scrolling, fit modes, spreads and search; reflowable books have layout, font, spacing and theme controls.
- Library covers expose Read, View details and half-star ratings on hover/focus/touch. Search displays cover ribbons and supports keyboard navigation; metadata search accepts partial Unicode and accent-insensitive matches.
- Catalog editors expose fields for the selected work/record type, including standards references and journal metadata. Tags get automatic colors and also label collections and notes. Mobile More opens all secondary pages.
- The Notes page groups notes by book and filters by text, tag, color and comment.
- Settings include AI model/status controls, scoped agent tokens with one-time secret display, and administrator-only Workers registration/revocation. Activity includes grouped jobs, AI queue pause/start and full-text passage search.
- Privacy is owner-only. There are no public shelves, shared-library flows, DRM removal, conversion tools or native-app assumptions.

## Pages

| Page | Desktop | Mobile |
| --- | --- | --- |
| signin | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-165) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2947) |
| signup (retired) | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-204) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2973) |
| magic | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-237) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2993) |
| forgot | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-264) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3007) |
| reset | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-292) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3022) |
| welcome | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-324) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3041) |
| home | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=10-2) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=10-306) |
| library | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=10-99) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=10-383) |
| list | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-377) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3077) |
| search | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-470) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3149) |
| work | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-570) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3229) |
| record | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=10-209) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=10-473) |
| paper | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-644) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3282) |
| chapter | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-747) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3360) |
| issue | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-848) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3436) |
| edit work | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-947) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3510) |
| edit record | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1026) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3572) |
| credits | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1140) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3672) |
| files | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1216) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3729) |
| contributors | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1308) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3802) |
| contributor | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1383) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3860) |
| edit contributor | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1456) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3914) |
| review | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1550) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-3995) |
| collections | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1613) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4041) |
| collection | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1666) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4077) |
| tags | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1746) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4141) |
| saved | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1816) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4194) |
| serials | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1872) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4233) |
| serial detail | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-1928) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4272) |
| import | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2024) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4355) |
| import results | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2087) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4401) |
| pdf | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2152) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4449) |
| epub | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2193) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4483) |
| notes | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2234) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4517) |
| settings | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2293) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4559) |
| appearance | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2364) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4614) |
| opds | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2432) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4665) |
| activity | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2493) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4709) |
| more | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2565) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4764) |
| empty | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2639) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4821) |
| offline | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2689) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4854) |
| notfound | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2739) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4887) |
| loading | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-2783) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4914) |
| organization | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=32-1559) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=32-2608) |

## Forms, inline states, dialogs and sheets

These retain their original frame links; their presentation follows the implemented frontend.

| Dialog | Desktop | Mobile |
| --- | --- | --- |
| add | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4946) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6298) |
| upload | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4963) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6314) |
| upload progress | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-4990) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6340) |
| file error | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5020) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6369) |
| upload rejected | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5037) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6385) |
| lookup | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5050) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6397) |
| metadata preview | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5066) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6412) |
| lookup error | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5115) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6460) |
| lookup not found | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5133) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6477) |
| lookup rate limit | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5150) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6493) |
| lookup provider | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5167) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6509) |
| duplicate | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5184) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6525) |
| duplicate confirm (retired) | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5202) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6542) |
| identifier | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5217) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6556) |
| add edition (retired) | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5241) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6579) |
| record menu | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5264) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6601) |
| reading status | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5285) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6621) |
| filters | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5302) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6637) |
| sort | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5351) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6689) |
| save search | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5374) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6711) |
| bulk tag | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5394) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6730) |
| bulk move | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5412) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6747) |
| delete record | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5431) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6765) |
| delete work | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5446) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6779) |
| remove file | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5465) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-829) |
| delete collection | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5480) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-843) |
| delete tag | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5495) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-857) |
| delete contributor | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5510) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-871) |
| delete note | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5525) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-885) |
| delete account | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5540) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-899) |
| collection edit | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5559) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-917) |
| reorder | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5582) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-939) |
| tag edit | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5604) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-960) |
| choose contributor | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5628) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-983) |
| paste names | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5669) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1023) |
| identity name | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5696) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1049) |
| merge | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5729) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1081) |
| merge conflict | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5747) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1098) |
| force merge | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5768) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1118) |
| split | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5787) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1136) |
| distinct | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5816) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1164) |
| link version | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5832) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1179) |
| add container | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5860) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1206) |
| serial edit | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5888) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1233) |
| issue edit | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5914) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1258) |
| expected issues | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5949) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1294) |
| csv map | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-5968) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1312) |
| annotation | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6019) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1365) |
| annotation export | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6045) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1390) |
| citation export | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6061) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1405) |
| reader settings | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6086) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1429) |
| reader notes | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6116) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1458) |
| toc | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6138) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1479) |
| go page | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6160) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1500) |
| note filter | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6175) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1514) |
| download | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6197) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1535) |
| file role | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6213) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1550) |
| cover | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6230) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1566) |
| change password | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6249) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1584) |
| signout | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6270) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1604) |
| unsaved | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=13-6283) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=17-1616) |

## Additional implemented states

| State | Desktop | Mobile |
| --- | --- | --- |
| ai | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1609) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2629) |
| agents | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1610) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2630) |
| workers | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1611) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2631) |
| tag detail | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1612) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2632) |
| djvu | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1613) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2633) |
| manual add | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1614) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2634) |
| selection menu | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1615) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2635) |
| history | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1616) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2636) |
| source results | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1617) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2637) |
| ai unavailable | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1618) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2638) |
| agent token | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1619) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2639) |
| worker command | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1620) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2640) |
| ai queue paused | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1621) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2641) |
| standard | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1622) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2642) |
| thesis | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1623) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2643) |
| report | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1624) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2644) |
| remove identifier | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1625) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2645) |
| bulk delete | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1626) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2646) |
| csv import | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1627) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2647) |
| metadata public search | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1628) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2648) |
| cover controls | [Desktop](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-1629) | [Mobile](https://www.figma.com/design/ywJrgCQb0yXsVkSEf2f7J3?node-id=48-2649) |
