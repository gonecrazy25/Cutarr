# Cutarr v0.51

Cutarr is an all-in-one Docker web app for splitting multi-episode MKV TV recordings and DVD rips.

## v0.6 changes

- Added uploaded Cutarr icon/logo to the top-left header
- Renamed buttons to **Silence Detect** and **Black Frames Detect**
- Fixed title/credits label preservation when regions are unchecked and rechecked
- Start Ep changes now immediately renumber checked regions
- Added optional title/credits split detection to Auto Detect
- Titles/credits detection uses black-frame boundaries plus short-segment heuristics
- Renamed **Add region at playhead** to **Add split at playhead**
- Add Split now creates split points and rebuilds regions across the full video
- Auto Detect now uses the same black-frame preferred logic that works for your recordings
- Combined detection falls back to black-frame regions if heuristic snapping fails
- Media loading overlay/progress animation
- Status changes to **Media Loaded** after video metadata loads
- Auto-fills Show, Season, and Start Ep from filenames like:
  - `Show.Name.S02E03.mkv`
  - `Show Name - S02E03.mkv`
  - `Show_Name_2x03.mkv`
- Regions now have Include checkboxes
- Episode numbering dynamically skips unchecked regions
- Split job only outputs checked regions
- Added browser-compatible preview endpoint:
  - Converts preview playback to MP4/H.264/AAC in cache
  - Fixes common MKV audio issues with AC3/DTS tracks in browsers
  - Original files are still split losslessly with FFmpeg stream copy

## Portainer stack

Change `/mnt/media` to your real media path.

```yaml
services:
  cutarr:
    build: .
    container_name: cutarr
    ports:
      - "8088:8088"
    environment:
      CUTARR_MEDIA_DIR: /media
      CUTARR_OUTPUT_DIR: /media/Cutarr_Output
      CUTARR_CACHE_DIR: /cache
      CUTARR_CONFIG_DIR: /config
    volumes:
      - /mnt/media:/media
      - /opt/cutarr/cache:/cache
      - /opt/cutarr/config:/config
    restart: unless-stopped
```

Open:

```text
http://SERVER-IP:8088
```

## Local Docker Compose

```bash
docker compose up -d --build
```

Then open:

```text
http://localhost:8088
```

## Audio note

Browsers often cannot play audio inside MKV files when the audio is AC3, EAC3, DTS, etc. Cutarr v0.3 now uses a cached MP4/AAC preview for the web player. The first load of a large video may take time because FFmpeg is creating the preview. After that it loads from cache.


## Title / credits detection

Cutarr v0.5 adds an optional **Split titles/credits** checkbox. When enabled, Auto Detect tries to split short title/credit-like sections around detected episode boundaries.

This is heuristic-based. It works best when recordings or DVD rips have black frames before/after intros, credits, or episode joins. It does not yet do visual OCR or AI recognition of title cards.


## v0.7 changes
- Preserved the uploaded logo transparency in the header icon.


## v0.8 changes

- Added frame step backward/forward buttons for paused video
- Reduced waveform/region display height to about half
- Added a client-side split queue so multiple videos can be staged
- Added Run Queue and Clear Queue controls
- Added FPS detection through ffprobe for more accurate frame stepping


## v0.9 changes

- Fixed file browser click handling by switching to delegated clicks.
- Added cache-busting to CSS/JS so browsers do not keep stale static files after upgrades.
- Added clearer folder loading and browse error handling.


## v0.10 changes

- Reworked file browser folder/file clicks to use explicit buttons.
- Removed fragile file browser click delegation.
- Added global browser helper functions so folder clicks work reliably from rendered HTML.
- Added visible folder/file open actions.


## v0.11 changes

- Rebuilt the file browser click handling with real DOM buttons and `addEventListener`.
- Removed inline `onclick` attributes from file/folder rows.
- Added a favicon route and linked the Cutarr icon as the browser favicon.
- Added console logging for folder navigation and file selection.


## v0.12 changes

- Fixed repeated root folder browse loop.
- Fixed the Media breadcrumb click handler.
- Improved breadcrumb navigation so each breadcrumb opens the correct folder.
- Updated static cache-busting to v0.12.


## v0.13 changes

- Removed Open/Select buttons from the file browser.
- Folder and file rows are directly clickable again.
- Kept the fixed breadcrumb/root browse logic from v0.12.


## v0.14 changes

- Added a live frame counter between frame-step controls and FPS display.
- Added version badge in the lower-left corner.
- Added **Split Checked Regions** for immediate processing.
- Kept **Queue Checked Regions** for staging multiple videos before running jobs.


## v0.15 changes

- Fixed/strengthened waveform zoom behavior.
- Added visible zoom value text.
- Changed zoom scale to a more noticeable range.
- Added a Fit mode at the far-left of the zoom slider.


## v0.16 changes

- Fixed blocky waveform rendering by loading cached waveform sample data into WaveSurfer.
- Increased waveform cache resolution for long recordings.
- Reduced visual region overlay height so regions no longer hide the waveform.
- Reduced region overlay opacity.
- Improved zoom so it acts on the cached waveform data.


## v0.17 changes

- Restyled the UI to more closely match the Cutarr mockup.
- Added a top app bar with logo, queue/settings/about buttons.
- Reworked layout into media library, editor workspace, and right-side controls.
- Moved Auto Detect controls into a dedicated right-side panel.
- Moved naming and split/queue actions into a right-side panel.
- Changed Regions into a table-style list.
- Added a polished dark theme, blue accents, and bottom version/footer bar.


## v0.18 changes

- Restored the simpler top Cutarr header from earlier builds.
- Removed duplicate version display and removed “FFmpeg powered.”
- Added real storage free/total numbers.
- Moved frame step controls and frame counter into the video player area.
- Preview Names now generates output filenames from checked regions.
- Regions panel now gets more vertical space and expands better with detected regions.
- Added colored split numbers that match the colored waveform region/split markers.
- Removed the Timeline tab button.


## v0.19 changes

- Replaced the old 22/30/44/60 minute selector with **Expected Episodes**.
- Auto Detect now estimates where episode boundaries should be from file duration and episode count, but it only creates splits at real detected black-frame or silence points.
- Removed estimated fallback split points. If Cutarr cannot find a real detected point near an expected boundary, it leaves that boundary unsplit and reports fewer regions.


## v0.20 changes

- Fixed video overflowing outside the player card.
- Moved frame step controls below the video instead of overlaying the video.
- Kept frame counter next to frame step controls.
- Increased waveform/timeline card height so Add split and Clear all splits fit inside.
- Added stricter panel overflow and sizing rules.


## v0.21 changes

- Split titles/credits is now checked by default.
- Renamed Expected Episodes to Expected # of episodes in the file.
- Title/credit auto-detection now labels beginning short segments as Titles and ending short segments as Credits.
- Adding a split at playhead now preserves existing Titles/Credits labels when the split falls inside those regions.
- Zoom now maxes out at 100px/sec.
- Waveform region color blocks are taller and easier to see.


## v0.22 changes

- Made the video player area about 25% larger.
- Constrained the Jobs panel so running/finished job details stay inside the box.
- Added queue-aware top status messages:
  - Starting Split Job
  - Split Job Running
  - Split Job Finished
  - Starting Split Job Queue
  - Split Job Queue Running
  - Split Job Queue Finished
- Queue status now tracks the queue as a whole instead of updating for each individual job.


## v0.23 changes

- Loading overlay now stays visible until waveform processing/loading is complete.
- Player card sizing fixed so frame controls remain visible under the video.
- Added more spacing between waveform and regions panels.
- Footer/version line now sits below the main content area.
- Media Library and Queue/Jobs panels now extend down to the footer line.
- Improved full-height layout behavior.


## v0.24 changes

- Fixed clipped Naming panel on shorter screens.
- Fixed clipped Regions panel.
- Added independent scrolling to the center editor and right-side controls.
- Kept Media Library and Queue/Jobs panels extended to the footer line.
- Adjusted layout sizing so content remains reachable instead of being hidden.


## v0.25 changes

- Center editor and right-side controls now scroll together using the main page scroll.
- Removed independent center/right scrollbars.
- Fixed frame step controls being clipped under the video panel.
- Added reserved space for frame controls below the video.
- Added explicit spacing between the Waveform panel and Regions panel.
- Adjusted full-page layout so content remains reachable on shorter screens.


## v0.26 changes

- Extended Queued Splits/Jobs panel down to better align with the Regions panel.
- Added dark/blue themed scrollbars.
- Removed the full-width footer line under the editor/regions area.
- Moved the Cutarr version footer into the lower-left Media Library panel only.
- Removed extra footer text like “FFmpeg powered” / “Made with ❤ for your media.”


## v0.27 changes

- Restored the full footer text under the Media Library panel only.
- Footer now shows: Cutarr version, FFmpeg powered, and Made with ❤ for your media.
- Kept the divider line above the left-side footer.
- Removed the full-width footer from the editor/regions side.


## v0.28 changes

- Moved the footer outside the Media Library panel.
- Footer now sits below the Media Library box in the left column.
- Kept the divider line above the footer text.
- Footer remains left-column only and no longer appears under the editor/regions area.


## v0.29 changes

- Removed “FFmpeg powered” from the left-column footer.
- Made the heart red in “Made with ❤ for your media.”
- Right-justified the “Made with ❤ for your media” text.
- Kept the footer below the Media Library box only.


## v0.30 changes

- Media Library file and folder names now wrap so the full name can be seen.
- Fixed Add split at playhead when splitting a region that starts at 00:00:00.
- Add split now splits only the region containing the playhead instead of rebuilding from all starts.
- Existing region labels such as Titles/Credits are preserved when a region is split.


## v0.31 changes

- Fixed queued split rows so the Remove button no longer renders off-screen.
- Queued split filenames now wrap cleanly in the Queue box.
- Queue row action buttons now wrap below the filename on narrow widths.
- Removed horizontal overflow from the Queued Splits panel.


## v0.32 changes

- Added a Cancel button to loading/waveform/detecting progress screens.
- Loading cancel stops the browser preview load and aborts the waveform request.
- Detect cancel aborts the active detection request from the browser.
- Changed Queued Splits Remove button to a compact trash-can icon.
- Added optional Intro titles split time for Auto Detect.
- Auto Detect can now search near the entered intro time for a black-frame or scene-change cut and use it as the first Titles cut.


## v0.33 changes

- When Intro titles split time successfully finds a cut, the first region is now labeled Titles.
- The intro hint cut is preserved even if the Titles section is shorter than the normal Auto Detect minimum region length.
- Moved the intro hint explanation into a mouse-over tooltip on “Intro titles split time (optional).”
- Removed the always-visible intro hint help sentence from the Auto Detect panel.


## v0.34 changes

- Added a Media Library option: Fast preview, no audio.
- When enabled, Cutarr loads a video-only preview so first load can be much faster.
- Video-only previews try a fast video remux first, then fall back to video-only transcode if needed.
- Audio preview mode remains available when the checkbox is off.
- The setting is remembered in the browser and reloads the current video when changed.


## v0.35 changes

- Improved Intro titles split time labeling.
- If Auto Detect creates a region that ends at or very close to the intro title split time, that region is now labeled Titles.
- This works even when the first detected region starts a few seconds after 00:00:00, such as 00:00:05 to 00:01:03.


## v0.36 changes

- Added optional Credits split time with the same black-frame / scene-change hint logic as Intro titles split time.
- If Auto Detect finds a cut near Credits split time, the region starting at or near that cut is labeled Credits.
- Credits regions are preserved even if they are shorter than the normal Auto Detect minimum region length.
- Added video resolution and file size badges next to the FPS badge in the video header.


## v0.37 changes

- Replaced the static MKV/MP4 badge with the detected video codec.
- Added a Settings page opened from a hamburger menu in the top-left corner.
- Added Cache cleanup time setting.
- Cache cleanup defaults to 1 day.
- On app startup and page load, preview/waveform/tmp cache files older than the configured age are deleted.
- Settings are stored in the config volume.


## v0.38 changes

- Fixed the hamburger Settings button not opening the Settings screen.
- Added settings click handlers that were missing from v0.37.
- Added a direct fallback click handler on the hamburger button.
- Added stronger CSS rules for the Settings overlay open/closed state.
- Added Escape-key support to close Settings.
- Fixed settings save compatibility for Pydantic v1/v2.


## v0.39 changes

- Tightened the bottom spacing in the video/player card.
- Tightened the bottom spacing in the waveform/timeline card.
- Removed extra forced minimum height that was leaving large empty areas below the frame controls and split buttons.
- Kept the frame buttons visible below the video.


## v0.40 changes

- Stronger layout fix for the video/player and waveform/timeline cards.
- Removed stretch behavior that kept the cards taller than their actual content.
- Added a small runtime layout pass so the video and waveform panels shrink-wrap their contents after load/resize.
- Reduced panel padding/gaps below the frame and split buttons.


## v0.41 changes

- Extended the Regions panel so its bottom lines up with the Queued Splits / Jobs panel.
- Added Settings defaults for Split titles/credits.
- Added Settings defaults for Fast preview, no audio.
- Split titles/credits and Fast preview defaults are saved in the config volume.
- Fast preview remains a current-session toggle on the Media Library panel, but its startup/default value now comes from Settings.


## v0.42 changes

- Split titles/credits now defaults to checked in Settings.
- Fast preview, no audio now defaults to checked in Settings.
- On first run, Cutarr now creates `/config/settings.json` automatically if it does not exist.
- The generated settings file contains the default cache cleanup time and default checkbox values.


## v0.43 changes

- The inner Regions list now expands to fill the full available height inside the Regions panel.
- The Regions panel still lines up with the Queued Splits / Jobs panel.
- The Regions list now scrolls internally when there are more regions than fit.


## v0.44 changes

- Fixed the inner Regions list not extending to the bottom of the outer Regions panel.
- Regions panel and inner Regions list now get explicit synchronized heights.
- The Regions list now fills the full usable space below the Regions header.


## v0.45 changes

- Centered the waveform drawing vertically inside the waveform box.
- Added CSS and runtime layout adjustments so WaveSurfer does not sit against the top edge.
- Kept the waveform box height the same while moving the visible waveform to the middle.


## v0.46 changes

- Added previous/next split point navigation buttons in the waveform controls.
- Added a trash button between those navigation buttons to delete the currently selected split point.
- Trash button tooltip explains it deletes the currently selected split point.
- Deleting a split point merges the two adjacent regions.


## v0.47 changes

- When deleting a split point between Titles and Episode, the merged region is now labeled Episode.
- When deleting a split point between Credits and Episode, the merged region is now labeled Episode.
- If two same-type regions are merged, the type is preserved.
- If two different non-episode types are merged, the merged region falls back to Episode.


## v0.48 changes

- Deleting a split point now works when only one region touches that split.
- If the split is at the end of a region with no region after it, that region extends forward to the next split point or the end of the file.
- If the split is at the beginning of a region with no region before it, that region extends backward to the previous split point or the beginning of the file.
- Existing two-region merge behavior is preserved.


## v0.49 changes

- Fixed Preview Names color dots not matching the Regions colors when a region is unchecked.
- Preview Names now uses each region's original visual/color index instead of renumbering only checked regions.
- Episode numbering in Preview Names still only counts checked regions.


## v0.50 changes

- Added login protection for Cutarr.
- On first run, if no admin password exists in `/config/auth.json`, Cutarr shows a setup page to create the admin password.
- Added an admin login page.
- Added secure password hashing using PBKDF2-SHA256 with a per-password salt.
- Added signed HTTP-only session cookies.
- Added Admin Password change controls to Settings.
- Added Logout button to Settings.


## v0.51 changes

- Added a top-right Logout icon button.
- Logout icon is styled as an exit/arrow icon similar to the provided reference.
- Added mouse-over tooltip text: Logout.
- Kept the existing Logout button in Settings.
