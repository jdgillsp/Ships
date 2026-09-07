# Player experience review — 2026-09-07

The main friction is knowing what to do and how to do it. The quieter interface improves the view, but removes information before a new player has learned it. Prioritize guidance and transitions before adding activities.

Scope: manually reviewed a separate fresh voyage through briefing, deck spawn, helm entry, anchor raising, full tools, crew notebook, voyage chart, entering the water and boarding again. Inspected control dispatch, activity recommendations and nearby-station guidance. This is an expert walkthrough, not a new multiplayer playtest or a complete salvage run. The user's existing voyage was not used for these actions.

## 1. High: teach essential controls before hiding them

Observed: after Begin expedition, the player faces the cabin wall with only Take helm visible once the toolbar fades. Entering the helm shows heading, speed and Raise anchor, but no steering or camera explanation. The controls exist in Tools and a collapsed notebook section. The same issue appears when diving: depth and Climb aboard appear without first-use ascent/descent guidance.

Change: short, contextual first-use hints for deck movement, helm steering and underwater movement. Introduce Q/E camera turning and C view switching where they apply. Dismiss each hint after the relevant action succeeds; retain a discoverable Help control. Gate initial toolbar fading on that brief introduction, rather than elapsed time alone.

Success: a first-time player can steer, look around, leave the helm and ascend without searching Settings.

## 2. High: recommendations must follow the active mission

Observed: the briefing says recover the archive. At the helm, the notebook instead recommends Plan the next dive, which opens a chart preselected to Coral cathedral and offers 15 optional sites. This competes with the mission before the first voyage is understood. CrewActivities chooses navigation as its default recommendation.

Change: recommend the next achievable salvage step first, with its prerequisite and destination. Keep optional habitat exploration clearly available below it. For a crewmate without the helm, recommend a useful task that supports that same step.

Success: the briefing, notebook recommendation and navigation target agree throughout departure, anchoring, attachment, lifting and return.

## 3. High: guidance must explain missing prerequisites

Observed: entering the water beside the starting dock with the anchor raised changes the mission instruction to swim within 5 m of the archive and attach the cable, although the ship is still about 197 m away and not anchored over it. Other screens explain the prerequisites, but the immediate instruction does not.

Change: show the actual next blocker: sail the vessel to the wreck, anchor above it, then dive and attach. Preserve free swimming, but distinguish exploration from a recovery attempt. Offer an appropriate crew request when another player can resolve the blocker.

Success: following the primary instruction never leads to an unavailable action with an unexplained prerequisite.

## 4. Medium: quiet navigation needs a deliberate glance view

Observed: the quiet underwater view presents a small edge arrow. Opening Tools reveals the useful explanation: Archive signal, 197 m, behind you. Full tools restore several large panels at once.

Change: a brief navigation glance should expose destination name, bearing, distance and the current task without opening the complete dashboard. Preserve nearby-action prompts and the unobstructed default view.

Success: players can identify where an arrow leads and why without interrupting movement to inspect menus.

## 5. Medium: boarding should lead naturally back to deck activity

Observed: Climb aboard immediately becomes Enter water on the same F key. The return toast helps, but the strongest prompt invites the player to undo the transition.

Change: add a short protection against rapid reversal and briefly orient the player toward deck movement or the next useful duty. Keep deliberate re-entry easy.

Success: repeated interaction during boarding does not accidentally return the player to the sea.

## Preserve

The consistent F interaction, readable anchor state, explanations for disabled winch controls, paper notebook, and immediate boarding feedback work well. Keep the quiet default and nautical presentation. Make information appear when it answers a current question; replacing all text with icons would make these discovery problems worse.

Recommended implementation order: mission-aware guidance and recommendations; first-use controls; navigation glance; transition protection. Verify each with first-time playthroughs, then repeat with a second crewmate and touch input. No gameplay changes were made during this review.

## Implementation

All five recommendations are implemented. Guidance.js now provides a shared, prerequisite-aware salvage step for the mission panel, notebook and navigation glance. The notebook prioritizes Current mission and labels habitat detours as optional; an explicitly plotted crew course still takes precedence. Divers outside cable range receive a return-to-ship target instead of an instruction to attach an unavailable cable. Appropriate anchor and winch requests remain available when another crewmate can help.

PlayerHelp teaches deck, helm, diver and winch controls on first use. A hint stays until successful movement/work has occurred for the introduction period or the player chooses Got it. Learned roles are saved locally; Help [?] restores the current role's hint. Initial toolbar fading waits for that introduction. Bearing [K] shows destination, range, compass bearing and the next step for seven seconds without opening a modal or stopping input.

After a diver returns to the deck, a 1.4-second client interaction guard prevents immediate re-entry from F, V, the tools button or activity actions. The readout briefly explains that the player is back aboard and can walk away from the ladder. This is an input comfort feature; authoritative simulation rules are unchanged.

Validation: all 83 game logic checks pass, along with the new UX browser walkthrough and the existing immersive UI, idle-controls, two-player activities and touch-stick suites. The walkthrough uses native controls to verify first-use visibility, successful-movement dismissal, restored Help, persisted learning, mission ordering, nonmodal navigation and expiry, cable-range guidance, and boarding protection. Desktop and 390 px screenshots were inspected. Touch tests include independent camera dragging, helm control, simultaneous swimming/depth input and modal resets. Idle-control testing additionally exposed a queued dialog-focus race; fresh clicks into the scene now take precedence over the earlier keyboard dismissal. No runtime errors were reported by the passing browser suites. The production build is served by the healthy local server on port 8790.
