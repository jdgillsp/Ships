# UI standards review — 7 September 2026

## Evidence and design decisions

This review covers the expedition's DOM interface including the launch screen, HUD, instruments and modal tools. The objective is readable, predictable controls with a quiet nautical identity. It is not a claim of WCAG conformance or universal superiority over other games.

Primary sources consulted:

- [Xbox Accessibility Guideline 101: Text display](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/101): consider HUD, menus, notifications and configuration together; support player-adjustable text. Its rendered glyph-height recommendations are not interchangeable with CSS font sizes. Implemented a 14px CSS floor for expedition labels, preserved larger headings, and added 100–200% text scaling. This improves the previous 7–13px baseline; it does not establish XAG glyph-height conformance on every device.
- [Xbox Accessibility Guideline 102: Contrast](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/102): assess text and important visual cues against changing backgrounds and offer contrast options. Essential readouts now have dark backing; players can give instruments solid backgrounds. Paper dialogs retain their existing opaque backing.
- [WCAG 2.2 Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): the AA minimum is 24 CSS pixels, with stated exceptions. This implementation targets 44px control dimensions instead, including mouse-operated buttons. Inline links and custom canvas map points are separate cases; chart destinations have a native select alternative.
- [WCAG Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): normal text generally needs 4.5:1 and large text 3:1. Dark backing reduces variation from ocean lighting; not every composited pixel or disabled state is certified by this review.
- [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): named dialogs, focus inside the dialog, contained tab navigation, Escape dismissal, and a visible close control. The game uses native modal dialogs; the previously unnamed Settings dialog now references its visible title. Existing pointer/keyboard focus-return handling remains intact.

## Surface inventory and changes

| Surface | Audit finding | Treatment |
| --- | --- | --- |
| Launch / join / recent voyages | Small briefing and form labels | Larger type, existing explicit primary action, scrollable launch layout |
| Quiet HUD / primary action / Help | Tiny buttons and changing ocean background | 44px targets, readable labels, dark backing, keep idle fade and recalled help |
| Full and compact ship tools | Inconsistent label sizes; crowded controls | Shared scalable type, wrapping action groups, bounded scrollable console |
| Bearing glance / world markers | Small labels on bright water | Scale labels and reinforce local backing; retain contextual visibility |
| Mission / survey / recovery | Small percentages and instructions | Shared scale; retain labeled progress elements and mission-first guidance |
| Crew notebook / manifest | Narrow phone action columns | Stack phone actions below content; larger labels; readable disabled controls |
| Settings / controls | No text-size option; unnamed dialog | 100–200% saved scale, solid instrument backing, explicit dialog name, larger sliders/checkbox rows |
| Voyage chart | Small surrounding metadata | Scale DOM legend, native destination picker and route details; keep chart geography |
| Field journal / photo captions | Small metadata and download text | Scalable text, wrapping headers and existing scrollable paper pages |
| Wildlife observation / optics | Small notes, dense footer | Scalable text, wrapping actions, optional solid instrument backing |
| Crew radio / acknowledgments | Tight button grids | Larger targets/type; single-column choices with large text |
| Invite / copy / connection / save errors | Small status copy | Shared larger text; retain existing explicit copy/save feedback and recovery actions |
| Delivery log | Small paper text and buttons | Shared scale, hit targets and existing explicit return-to-ship action |
| Touch movement / depth | Existing gesture continuity must survive layout changes | Keep independent gesture logic, enlarge text, verify actual multitouch flow |
| Legacy explorer / simulation panel | Source inventory found small labels, but this panel is hidden by the current free-dive interface | No speculative changes to this inactive surface; free-dive mode is a separate follow-up scope |

## Implementation notes

Typography is scaled through `--ui-text-scale`, not page zoom or a transform, so content reflows and pointer coordinates stay unchanged. At 150% and above, long dialog headings stop sticking to the viewport so they cannot consume the entire scroll area. Defaults and malformed saved preferences normalize safely. Reduced-motion preferences disable interface transitions. No runtime dependencies or external visual assets were added.

Remaining limits: the game world is still a visual 3D experience, and this is not a screen-reader-complete gameplay implementation. Rasterized nautical map annotations do not inherit DOM text scaling; destination names and details remain available in the adjacent native selector. Separate free-dive screens have not undergone the expedition's full behavioral regression matrix.

## Validation

See `tools/ui-uplift-browser.mjs` and logs under `tools/ui-uplift-*`. The dedicated browser check measures seven dialogs at desktop and phone widths, at 100% and 200% text, for named dialogs, control dimensions and horizontal overflow. Screenshots are under `tools/shots/ui-uplift`. Existing game logic, touch and guidance suites supplement that structural check. Final outcomes are recorded after execution.


### Contrast findings

Measured sRGB pairs exposed paper metadata at only 3.92:1 (`#596951` on `#d7d3c1`). It is now darker (`#4d5b45`). Other checked pairs: paper body text 5.33:1, recommendation text 4.58:1, light HUD text on solid instrument backing 12.48:1, disabled dark-control text 6.01:1, and the paper primary action 5.90:1. These are palette measurements, not a claim that every rendered frame meets the same ratio. The selected chart marker was also darkened to improve its numeral contrast.

The touch toolbar now omits keyboard shortcut suffixes on coarse-pointer devices, allowing its primary tools to fit in one phone row without reducing targets. Shorter touch camera guidance avoids overlapping depth buttons. Enlarged-text dialog checks use real chart/journal opening paths so lazy chart initialization is exercised.


The expanded tools also become a vertically scrolling instrument page at large text sizes. A dedicated phone check verifies that this page has no horizontal overflow. Repeated Tab navigation now loops within the active modal; the test checks 22 successive focus steps. Native keyboard adjustment of text size updates the interface and saved preferences, and the solid-background checkbox persists. Help synchronizes the current role before handling its toggle, avoiding a boarding-transition race.

Dialog dismissal also preserves the underlying Help layout, preventing toolbar movement during a quick follow-up click.

Final verification: production build passed; 83 logic checks passed; 28 dialog layouts passed at desktop/phone widths and 100%/200% text. Native keyboard text adjustment, persisted settings, 22-step modal tab navigation, and the enlarged full-tools page passed. Touch movement, gameplay guidance and immersive-view browser suites passed with no runtime errors. The local server on 8790 reports healthy persistence and serves the current built index. Screenshots were visually inspected for notebook hierarchy, phone HUD, chart, enlarged settings and the enlarged instrument page. Raster map labels and the separate free-dive UI remain outside the text-scaling coverage noted above.
