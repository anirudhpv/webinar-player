# Webinar Player

A browser video player for long recorded webinars. It has:

- **A chapter seek bar.** The bar is split into chapters, and hovering shows the chapter name.
- **A chapter list.** It highlights the chapter that's playing, and you can filter it.
- **Skip silence.** Short pauses play at 4×. Long pauses play at 8× or are jumped over, whichever you choose. An optional 300 ms margin keeps soft syllables from being clipped.
- **Flag promos.** Chapters tagged as promo or filler are tinted as less relevant.
- **Captions.** These are loaded from a WebVTT transcript.
- **Resume.** Each webinar picks up where you left off.

The page is static and runs on GitHub Pages. Open `index.html` to see the list of webinars, or `index.html?w=<id>` to open one.

## Layout

```
index.html, player.js        the player (generic, no webinar data inside)
webinars.json                list of webinars shown on the home page
webinars/<id>/meta.json      title, subtitle, duration, chapters, file names
webinars/<id>/video.mp4      video (must be under 100 MB for GitHub)
webinars/<id>/captions.vtt   transcript (optional)
webinars/<id>/silences.json  silent pauses [[start, end], ...] (optional)
```

## Adding a webinar

```
pip install imageio-ffmpeg        # only if ffmpeg isn't installed
python tools/add_webinar.py recording.mp4 --id my-talk --title "My Talk" \
    --subtitle "Host · Oct 2026" --captions transcript.vtt --chapters chapters.txt
git add webinars webinars.json && git commit -m "Add my-talk" && git push
```

The script:

1. Compresses the video to about 95 MB (1280px wide, 10 fps, mono audio).
2. Detects the silent pauses.
3. Writes `meta.json` and adds the webinar to `webinars.json`.

`chapters.txt` has one chapter per line. To mark a chapter as less relevant, add `[promo]` or `[filler]` at the end of the line:

```
00:00:00 Waiting room [filler]
00:11:03 Introduction
01:36:22 Program pricing [promo]
```

## Previewing locally

Browsers block the page from fetching its data when it's opened directly as a file. To preview it locally, serve the folder instead:

```
python -m http.server 8000
```

Then open http://localhost:8000.
