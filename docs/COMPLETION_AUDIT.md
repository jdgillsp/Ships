# Ship and multiplayer polish completion audit

Audit date: 6 September 2026. Checkout: `F:\projects\Ships`, `main`, base commit `ae30cdd1746e0fda2f01ccd2a4dd4cee047169a4`, with the preserved local implementation. Production bundle: `index-D14gx7MQ.js`.

The scope is the user's requested ship-based multiplayer game and subsequent feedback: steering and camera controls, Q/E first-person turning, ship flicker, useful activities away from the helm, model quality consistent with the original ocean, and less intrusive UI. Completion was checked against that whole experience, including a complete cooperative mission, rather than only the most recent cloud change.

| Requirement | Current evidence | Result |
| --- | --- | --- |
| A playable cooperative ship expedition | `tools/shots/game-quiet/result.json`, completed 2026-09-06T07:56:53.993Z: two independent browser clients depart, reach the wreck, attach and lift cargo, board, reload/rejoin, return and deliver; both finish connected. | Pass |
| Multiplayer ownership and recovery | The same complete voyage exercises a captain disconnect, station release, takeover and automatic reconnect. `tools/final-test-helm-browser.log` verifies shared instruments and helm handoff. | Pass |
| Up to four crewmates | `tools/shots/full-crew/result.json`, 2026-09-06T08:01:37.685Z: four authenticated players, fifth rejected, crew identification/occlusion, captain preservation, rejoin/takeover, and 1280/600/390 px layouts. | Pass |
| Intuitive steering with an independent camera | `tools/final-test-helm-browser.log`: native right/left steering, centering, shared instruments, console collision, handoff. `tools/shots/first-person-turn/result.json`, 2026-09-06T07:59:56.216Z: looking at the helm does not steer. | Pass |
| Q/E first-person turning | The current first-person test covers deck, helm, winch, diving and binoculars; opposing keys, saved sensitivity at 0.5x/1x/2.5x, station exit continuity, view-relative walking and Space/Ctrl depth controls. | Pass |
| Ship flicker and camera overlap addressed | `tools/final-test-ship-browser.log`: rigid translation changes at most three pixels above the luminance threshold; stationary-screen motion is 0.000075 px, real motion remains, work lights stay stable, overlapping crew are hidden in the relevant camera/water copies. | Pass |
| Meaningful activities away from the helm | `tools/final-test-activities-browser.log`: a second player scouts while the captain retains control, shares navigation, dives and studies wildlife, opens the journal, changes duties, and uses phone layouts. | Pass |
| Immersive but usable UI | `tools/final-test-immersive-browser.log`: quiet default, contextual action, Activities/Chart/Tools access, keyboard and modal isolation, depth/survey readings, crew acknowledgements, touch/narrow layouts and saved preferences. The ordinary desktop footer is 33 px high. | Pass |
| Visual quality and continuity | Independent timestamped PASS in `docs/PRESENTATION_REVIEW.md`, covering ship hardware, crew, notebook, live sky and binocular composition. Root also inspected the current full-voyage wreck, dive, recovery and delivery captures, plus the current phone notebook. | Pass |
| Cloud quality retained across practical views | `tools/shots/cloud-sampling/result.json`, 2026-09-06T07:49:33.244Z: production coverage comparison, GPU cost, day/golden/storm captures at 3.6/200/1000 m. `tools/shots/cloud-live/result.json`, 2026-09-06T07:51:36.073Z: live play and native Medium/High/Low transitions preserve the intended refresh budgets. | Pass |
| Build and simulation integrity | `tools/cloud-sampling-build.log` and `tools/cloud-sampling-logic.log`: production build, all 82 game checks, adaptive-quality checks, and all underwater, connected-ocean, fauna, animal-motion and biome simulations pass. Current cloud continuity also passes in `tools/cloud-sampling-continuity.log`. | Pass |
| Result available without disrupting the active voyage | Read-only check after the final browser suite: `http://127.0.0.1:8790/api/health` reports healthy, one persistent room, no persistence error; the frontend serves `index-D14gx7MQ.js`. No live-server restart, user-tab reload, commit or publication was performed. | Pass |

All final browser-suite processes completed successfully and reported no unexpected browser errors. The complete voyage intentionally injects a temporary network fault; its expected network errors are separately recorded.

Evidence limits are retained: the four-player capacity check uses one rendered browser and three authenticated API peers, while the complete mission and helm tests use two independent rendered clients. The voyage driver automates steering/swimming through the game's input state; station and mission actions use real keyboard shortcuts. Static art review does not replace the separate motion tests. Lower-resolution clouds retain some grain, and local GPU timings are not cross-device frame-rate guarantees.

No required item from the user's stated scope remains unimplemented or unverified in this audit. The working build is ready to play; an already open browser page needs a refresh to load the latest frontend.
