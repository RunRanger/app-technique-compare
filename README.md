# Technique Compare

A cross-platform (iOS + Android) app for comparing two sports or gymnastics
videos frame by frame — the way a coach does it: line the clips up on the same
moment, then scrub through both at once.

Built with Expo SDK 57, React Native 0.86, TypeScript.

---

## What it does

**1 · Pick two clips — the collection is the first screen**

The app opens on your saved collection. Tapping a clip selects it immediately:
the first tap fills **video 1**, the second fills **video 2**, and after that
taps replace video 2 — you keep the clip you are comparing *against* and cycle
attempts through the other slot. Two chips at the top show the current selection
and clear it.

A fixed bottom bar holds the two ways to bring in new material:

- **Record** — in-app capture, then a review screen: *retake*, *use for
  comparison*, or *save to collection* under a name you choose.
- **Add from library** — the **system video picker**
  (`PHPickerViewController` on iOS, the platform picker on Android), not a grid
  this app draws. Picks backed by a persistent asset id join the collection
  automatically.

**2 · Sync**

- **Offset slider** scrubs the temporal offset between the clips in real time,
  with both frames on screen so you can see them agree.
- **Frame steppers** (±1, ±10 frames) at the clip's real frame rate.
- **Auto-sync** runs pose estimation over a window around the moment of
  interest, extracts a motion signal, and solves for the offset. It fills the
  same slider you would move by hand, with its confidence and reasoning shown.
- Alignments are remembered per clip pair, so re-opening two clips restores the
  offset you dialled in.

**3 · Compare**

One master transport drives both players: play/pause, a timeline that scrubs
both, and frame stepping. Three visualization modes:

- **Side by side** — columns in landscape, stacked in portrait.
- **Overlay** — video 2 blended over video 1, opacity 0–100%.
- **Split** — one continuous frame, with a draggable divider.

Plus 0.25× / 0.5× / 1× playback, and **Replace video 2** — which opens the
system picker inline, without leaving comparison, keeping video 1, the offset
and your position.

---

## Running it

```bash
npm install
npx expo start
```

Every native dependency is on Expo's bundled-modules list, so the app loads in
**Expo Go** and `npm start` alone is enough to click through the workflows.

Expo Go runs its own native container, though, so the config plugins in
`app.json` do not apply there: you get Expo Go's generic permission wording
instead of this app's, and the orientation and `expo-video` plugin options are
ignored. To exercise those — and anything else native — build once:

```bash
npx expo run:ios      # or: npx expo run:android
```

That prebuilds `ios/`/`android/` (both gitignored) and compiles. After that
`npm start` is all you need; a rebuild is only required when native dependencies
or `app.json` change. iOS needs macOS + Xcode, Android needs the Android SDK,
or use EAS Build for either.

```bash
npm run verify        # all of the below
npm run check:deps    # native deps vs. the Expo SDK's pinned versions
npm run typecheck     # tsc --noEmit
npm test              # 98 unit tests
npm run lint
```

`check:deps` exists because a mismatched native package is invisible to every
other check: it installs, typechecks and bundles fine, then takes the app down
on launch with a `NoClassDefFoundError` inside the Expo module registry. It
verifies both the installed version and the range declared in `package.json`
against `expo/bundledNativeModules.json` — the latter because a wrong range
passes locally while breaking the next clean install. `npx expo install`
normally prevents this by resolving versions from Expo's API; this check is what
replaces it when versions are pinned by hand.

> **After changing any native dependency, rebuild the development build.**
> Metro only reloads JavaScript — `npm start` will keep running against the old
> native binary.

---

## Architecture

```
src/
├── types/            Domain types. VideoRef, ResolvedClip, CompareMode.
├── playback/         ── the core ──
│   ├── timeline.ts       Pure offset/timeline math          (tested)
│   ├── syncEngine.ts     Drift-correction policy, seek profiles (tested)
│   └── useSyncedPlayback.ts  Master transport over two players
├── services/
│   ├── media/        MediaLibrary wrapper, system picker, clip resolution
│   ├── pose/         PoseEstimator contract, registry, mock + native adapter
│   └── sync/         ── auto-sync analysis, all pure ──
│       ├── signal.ts       Pose → 1-D motion signal        (tested)
│       ├── events.ts       Apex / takeoff / landing        (tested)
│       ├── correlation.ts  Normalized cross-correlation    (tested)
│       └── autoSync.ts     The solver                      (tested)
├── state/            Zustand stores (collection persisted, session transient)
├── components/       VideoSurface, transport, the three compare modes
├── screens/          Collection (root), Record, Preview, Sync, Compare
└── navigation/       Typed native-stack
```

The organising principle: **every hard part is a pure function.** Timeline math,
drift policy, signal processing, event detection and the offset solver contain
no React, no native modules and no I/O, so they are covered by fast unit tests.
Mutation is confined to `useSyncedPlayback.ts`, which is the only file that
touches a player.

### The sync model

One scalar describes the alignment:

> the moment at time `t` in the reference clip corresponds to the moment at time
> `t + offset` in the comparison clip.

The master timeline is expressed in reference-clip time and spans the
*intersection* of both clips once the offset is applied, so scrubbing can never
land where one video has no frame. Swapping the clips negates the offset;
remembered alignments are keyed order-independently and re-signed on recall.

### Exact frame seeking vs. smooth scrubbing

These pull in opposite directions, so the app switches between two profiles
(`syncEngine.ts`):

| | `seekTolerance` | `scrubbingModeEnabled` | used for |
|---|---|---|---|
| `EXACT_SEEK` | 0 / 0 | off | frame stepping, final seek after a drag |
| `SCRUB_SEEK` | ±100 ms | on | while a finger is on the slider |

Dropping to `SCRUB_SEEK` during a drag is what keeps scrubbing fluid; the exact
re-seek on release is what makes the frame you land on the right one. Frame
positions are snapped to a frame's interior rather than its boundary, so
repeated steps are deterministic and cannot accumulate sub-frame drift.

### Keeping two decoders together

Two players started in the same tick still drift — they decode independently.
Correcting on every tick would be worse than the drift, since each correction is
a seek and every seek stutters. So corrections are gated: ignored below ~1.5
frames, rate-limited to once per 600 ms, and applied immediately only when the
error exceeds 350 ms (a stall). See `evaluateDrift`.

### Videos are never copied

A clip is persisted as a **MediaLibrary asset id**, which is stable across app
launches on both platforms — never as a file copy. The playable URI is resolved
on demand, because on iOS a `PHAsset`-backed URI is not guaranteed to stay
valid. A collection of a hundred clips costs a few kilobytes. The one write the
app performs is saving a recording *into the user's library* (not app storage),
after which it keeps only the id.

---

## Plugging in a real pose model

The app ships **without** a bundled model. What it ships is the entire pipeline
around one — sampling, signal extraction, event detection and the offset solver
are real, tested code. A `MockPoseEstimator` generates deterministic synthetic
landmarks so auto-sync runs end to end on a simulator, and the UI says plainly
when it is doing so.

To add a real backend, implement one interface:

```ts
interface PoseEstimator {
  readonly id: string;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  prepare?(): Promise<void>;
  estimate(
    request: PoseEstimationRequest,
    onProgress?: (p: PoseProgress) => void,
    signal?: AbortSignal
  ): Promise<PoseSequence>;
}
```

then register it ahead of the mock:

```ts
poseRegistry.register(new MyPoseEstimator());
```

The registry picks the first estimator whose `isAvailable()` resolves true, so a
real model takes over automatically and nothing else changes.

`NativePoseEstimator` (`services/pose/nativeEstimator.ts`) is a ready-made
adapter for the usual case — an Expo native module. It looks up
`ExpoPoseLandmarker` via `requireOptionalNativeModule` and reports itself
unavailable when absent, which is what lets the fallback work with no
conditional logic anywhere else. Implement `NativePoseModule` with MediaPipe
Pose Landmarker, TF-Lite MoveNet, iOS Vision, or ML Kit and it will be used.

**Decode frames natively.** `AVAssetImageGenerator` on iOS,
`MediaMetadataRetriever`/`MediaCodec` on Android. Shipping raw frames across the
JS bridge would dominate the runtime.

Landmarks must be normalized to the frame (0–1, origin top-left) using the names
in `LANDMARK_NAMES`. Note that `y` grows *downward* — the signal extractors
handle the flip.

### How auto-sync decides

1. Pose → a 1-D motion signal, on a channel chosen for the sport: hip height,
   ankle height, vertical speed, or overall motion.
2. **Cross-correlation** of the two normalized signals over a bounded lag range.
   Each lag is scored over only the overlapping region and re-normalized there —
   skipping that re-normalization is the classic bug that collapses the solver to
   lag 0. A parabolic fit around the peak recovers sub-sample lag.
3. **Event matching** (takeoff by default) independently, also sub-sample
   refined, as a cross-check.

Correlation wins when it is confident, because it uses the whole shape rather
than one point; agreement with the event detector raises confidence and
disagreement lowers it. If correlation is weak the event answer is used instead,
and if neither is trustworthy the app says so rather than returning a
plausible-looking wrong number. Both paths respect the caller's maximum-offset
bound.

Sub-sample refinement matters: pose is sampled at ~15 fps while video runs at
30–240 fps, so rounding to the nearest pose sample would cap accuracy at ~66 ms —
several visibly wrong frames. The end-to-end test asserts recovery of a known
offset to within one frame at 30 fps.

---

### Why the system picker

`expo-image-picker` presents the platform's own UI rather than a browser this app
builds over `MediaLibrary`. Beyond looking native, on iOS 14+
`PHPickerViewController` runs out of process, so **choosing a clip needs no photo
library permission at all** — nothing is prompted, and the app still only ever
sees what was picked. The user also gets the search, albums and Favourites they
already know.

Three options are non-negotiable here:

```ts
videoExportPreset: VideoExportPreset.Passthrough
preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Current
shouldDownloadFromNetwork: true
```

The first two stop the picker from re-encoding on the way out. A transcode would
rewrite the frame rate, and frame-accurate comparison depends on the frame rate
being the one the camera actually recorded.

The third follows from the first: `Passthrough` is the one preset that will *not*
fetch an iCloud-only asset by itself. With "Optimize iPhone Storage" enabled that
is most older footage, so without this flag the picker fails on exactly the clips
a user is most likely to reach for.

The trade-off is persistence. The picker returns `assetId` — the MediaLibrary id
— on the paths where the platform exposes it, and those picks are stored in the
collection as references, unchanged from the no-copy rule above. Where only a
sandboxed copy is handed over, the clip is used for the current session but
deliberately *not* saved to the collection, because the copy would not survive a
restart.

## Notes on platform specifics

- **Android overlay/split modes** force `surfaceType="textureView"`. The default
  `SurfaceView` is punched through the view hierarchy: it ignores opacity and
  cannot be z-ordered against another video, so stacked surfaces would render as
  opaque rectangles. The ExoPlayer shutter is disabled there too, since it paints
  an opaque frame over whatever sits beneath.
- **Split mode** clips the upper surface with a fixed-width container while the
  video inside keeps the full stage width. Sizing the video to the revealed width
  would re-letterbox it as the divider moves and the halves would stop lining up.
- **iOS limited photo access** is treated as usable, not as a failure, with a
  path to widen the selection.
- **`requireFullScreen: true`** on iOS is required for orientation locking to
  work on iPad.
- Three `eslint-disable` comments remain, each explained in place. They are all
  the React Compiler ruleset modelling external mutable objects as frozen: an
  `expo-video` player is a handle to a native object whose documented API *is*
  property assignment, and `PanResponder.create` must run during render because
  its handlers are spread onto a view in the same pass.

## Not implemented

- No bundled pose model (see above) — auto-sync runs on simulated landmarks
  until one is linked in.
- No thumbnails in the collection list; entries are text with a play glyph.
  Real thumbnails mean a player per row and a cache, which is a feature of its
  own.
- UI strings are English throughout.
- Drawing tools (angles, lines) and export/share of a comparison.
- Clip trimming; the offset defines alignment, not in/out points.
