# Kestrel expedition guide

**The lost archive** is one complete cooperative salvage mission for 1–4 people sharing a cutter. All art is generated from geometry and shaders. The ocean, reefs, wildlife, kelp forest, slope and trench remain available; the expedition uses a fixed seed and a shallow site beside the reef so every crew member sees the same mission terrain.

## Run and invite

Use Node.js 20.19+ or 22.12+ as specified in `package.json`.

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:8787`, enter a crew name, and choose **Begin expedition**. **Invite crew** provides a private link. Other players enter a name and choose **Join the crew**. A room has four crew slots; the player holding a station is shown in the crew list.

New browsers suggest an editable nautical callsign instead of naming every player Captain. A successful join remembers your name on that browser for later voyages. Rejoining keeps the existing crewmate's identity and does not assign the helm automatically. `npm run test:crew-name:browser` checks fresh invites, immediate scouting, name preferences, rejoining and phone layout.

For development, use two terminals:

```sh
npm run server
```

```sh
npm run dev
```

Use the URL Vite prints, usually `http://localhost:5173`. The Vite proxy sends `/api` to `127.0.0.1:8787`. `npm run preview` only previews static assets; use `npm start` to test the complete production game.

## Play the mission

The **voyage chart [N]** also offers fifteen habitat surveys for this crew, before or after the archive recovery. Plot a destination, sail there, and dive to its underwater signal. Within 18 m of the signal at its actual depth, **hold X** or the **Hold to survey** button. A survey takes eight seconds of combined diver effort: two scanning divers finish in four seconds. You can swim and look around while scanning; leaving range or releasing the control pauses your contribution. Progress is kept when changing course.

Completed surveys turn green on the chart and show the contributors and completion time. The shared count and progress are visible to the crew, including aboard players. Clearing a course restores archive guidance without erasing the survey log. Survey records, including unfinished scans, are saved with the expedition and survive server restarts. The wildlife field journal remains a separate personal collection.

`npm run test:survey:browser` uses an isolated two-client room to verify keyboard and pointer holds, cooperative speed, pause/resume, dialog input isolation, shared completion, chart records, rejoin and 600/390 px layouts. Pure tests verify location, depth, connection and input validation, stale controls, contribution attribution, course changes and one completion per site.

1. **Depart.** Take the helm, raise anchor, and hold W to sail south toward the yellow survey buoy. The chart shows heading and distance. S reverses; releasing throttle lets momentum decay. A/D steer. The anchor stops the cutter and holds it in place.
2. **Locate and dive.** On arrival, deploy anchor near the buoy. Once speed drops below 2 m/s, choose Enter water. Swim down toward the wreck; the orange crate lies beside it. Its distance appears in the control strip. The ship must be anchored within 32 m of the crate to attach the lifting cable.
3. **Attach.** Within 5 m of the crate, choose Attach lifting cable or press F. The mission changes for the whole crew. Return toward the cutter and ascend near it; Climb aboard becomes available within 13 m horizontally and 3 m of the surface while the cutter is moving slowly.
4. **Recover.** An aboard crew member chooses Operate winch. It lifts automatically while the cutter is anchored within range. In solo play, climb aboard first and operate it yourself. The crate visibly rises and is secured on deck. Leaving the winch or losing its operator pauses recovery without losing progress.
5. **Return.** Recover your divers, take the helm, raise anchor, and turn north to Pelican Station. Slow or anchor within 24 m of the station, then choose Deliver archive. Every connected player receives the completion screen. The crew can continue sailing afterward.

The storm grows after locating the wreck. It changes the shared swell, visibility, sky, rain, and ship motion. There is no instant deadline or sinking failure in this first mission. The safety beacon returns a stranded diver to the cutter, so a solo expedition cannot be lost because the ship drifted out of reach.

After delivering the archive, the squall gradually passes. Rain, wind and swell ease together over at most about 77 seconds of active voyage time. Clearing resumes from the saved sea state if the crew leaves and returns; subsequent habitat exploration keeps the calmer weather.

The delivery is recorded in a voyage log with elapsed time, the crewmates present and who brought the archive ashore. Ship shortcuts are isolated while the log is open. Return aboard, plan another dive or open the field journal directly from the log. It remains available under **Activities → Delivery log**; rejoining a finished voyage does not replay the completion screen or change the recorded time.

Two sheltered work lamps above the cabin's rear wall light the winch deck as daylight fades or rough weather builds. Their warm illumination follows the cutter's motion and is blocked below its solid deck. They operate automatically, leaving your hands free for sailing and recovery.

The wreck has breached plating, exposed frames, an open wheelhouse with its old helm, an engine and shaft, bent rails, a collapsed mast and scattered seabed panels. The buoy's mooring line leads down to a seabed weight beside the site. Corrosion is procedural and responds to the same water absorption and dive light as the vessel materials. The archive remains beside the wreck with an unobstructed lifting path.

`npm run test:wreck:browser` captures the site in daylight, dusk and storm conditions, at approach, close and wide distances, and beside the mooring. It checks the mooring endpoints and records geometry counts and GPU timings. `npm run test:game` checks finite geometry and clearance across the archive's lifting footprint. The ship GPU and two-client recovery harnesses cover motion stability and the actual lift sequence.

| Control | Use |
| --- | --- |
| W / S or up / down arrows | Walk forward / backward on deck; hold ahead / slow and reverse at helm; swim forward / backward underwater |
| A / D | Step left / right on deck; left / right rudder at helm; strafe underwater |
| Ctrl / Space | Descend / ascend underwater |
| Q / E | Turn your view left / right in first person, underwater or through binoculars |
| Drag on the ocean | Orbit ship camera or aim the dive view |
| Left / right arrows | Step sideways on deck; steer at helm; turn the dive view underwater |
| F | Use the highlighted action; nearby helm/winch controls take priority while walking |
| B | Raise / deploy anchor while aboard |
| V | Enter the water when moving slowly |
| R | Operate / stop winch when available |
| C / View button | Switch first-person deck and character-follow views while walking; ship chase/deck views at stations |
| I / Esc | Open ship tools / return to the sea |
| L / Binoculars button | Raise / lower binoculars while on deck; Esc also lowers them |
| G / Mark view button | Mark the location you are looking at for the whole crew |
| Z / Call crew | Send a quick crew call or acknowledge a teammate's request |
| O / P / J | Observe wildlife while diving / photograph an identified animal / open the field journal |
| T / Light button | Cycle the dive light through Automatic, On and Off |
| N / Voyage chart | Choose a habitat and plot a shared crew course |
| Click the chart | Place a shared mark on the water |
| Scroll wheel | Zoom the chase camera |
| Home / double-click ocean | Recenter the current camera and reset zoom; level and align the dive view |
| Sound button | Enable / mute ocean ambience, vessel sounds and diving audio |

Every station action also has a labeled button. On touchscreens, the left thumb control gives proportional movement: drag a little to move gently, or farther for full input. It walks on deck, controls throttle and steering at the helm, and swims underwater. Drag the water with another finger to look around. Divers also have **Up / Down** buttons that can be held while swimming. Release a control to stop that input. Opening a menu or changing stations cancels held movement; closing a menu requires a fresh gesture. The thumb controls stay above the footer and keep their position during a held gesture even when status text changes.

Only one player can occupy the helm or winch at a time. Players do not need permanent roles. Off the helm, WASD walks around the deck relative to the view. Drag to look and use C to switch first-person and character-follow views. Crew positions are shared with other players and move with the cutter. Cabin walls, deck equipment and railings block walking; use Enter water to dive. Station buttons remain available so you can quickly switch roles. Disabled controls explain whether the ship is too fast, the cable is missing, or another crewmate occupies the station.

Walk up to the foredeck helm or the winch lever to make **F** use that station. A short status line names the current operator or explains a missing cable, anchor or lifting range. An occupied or unavailable nearby station does not redirect F to equipment elsewhere on deck. Away from stations, the usual mission interaction returns; archive delivery still takes priority at the destination. **H**, **R**, and the full Tools buttons remain available for quick station changes. `npm run test:deck-interaction:browser` walks the deck using real controls, operates both stations, checks another crewmate's occupancy, and verifies narrow layouts.

Tab moves between controls; Space or Enter activates the focused button. A focused survey button uses these keys for its hold action. Mouse and touch clicks return movement control to the game, so Space can ascend after clicking a dive control. Keyboard activation retains focus for continued navigation. `npm run test:input:browser` checks arrow walking, native button activation, station transitions and the distinction between activating a dive control and swimming upward.

While walking, **C → View: follow** keeps the outside camera near your crewmate. Drag to orbit and scroll to adjust its distance. The view rises or shifts slightly around the cabin, winch and stern frame, and checks clearance after smoothing. Your chosen views for deck, helm and winch are remembered separately in this browser, including after reloading. Returning to a station restores that view; the close helm view also faces its instruments. Home resets the camera and zoom without changing your chosen view. New players start with first-person walking, ship chase at the helm and a close winch view.

Stepping away from the helm or winch keeps your viewing direction when both the station and walking views are first person. You can look toward a crewmate or along the deck, leave the controls, and walk in that direction without the camera turning back toward the bow. Choosing a follow/chase view still restores that role's camera normally.

**Settings → Look sensitivity** adjusts both dragging and keyboard turning, including Q/E in first person and left/right arrows underwater. The default remains 1×; reduce it for slower turns or increase it for faster turns. Binoculars and wildlife observation additionally slow aiming with magnification. The setting is personal and saved in this browser. `npm run test:first-person-turn:browser` checks native slider changes at 0.5×, 1× and 2.5× on deck and underwater alongside station transitions and movement controls.

**I**, or **Tools**, opens or closes ship tools in immersive play. **Settings → Tools panel detail → Compact** reduces coverage within that panel by collapsing its chart and detailed mission instructions. **N** opens the full voyage chart. Settings are saved in this browser and do not affect crewmates; shortcuts stay inactive while dialogs are open.

`npm run test:deck-camera:browser` checks real walking with the camera following, zoom/reset, view preference across helm and dive transitions, stable binocular return, orbit clearance and player framing above phone controls. Pure tests sample view angles and distances around the cabin, cargo and stern supports, including pivots close to their safety padding.

**Crew activities →**, beside the guidance in the ship console, gives everyone a place to choose what to do next. It shows the current captain, live crew stations, and cards for planning a dive, scouting, entering the water or studying wildlife, and archive recovery. Each card has a direct action and explains its requirements. Suggested activities follow the crew and voyage state. Choosing scouting from the helm or winch releases that station and raises binoculars once the transition arrives. Opening the panel clears held movement and pauses shortcuts; it does not pause your crewmates.

The notebook's **Crew manifest** lists each connected crewmate on a separate ruled row, with their name and current duty. Your own entry is marked **You**. Diving depth and active surveying update while you read, so you can see what the rest of the crew is doing without keeping a roster over the ocean view.

Blocked activities can also offer a crew radio request. Passengers can ask for a slower approach before diving, and divers can ask an aboard crewmate to hold position within cable range or operate an attached archive's winch. The request uses the normal shared radio, acknowledgement and three-second cooldown. The notebook stays open and updates as the crew responds: slowing enables diving, anchoring removes the hold-position request, and taking the winch removes the operator request. Requests are absent when no other connected crewmate is aboard. `npm run test:activity-requests:browser` verifies the two-player flow and desktop/phone layouts.

The notebook also includes a collapsed control reference for your current role. Open it for deck walking, helm steering, diving or winch instructions; touch devices receive thumbstick, depth-button and menu directions. The reference explains camera movement separately from steering and stays inside the notebook. Close the notebook to use the controls. `npm run test:notebook-controls:browser` checks all four roles with keyboard and touch, native fold-out activation, modal input isolation and layout.

With a habitat plotted, the panel adds a survey briefing showing the site's depth, your distance, shared progress and the names of active scanners. Aboard players can enter the water when the cutter is slow enough. Divers can choose **Follow survey signal** to restore course guidance, or **Show survey controls** when in range. The latter focuses the existing hold button: hold Space/Enter, X, or the pointer to contribute; opening the briefing never starts a scan. Completed briefings credit the contributors and offer the next habitat. The crew roster shows **Surveying** only while the server confirms an eligible, unfinished scan; releasing input, leaving range, disconnecting or finishing the site clears that status.

`npm run test:activities:browser` verifies two-player scouting with the captain retaining control, shared course plotting, diving and wildlife study, journal access, movement isolation, station release into lookout view, and phone layouts. Captures are under `tools/shots/activities`.

For lookout duty, leave your station and walk along the side deck to the bow. Press L to raise binoculars, drag to aim, and scroll between 2× and 6× magnification. The **− / +** controls beside the magnification readout adjust it in half-step increments and work by touch, click or keyboard activation. They disable at the limits. The optical view shows the direction you are looking and retains objective signals while clearing the large panels. WASD still walks. Lowering binoculars restores the previous deck or chase view and retains the chosen magnification for next time; diving, opening the invite dialog, and resetting the camera also lower them. Camera cuts and magnification changes clear stale temporal rendering history.

`npm run test:binocular-zoom:browser` checks native pointer/touch controls, keyboard activation, real camera field of view, zoom limits, wheel units, steady aim/position and desktop/phone layouts.

Touch lookouts can keep walking with the left thumbstick while aiming with another finger. Zoom, marking and lowering binoculars accept a separate finger's tap while the movement thumb is held. Raising or lowering the optics releases held movement; begin a fresh drag to continue walking. A drag away from an optics button cancels its activation. The stick stays clear of the reticle and lower action row in portrait and landscape views.

Sound starts only when you enable it. The original procedural surf, water, reef and distant wildlife ambience is joined by an engine that responds to speed and distance, underwater muffling and breathing, rain, deck footsteps, anchor and boarding sounds, winch machinery, and brief recovery confirmations. All layers share one audio context, limiter and mute control; background tabs mute automatically. No recorded assets or microphone access are used.

Lookouts can aim at the buoy with binoculars and press G to call it out to the captain. Divers can mark the seabed or submerged objects, and anyone can click the chart to mark a location on the water. The crew receives a named mint-colored marker, a chart ring, and a short sound cue when audio is enabled. Marks last 18 seconds, with one mark per player and a two-second cooldown. The server checks range, position, and identity; clients cannot supply another player's name or arbitrary marker text. Closely grouped marks share one label to keep the view legible.

When another crewmate is connected, **Call crew [Z]** offers quick requests: slow down, hold position, ready to dive, pickup, a winch operator, or thanks. Calls appear in the ship console; **On it** acknowledges a request for everyone. Acknowledging pickup selects the diver's live navigation marker while leaving steering manual. The call panel also shows the current requests. Calls have a three-second cooldown, one active request per sender, and a 25-second lifetime. The server supplies sender identities and validates call types and acknowledgements. Calls clear when their sender leaves, when a pickup requester boards, or when resuming after a server restart. A helper who disconnects releases their acknowledgement. Brief procedural tones follow the existing Sound toggle and volume setting.

`npm run test:calls:browser` verifies two clients exchanging and acknowledging calls, pickup tracking without helm takeover, one sound cue per received call, modal input isolation, expiry/disconnect cleanup and layouts at 600 and 390 px. Pure tests cover spoofed senders, invalid call types, stale/self acknowledgements, cooldowns, replacement, boarding and reconnects. The persistence test verifies calls are not replayed after a restart.

**Settings** in the top bar contains graphics quality, look sensitivity, inverted vertical look, volume, and a control reference. Preferences are saved on that browser. Explicit graphics parameters in a URL take precedence when opening it. Automatic quality adapts to the device; fixed settings let you choose more detail or smoother performance. Opening a dialog clears held movement inputs while the shared expedition continues.

## Shared voyage chart

Press **N** or click **Voyage chart** above the small chart to browse 15 destinations: the four main habitats and eleven outer reef, forest, slope and abyssal sites. The map uses the cutter's compass orientation and shows the ship, divers and a proposed surface route. Select a numbered site or use the destination list to see its description, sailing distance, bearing and dive depth.

**Plot crew course** shares a habitat waypoint with the whole crew. Any connected crewmate can plan the trip while the captain retains helm control. Sail there, anchor and dive; the marker then guides divers toward the habitat's arrival position below. The chart continues to measure the sailing bearing from the ship even when its user is diving. For deep habitats, the listed depth makes the long descent explicit.

While a course is active, **Navigation focus** below the small chart can show **Kestrel · return aboard**, the course, or a crewmate. This focus choice affects your own beacon. To return the whole crew to salvage guidance, reopen the voyage chart and choose **Resume mission guidance**. Plotting and clearing a course preserve cargo and salvage progress. The course survives rejoining the room; the server validates destination IDs and records the actual navigator's identity. The completion screen also offers **Explore more dive sites**.

`npm run test:voyage:browser` creates its own two-player room and verifies map selection, keyboard isolation, shared plotting with independent helm ownership, real sailing/anchoring at the reef, diving, return-to-ship focus, narrow charts, course persistence on reload and restoration of mission guidance. Screenshots are under `tools/shots/voyage`.

## Wildlife studies

The dive light defaults to **Automatic**: bright shallows retain natural sunlight, while deeper or darker water gradually brings up the beam. Press **T** or click the Light button for **On**, **Off**, then **Automatic**. Boarding extinguishes it. Night and deep dives use the original explorer's exposure limit so the camera does not brighten the beam excessively. Manual mode lasts for the current visit.

The lamp uses a softer falloff near the camera to preserve pale animal markings. Water absorbs its light on the way to the subject as well as on the return to the diver, using the current water color and clarity. `npm run test:night-fauna:browser` checks actual rendered animal pixels for excessive whitening and verifies they remain clearly lit compared with the lamp switched off. Add `-- --profile` for an alternating GPU comparison with the previous lamp formula in the same scene.

`npm run test:dive-light:browser` checks the real T/button controls and automatic light in fixed daylight, dusk, storm, night and deep-water fixtures. It checks narrow layouts, manual Off in the abyss, and restoration of the ship's exposure and camera controls on boarding. Screenshots are saved in `tools/shots/dive-light`.

Divers can choose **Observe [O]** to identify animals in view. Keep the same animal visible for a moment to record it, or click another visible animal to select it. Quiet mode uses small viewfinder brackets and softly shaded annotations for the animal's name, behavior and distance alongside the lens and photography controls. Expanded tools retain the panel and ring. Expand **Field notes** for the description and record status. Notes start collapsed each time observation opens, leaving more of the water visible. Swimming and looking remain manual. On touch screens, keep the swimming thumbstick held while another finger adjusts the lens, takes a photograph or reads the field notes. Opening the field journal releases the held swimming gesture. Terrain, rocks and expedition equipment block identification. Closing observation with O or Esc restores the mission panel, and boarding ends the study automatically.

Press **J** for the field journal, or open it from the observation card or Settings. Sightings stay in this browser and use the same journal as free exploration. They are personal observations of local wildlife, not synchronized crew objectives. The salvage mission continues while studying; after delivery, the crew can keep sailing and diving to find more animal groups.

`npm run test:naturalist:browser` uses an isolated reef-arrival fixture and the production game to identify rendered wildlife, save sightings, swim while observing, select an animal with the pointer, open the journal, board, and reload. It checks phone layouts and opens the original exploration UI to verify shared journal compatibility. Screenshots and study CPU measurements are saved under `tools/shots/naturalist`.

## Connection behavior

Joining or resuming establishes the voyage's existing message as history, so an old welcome or salvage report is not replayed over the current scene. New crew events still appear during play. Activity buttons become available when the live connection is ready; the menu explains a pending connection. `npm run test:activity-transitions:browser` deliberately delays that connection, exercises repeated activity/study/journal transitions at desktop and phone widths, and checks historical-message suppression, live reports and reload behavior.

The server runs gameplay at 20 ticks per second, sends snapshots at 10 per second, and accepts bounded movement inputs and validated actions. Clients interpolate snapshots for smooth ship and crew movement. They cannot directly set ship coordinates, cargo, or mission progress. Conservative hull bounds block the cutter against the floating dock.

The broad swell is evaluated from the same formula on the server and in the ocean shader. A smaller FFT displacement adds local detail. Visual quality does not alter server buoyancy. Wildlife animation is cosmetic and local; the ship, crew, weather schedule, cargo, and mission are shared.

Stale throttle inputs expire. A four-second heartbeat timeout also detects half-open connections and releases occupied stations; an empty crew leaves the cutter anchored. EventSource reconnects after temporary network loss. Reloading and rejoining from the same tab restores its identity using a session token, including diver position and shared mission progress. A disconnected slot is reserved for two minutes before a new player can replace it. Once replaced, that old identity cannot be restored. Returning in a different browser/tab may occupy a new slot. If the room server is unavailable, the connection strip offers retry and new-expedition controls.

The standard Node server saves expeditions to `.expeditions/expeditions.json` every five seconds and after joins and successful actions. Settings offers **Save & return to menu**; it waits for a successful checkpoint before leaving. A disk failure keeps you aboard and shows a retry message. Idle expeditions pause. After a restart, the cutter is anchored, movement inputs are cleared and unattended stations are released; positions, cargo, courses, weather progress and survey records remain. Saved rooms expire 30 days after their last activity; rooms nobody joined expire after 30 minutes.

The launch screen's **Your voyages** panel remembers up to six identities in this browser. **Resume voyage** restores that crewmate, even from a new tab. Joining an invite normally from a new tab creates a new crewmate. **Forget** removes only the browser entry. Browser storage is specific to the website address, so `localhost` and a LAN address have separate resume lists. Clearing site data removes the saved identity. Offline identities are retained while the room has space; a full crew may reclaim a slot after two minutes away. A replaced identity cannot be resumed.

If browser storage is unavailable, joining and playing still work. **Retry** retains the current room's identity in memory while the page stays open, keeping the last world visible with controls paused until updates resume. Settings reports when it cannot remember a voyage shortcut, and **Save & return to menu** keeps you aboard if the resume entry cannot be stored. Reloading or closing the page can lose that identity when storage is denied. Starting a different room never forwards the previous room's credential. `npm run test:storage-denied:browser` checks denied session-token writes and completely unavailable browser storage.

Saves use serialized atomic replacement and keep the previous checkpoint as `.bak`. Server files contain token digests; browser resume entries contain the private credentials. An invalid save stops server startup without replacing it. Keep `.expeditions` on persistent storage and back it up. A private room is accessible to anyone possessing its invite link.

## Host for friends

The Node server listens on `0.0.0.0:8787` by default. When opened through `localhost` or `127.0.0.1`, **Invite crew** finds a network address for players on the same Wi-Fi or local network. Physical Wi-Fi/Ethernet connections take priority over virtual adapters. If several connections remain, choose one in the invitation. Keep the server running while friends play. A server bound only to loopback cannot offer a network address; the dialog identifies its link as usable only on this computer. You can also open the game directly through the host's network address.

An invite opened through an existing shared or public address keeps that address. The copied link contains the room and game mode, without a crew token, quality settings or a fragment. Browsers without clipboard access select the link for manual copying. Address discovery is available only to a loopback request using a local Host name; ordinary network or public-host requests receive no interface details. The invite browser test joins a second crew identity through the host's actual network address; reachability from another physical device still depends on the host network and firewall.

For internet play, run `npm ci`, `npm run build`, and `npm start` on a Node-capable host and expose the website through HTTPS. Route both the website and `/api` to the same running process. Reverse proxies must allow long-lived server-sent events and disable response buffering for `/api/rooms/*/events`. Set `PORT` and optionally `HOST` in the process environment to change the listener. Set `EXPEDITION_DATA_DIR` to a persistent directory to override `.expeditions`. Use one server process per save directory; concurrent instances cannot share this file store. Programmatic `createGameServer()` calls stay ephemeral unless given `{ dataDir }` as the second argument, keeping test rooms isolated.

A static hosting service alone is insufficient for multiplayer. The repository's legacy Netlify configuration builds static assets and does not deploy this room server. No remote hosting or public deployment is included in this change.

## Verification

`npm run test:game` includes disk checkpoint, real HTTP restart, identity restoration, idle pause, survey restoration, expiry, corrupt-save rejection and real filesystem failure checks. `npm run test:persistence:browser` uses an isolated temporary save directory and verifies Save → menu → new tab → restart → Resume, separate invite identities, a failed save and retry, continuing crewmates, forgetting one browser entry, and layouts at 1440, 600 and 390 px. Screenshots are under `tools/shots/persistence`.

```sh
npm run test:game
npm test
npm run build
```

With `npm start` running, the browser mission test launches two independent browser contexts, uses gameplay controls and UI actions, completes the expedition, tests automatic reconnect and reload recovery, and checks both clients' mission completion:

```sh
npm run test:game:browser
```

For a full solo browser run in PowerShell:

```powershell
$env:GAME_SOLO = '1'
npm run test:game:browser
Remove-Item Env:GAME_SOLO
```

`GAME_URL` overrides the default `http://127.0.0.1:8787/`. The browser harness uses Puppeteer's Chromium with a Windows D3D11 GPU configuration. Screenshots and result reports are written under `tools/shots/game` or `tools/shots/game-solo` and ignored by git. The underlying simulation tests also exercise a complete solo mission, invalid actions, stale input, slot capacity, authentication, station ownership, and identical streamed snapshots.

For review while someone is playing, use `npm run test:game:review`. It runs the same full voyage against its own temporary local server, with no saved-room directory, and closes that server afterward. It also accepts `GAME_SOLO=1`. The regular `test:game:browser` command remains available for testing a chosen running server.

`npm run test:game:immersive` runs that isolated voyage in the default quiet interface, opening Tools only to copy the crew invite. Mission actions use native keyboard shortcuts and verify the highlighted F action before interaction. Steering and swimming retain the harness's automated input driver. Add `-- --solo` for the solo route; `test:game:review` also accepts `-- --solo` and `-- --quiet`. Immersive captures are kept separately under `tools/shots/game-quiet` and `tools/shots/game-solo-quiet`.

Browser reload checks wait for the loading overlay to disappear before clicking Join. `app.running` means rendering has started; the loading overlay can still intercept clicks briefly afterward. Waiting on that flag alone previously produced a false reconnect timeout without sending any join request.

For visual regression checks, inspect fair weather and the approaching storm, the cutter underway, the underwater wreck and cable, boarding, and the completion screen. Also open `?mode=explore`, travel between habitats, and verify normal free swimming and the existing world lab.

`node tools/exploration-browser.mjs` checks the original surface view, reef dive, manual swimming, kelp and deep journeys, and the world lab against the running production server.

`npm run profile:frame` records CPU costs and JavaScript profiles for a fresh live expedition, comparing ordinary rendering with GPU profiling enabled. `npm run bench:motion` isolates the full wildlife simulation; its optional `--reference=<directory>` argument compares current motion with saved pre-change motion modules. See `docs/POLISH_NOTES.md` for the required reference files and measured results. Both tools write ignored artifacts under `tools/shots`.

`node tools/refinement-browser.mjs` verifies real keyboard/mouse steering, contextual departure, camera direction, zoom and reset, then captures the cutter in daylight, dusk, storm, waterline and aerial views. The procedural vessel materials share the ocean sky probe and sun, use local self-shadows, and render into both air and underwater buffers. Static equipment is merged by material to limit draw calls.

### Rendering stability and helm feedback

Run `npm run test:ship:browser` to start an isolated local Vite fixture and verify the actual ship shaders on the GPU. It checks that translating a ship and its camera together does not flash its shading or report false screen motion, and that true object movement still produces motion vectors. The test starts and closes its own server; it does not join or modify a room.

Moving vessel shadows update every rendered frame. A per-mesh transform history supplies correct motion vectors for the air and submerged copies without advancing history twice in one frame. Previously, three-frame shadow reuse made lighting snap back periodically, and the shader treated moving vessels as stationary world geometry during temporal reprojection.

Two crew members can share the same station exit. Characters are hidden locally while the camera is inside their body bounds, preventing a crewmate's helmet from covering the deck or dive view; they remain visible nearby and in chase view. This uses the final camera position and updates both surface and underwater copies. The GPU fixture reproduces a two-player helm handoff and overlapping divers.

The helm shows signed reverse speed, Ahead/Astern status and rudder direction. The anchor reads Setting while the ship slows and Holding once stopped. Deck view sits at crew eye height; the camera button explicitly identifies the dive view underwater.

Vessel sun shadows use surface-slope correction and interpolated filtering, avoiding false self-shadowing at low sun and discrete triangular bands on close panels. The existing 1024 px map covers 32 m around the cutter, retaining room for its heave and tilt while resolving smaller fittings. `npm run test:surfaces:gpu` verifies lit horizontal/rounded panels, real occluder shadows, smooth sampling during tiny movements and whole-ship coverage. Add `-- --profile` for an alternating GPU comparison against the previous shader and map framing. The diagnostic `-- --nearest` deliberately restores stepped filtering and must fail the continuity assertion.

Reef sunlight and dive-lamp shadows now use interpolated comparison weights and receiver-slope correction too. This removes square shadow steps on the sand and false dark bands on inclined rocks while preserving shadows from real objects. The existing 1536 px map and its coverage remain the same. `npm run test:reef-shadow:gpu` checks real depth-map rendering onto flat and inclined receivers, real occluder shadows, and continuity during tiny movements under both orthographic sunlight and the perspective dive lamp. The optional `node tools/reef-shadow-review.mjs` compares saved pre-change shader code from `.qa/reef-shadow-before.js` with the current code on an identical paused reef, including daylight, low sun, storm, lamp lighting and alternating GPU timings; `--scales` captures waterline and aerial views. The regular GPU regression does not require that saved reference file.

The foredeck has a physical steering wheel, compass and speed gauge. The wheel follows the cutter's actual turning response, and both instruments use shared ship state so crewmates see the same operation. At the helm, C switches between the wide ship view and a close view of the wheel and horizon; Home restores the framing. The console blocks walking and the follow camera, with room to pass on either side. Nearby crew temporarily clear the close station camera so a handoff cannot leave a helmet covering the instruments.

The compass now has a rotating N/E/S/W card: read your heading at the fixed gold index above it. The speed dial is marked from 0 to 20 knots, with labeled five-knot intervals and a calibrated needle; it shows speed magnitude while the HUD retains the astern sign. The engraved markings are procedural geometry, with subtle luminous paint. Portrait helm views widen enough to keep both gauges visible; the desktop framing stays the same.

The first-person wheel uses a finer rounded rim while retaining its existing rubber finish and shared steering motion. `npm run test:helm-clarity:browser` captures matching Low/High views at desktop and phone sizes, compares temporal anti-aliasing, and checks that depth-of-field and motion blur stay disabled across quality changes. The softer lettering at Low follows its lower rendering resolution.

`npm run test:helm:browser` verifies two-client instrument animation, left/right steering, centering, console collision, helm handoff and camera clearance. It also captures desktop and narrow layouts and the station in daylight, dusk and storm conditions. `npm run test:helm-dials:browser` verifies the four heading labels at the top index, portrait gauge bounds and rendered appearance under different lighting and viewing distances.

Run `npm run test:clouds:browser` for the GPU weather-continuity regression. Planet-centred coordinates are needed for spherical cloud intersections, but the procedural texture uses altitude above sea level. Previously, slowly changing cloud thickness rescaled the planet radius inside the noise lookup, making cloud shapes jump between frames and leaving a large checker pattern in the temporal history. A 10 cm thickness adjustment changed mean sky opacity by 21.6%; after the correction it changes about 0.03%. The fixture also checks a small cloud-scale change and ensures cloud shapes remain visible. Single-ray lighting variance is recorded separately from the opacity gate.

`node tools/cloud-live-browser.mjs` checks a fresh expedition through the initial weather transition, walking to the bow and using binoculars. It records screenshots and CPU/GPU timings, including an empty animation-frame baseline to distinguish browser scheduling delays from rendering work. It creates and closes its own room server.

Performance and Balanced graphics allow longer cloud rays to resolve fuller shapes with fewer gaps at their edges. Their ray budgets are 80 and 96 steps, while both still refresh one sixteenth of the cloud pixels per frame. High and Maximum retain their denser one-quarter refresh. Ray length and refresh density are separate preset settings, avoiding a sudden cost jump when increasing ray quality. `npm run test:cloud-sampling:browser` compares the Performance preset with a higher-sample reference, records GPU costs, and captures daylight, golden-hour and storm views at the waterline, 200 m and 1000 m. The live browser also checks actual graphics-selector transitions and their refresh budgets. Some temporal grain remains at lower resolutions.

Hard weather or sun changes reset incompatible cloud history; gradual changes continue accumulating samples. The cloud test includes a clear-to-overcast cut and compares its first frame to a fresh render so the previous sky cannot linger after a preset change.

`npm run test:cloud-filter:browser` verifies the production cloud upsampler against an independent cubic reconstruction using constant fields, rounded billows and sharp edges at non-integer magnification. The filter uses nine bilinear taps: Catmull-Rom's negative outer weights cannot be combined with positive neighbours in the previous four-tap shortcut. The test runs without loading a game or joining a room.

Press **H** to take or leave the helm whenever that station is available. It remains a dedicated shortcut even when F suggests a mission action. Off the helm, **WASD** walks the deck, **L** raises binoculars and **G** marks what you are aiming at for the crew. **B**, **V** and **R** operate the anchor, enter the water and operate/leave the winch; their buttons show availability. Camera tools wrap into a compact row, including on narrow screens.

Crew now have articulated elbows, knees, ankles and a neck joint. Walking blends with measured deck movement; riding the cutter does not trigger footsteps. Forward swimming leans the body into alternating fin kicks while the head follows the player's aim. Fins appear in the water and boots remain aboard. The suit and breathing hose stay connected as the pose changes, and camera overlap checks follow the animated body.

Divers exhale small bubble trails on a shared breathing rhythm. Bubbles rise and spread from their original positions as the diver swims away, then fade or pop at the surface. They fade out close to your eye and respond to daylight and the dive lamp. The effect is cosmetic and needs no additional controls.

`npm run test:bubbles:gpu` checks the actual transparent shader, moving-particle motion vectors, near-eye suppression and unlit/lamp-lit deep water. The crew-motion browser captures bubble trails in daylight, dusk and storm lighting and measures their update cost. Emission cadence, breathing phase, world-space trails, resets, surface popping and the particle limit are covered by pure tests.

`npm run test:crew-motion:browser` checks a remote diver's actual swimming, stopping and head movement in an isolated two-client room. It saves underwater and daylight/dusk/storm deck views in `tools/shots/crew-motion`. Pure checks cover render-rate independence, repeated snapshots, teleports, station transitions, eye/aim alignment and the hose connection.

`node tools/deck-browser.mjs` starts its own temporary room server and verifies two-player deck walking, position synchronization while a crewmate steers, anchoring from deck, diving, boarding, and helm handoff.

### Navigation and recovery feedback

Use **Find crewmate** beneath the chart to select another player. A cyan beacon follows their live position and reports distance plus dive depth or current station. Offscreen arrows show where to look without moving your camera. Select **Mission guidance** to return to the mission beacon. Tracking pauses during a lost connection and resumes when that crewmate reconnects; solo play hides the selector.

`npm run test:tracking:browser` checks two independent clients through diving, depth updates, selector input isolation, camera continuity, disconnect/rejoin, and layouts at 1440, 600 and 390 px. It starts its own room server and saves screenshots under `tools/shots/crew-tracking`.

An in-world signal identifies the survey buoy, archive, boarding destination, or home station for the current role and mission. An arrow points toward targets outside the view, and markers move clear of the mission and chart panels. Divers receive cable-range and anchor instructions at the crate; attaching the cable switches their guidance back to Kestrel. Deck crew get lookout instructions while another player pilots. The crew list includes diver depths.

In quiet play, signal details appear when you aim near a marker or approach within 20 m. Once visible, they allow a small aiming margin and remain until you move beyond 22 m unless still aimed at. This prevents small movements from repeatedly flashing the label. Hiding a marker or changing its target resets the margin. `npm run test:marker-detail:browser` checks aiming and range boundaries with the production marker on desktop and phone layouts.

After cable attachment, a recovery meter shows lift progress and explains pauses caused by the anchor, cable range, or an unoccupied winch. Once the archive is secured, it counts connected divers still in the water before departure.

The recovery station now has a working drum, sheave, control lever and status light. Their poses derive from shared archive progress, so a paused lift stops and joining crew see the same equipment orientation. The cable runs from the gantry sheave to the archive's lifting eye. Taking the winch opens a view of the machinery; Home restores that station view, and R leaves the controls. The operator model faces the console. Moving parts retain the vessel's surface, underwater, shadow and motion-vector treatment.

The archive's lifting eye sits on a bolted reinforcement plate in the existing teal metal finish. `npm run test:archive:browser` captures its seabed, lifting and secured states in daylight, low sun and storm conditions, plus waterline and distant views, and checks geometry, cable attachment and water-copy transforms.

The first-person camera keeps a small clearance from the davit's pillars and diagonal braces, including when boarding beside the ladder. The eye can move slightly around nearby hardware while the player's position and walking aim stay unchanged. `npm run test:boarding-view:browser` checks native boarding, full Q turns beside both supports, storm motion and phone framing against the rendered equipment.

`npm run test:recovery:browser` starts an isolated server at an attached-archive fixture, then uses real R/B controls with two browser clients to lift, pause, inspect, reset the camera, resume and secure the archive. It checks cable endpoints, shared machinery poses and the submerged/shadow copies, and saves images under `tools/shots/recovery`. Pure game tests cover every lift blocker and recovery completion.

The cutter now deposits a bounded, fourteen-second wake in world space. Foam follows curved courses, spreads and fades after stopping, and is shaded directly on the existing ocean surface. There are no separate foam meshes to intersect the waves. Teleports and clock resets clear the trail. Free exploration defaults to zero wake deposits.

Run `npm run test:polish:browser` after building to check underway wake generation, dive/boarding signals, recovery feedback, narrow-screen marker placement, and shader errors in an isolated room. It captures daylight, dusk, storm, waterline, 250 m and 1 km views and compares frame and GPU pass timings with the wake enabled and disabled. Artifacts are saved under `tools/shots/polish`. Wake lifetime, turn history, memory bounds, reconnect resets, and role guidance are also covered by `npm run test:game`.

`npm run test:experience:browser` checks real binocular input, walking to the bow, magnification, restoring both camera views, station restrictions, diving transitions, dialog behavior and narrow-screen controls. It measures the live Web Audio output to verify activation, nonzero sound, bounded signal levels, complete muting on deck and underwater, and reuse of one context. Screenshots and measurements are under `tools/shots/experience`.

With Sound enabled, nearby crewmates have quiet directional footsteps while walking on deck. They follow your viewing direction and fade with distance; your own steps stay centered. Riding the moving cutter, changing stations, reconnecting and returning from a hidden tab do not create walking sounds. Deck footsteps stay out of the diver soundscape and share the existing volume and mute controls. No recordings or additional network messages are used.

`npm run test:footsteps:browser` checks an authenticated crewmate walking through the server, directional changes after a real camera drag, mute/unmute and diving. It renders the actual footstep audio graph into both channels to verify panning, volume scaling, attenuation and silence. Pure game tests cover cadence, ship movement, clock gaps, teleports, station changes and disconnect cleanup.

`npm run test:crew:browser` starts an isolated room server and checks shared chart, binocular and underwater marks between two browser contexts, expiry on both clients, graphics changes, actual inverted camera input, movement isolation in settings, saved preferences, identity restoration and narrow-screen layout. Set `GAME_URL` to run against an existing server using a new test room. Screenshots and results are under `tools/shots/crew-settings`. Pure tests also cover signal rate limits, ownership, replacement, coordinate validation, expiry and compatibility with rooms created before the feature was added.


### Immersive play view

At the helm, the quiet readout includes the number of connected divers still in the water. The count stays visible through recovery and anchor changes, updates as crewmates board or disconnect, and disappears when everyone connected is aboard. `npm run test:crew-return:browser` checks shared crew actions, recovery guidance and desktop/phone layouts. It does not restrict the captain's controls.

Kestrel's bow now carries a procedural windlass, chain lead, roller and anchor. Raising or deploying the anchor moves the visible gear over four seconds; reversing the command reverses it from its current position. Every crewmate receives the same deployment progress, including while joining and after restoring a saved voyage. The deployed line reaches the sampled seabed and follows the anchor's lifting eye. This is visual machinery for the existing anchor handling rules, rather than a separate seabed-grip simulation. `npm run test:anchor:browser` checks native controls, shared progress, water/shadow copies, motion history and rendered conditions.

With Sound enabled, the working windlass adds a motor and chain rattle from its position on the bow. The rattle follows deployment phase; raising and lowering have different motor pitches. It stops at either endpoint, fades with distance, sounds muffled underwater and shares the normal volume/mute control. A stalled voyage snapshot silences the loop until motion updates resume. `npm run test:anchor-sound:browser` checks live controls, spatial direction, stops, mute and the rendered stereo audio graph.

The existing helm readout and Tools instruments show **Raising** or **Lowering** while the gear travels, then **Raised** or **Holding** at the endpoint. A deployed anchor reports **Setting** while the cutter slows. Anchor command notices also wait for the gear before announcing completion. In quiet play, anchor information already shown at the helm is not repeated above the scene. Crew elsewhere aboard still receive the notice, and errors remain visible. Quiet play removes the anchor text once it is fully raised; recovery instructions still take priority while working the cable. `npm run test:anchor-feedback:browser` checks native commands, reversal, settling, readouts and phone layouts.

While aboard in the quiet view, navigation pins fade when the cabin or solid deck equipment blocks them. Walking to a clear sightline reveals them again. Thin railings do not hide pins; off-screen bearing arrows, selected-crewmate tracking, underwater guidance and the chart remain available. Opening Tools shows the full guidance through obstructions. Reduced-motion preferences disable the short fade. `npm run test:marker-sightlines:browser` checks obstruction, walking, tools, shared pins, tracking, narrow layouts and diver navigation.

Normal expedition play now starts with a small contextual action row instead of the persistent mission, chart and instrument panels. **Activities** offers useful crew jobs off the helm, **Chart [N]** opens navigation, and **Tools [I]** reveals the complete console, settings and crew tracking. Press **I** or **Escape** to return to the sea. Tools preserve your station and camera orientation. Existing gameplay shortcuts continue to work.

Depth, survey progress and essential helm or winch readings appear only in the relevant role. Nearby crew calls and connection recovery remain visible when needed. Touch movement controls and the button to lower binoculars stay available. Floating navigation symbols are smaller; their names and distances appear when nearby or aimed toward the center of the view.

When Kestrel is anchored within lifting range, quiet play removes the floating archive-recovery pin and uses the bottom readout for cable readiness or lift progress. Nearby deck equipment keeps its interaction prompt. Raising the anchor or leaving cable range restores the bearing; Tools retains full guidance. Selected courses, crew marks and divers' boarding guidance remain available. `npm run test:quiet-recovery:browser` checks these transitions and desktop/phone layouts.

In Settings, turn off **Immersive play view** to keep the detailed interface visible. **Tools panel detail** retains the existing full/compact preference; with immersion disabled, I switches that density. Preferences survive reloading.

`npm run test:immersive:browser` exercises the new default, keyboard and pointer access to tools, dialog shortcuts, binocular exit, station preservation, surveying, crew acknowledgement, narrow/touch layouts and the saved opt-out preference. Older console-specific browser regressions explicitly select the expanded interface through `browser-tools-view.mjs`.

Automatic graphics quality now ignores time spent in a hidden browser tab. Rendering pauses while hidden; returning starts a fresh timing sample and discards old cloud/post-processing history. This avoids treating background throttling as an overloaded GPU. The shared expedition continues on the server, with the existing neutral heartbeat keeping your crew identity connected and unattended controls released.

`npm run test:quality:visibility` drives the production App animation loop and Quality controller through throttled callbacks, a two-minute fully suspended gap, healthy foreground frames and real overload. `npm run test:visibility:browser` switches between actual browser tabs, checks neutral input and continued room updates, and verifies a clean return to the helm.

Automatic graphics quality now measures the render callback's CPU duration and an asynchronous GPU interval when the browser supports GPU timers. It uses the larger cost, while displayed frame times continue to report the real browser cadence. A browser scheduling delay therefore no longer forces unnecessary resolution loss. Missing, invalid, stale or stalled GPU results fall back to the existing frame-time controller; manual graphics choices are unchanged.

The measurement uses at most six pending queries, never waits for GPU completion, and resets across viewport/preset rebuilds and visibility changes. It yields to the existing per-pass profiler so WebGL timer queries cannot overlap. `npm run test:quality:browser` compares cadence-based and measured automatic quality in the actual expedition scene and checks profiler/manual-mode cleanup. `tools/quality-work.test.mjs` covers controller behavior, CPU/GPU bottlenecks, delayed results, unsupported timing and query lifetime; it is included in `npm test`.

### Water entry

Walk up to the starboard boarding ladder and press **F** to enter the water. The small station readout explains when the captain needs to slow down. Divers enter alongside that ladder, facing out to sea, and can use **F** to climb back aboard while alongside the slow cutter. **V** and the Activities panel still provide direct dive access. The quiet primary-action button shows only its F shortcut; the full tools panel also shows the station shortcut.

Crew entering the water leave a brief procedural spray at the entry point. Nearby players see it without an extra HUD notice. It follows observed deck/helm/winch-to-diver transitions, fades in under a second, and does not replay for joining divers, disconnected players, or long snapshot gaps. `test:dive-splash:gpu` checks translucency, motion output, darkness and eye clearance; `test:dive-splash:browser` triggers an authenticated peer dive and captures the actual scene.

### Field photographs

Divers can now keep photographs of identified wildlife. Open **Activities → Observe wildlife** or press **O**, keep an animal in view until it is identified, then choose **Photograph** or press **P**. The saved image frames that animal and some surrounding habitat without including the HUD. Scroll over the water or use the lens **− / +** buttons to smoothly magnify the observation view from **1× to 3×**. Dragging and arrow-key aiming slow proportionally for finer framing; zooming leaves the diver in place. Click the magnification readout to return to 1×. Closing observation restores the normal view; **Home** resets the lens along with the camera. **Retake photo** replaces the photograph for that animal group. Observation annotations yield to open dialogs, which also isolate the photography shortcut. Touch observation buttons have a 44 px minimum height.

Open **Field journal [J]** to view the photographs or choose **Save photo** to download a JPEG. The photographs survive reloading and also appear in the original free-exploration journal. Each animal group keeps one 480×360 image, bounded to 48,000 characters in browser storage. If storage is full or unavailable, the current image remains available for the visit and can still be downloaded; the UI reports that it was not saved permanently. Existing sightings and previously saved images remain intact.

`npm run test:photos:browser` identifies a real reef animal, checks magnification and aiming sensitivity through real wheel/drag/button input, photographs and retakes it, verifies zoom and capture leave the diver in place, downloads the exact JPEG shown in the journal, checks 600/390 px layouts and touch controls, reloads, and opens the same photo in free exploration. Closing/Home resets and journal scroll isolation are covered too. Crop geometry, local storage bounds, failed replacements and frame-rate-independent lens smoothing are covered in the normal logic suite.

Activities opens Kestrel's crew notebook, with ruled entries for navigation, lookout, diving, recovery and shared surveys. Each entry includes its current instructions and action button; an unavailable action explains what is needed. The notebook scrolls on phones while its Close button stays accessible.

### Stern machinery

Below the stern, Kestrel's propeller follows the ship's speed and reverses with astern motion. The rudder follows steering, and both remain visible to divers alongside the cutter. The shaft settles when the ship comes to rest; its shared orientation survives rejoining and saved voyages.

With **Sound** enabled in Tools, the engine comes from the aft compartment. Turning changes its stereo position; swimming farther away reduces its level, while submerging softens its tone. The sound follows the rendered ship through pitching and rolling and uses the same volume and mute controls as the ocean.

### Nearby crew

Crew suits use shaped hoods and limbs, diving masks, shoulder harnesses and strapped air cylinders. Fins deploy only while diving; crew walk on deck in boots. The articulated body and breathing hose follow each player's movement and aim in both water render passes.

In quiet play, briefly looking at a nearby crewmate shows their name and current role. Choose **Show position** to follow their position, or **Stop tracking** to return to course/mission guidance. The cue works aboard and while diving, hides behind scenery, other crewmates and dialogs, and disappears when you look away. When crew members line up in a narrow passage, the cue identifies the visible person in front. It requires no open crew panel; the existing navigation selector remains available in Tools.

`npm run test:full-crew:browser` checks four connected crew members using one rendered browser and three authenticated API peers in an isolated room. It verifies full-room admission limits, identification through a crowded side passage, tracking without changing the captain, readable desktop/phone notebook rosters, and captain disconnect, rejoin and takeover. This complements the two-browser complete-voyage check.

### Deck radio

A marine radio is mounted on the aft cabin wall, beside the rear window. Walk up and press **F** or choose **Use radio**. The station shows how many crewmates are on the channel; solo players can inspect it and see why calls are unavailable. Ask the captain to slow or hold position, announce dive readiness, or acknowledge a crewmate without leaving the deck or taking control of the ship. **Z** still opens the radio elsewhere when another crewmate is connected, including during a dive.
