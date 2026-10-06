"""Add a webinar to the player.

Compresses the video to fit GitHub's 100 MB file limit, detects silent pauses,
copies the captions, writes webinars/<id>/meta.json and registers it in webinars.json.

Usage:
  python tools/add_webinar.py VIDEO --id my-talk --title "My Talk" \
      [--subtitle "Host · date"] [--captions talk.vtt] [--chapters chapters.txt] [--no-compress]

chapters.txt has one chapter per line, optionally tagged as less relevant:
  00:00:00 Intro [filler]
  00:04:10 Main topic
  01:20:00 Course pitch [promo]

Needs ffmpeg on PATH, or `pip install imageio-ffmpeg`.
"""
import argparse, json, re, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET_MB = 95          # stay safely under GitHub's 100 MB per-file limit
AUDIO_KBPS = 24         # mono speech
SILENCE_DB, SILENCE_MIN, PAD = -38, 0.35, 0.12


def ffmpeg():
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit('ffmpeg not found: install it or run `pip install imageio-ffmpeg`')


def duration(ff, video):
    out = subprocess.run([ff, '-hide_banner', '-i', str(video)], capture_output=True, text=True).stderr
    h, m, s = re.search(r'Duration: (\d+):(\d+):([\d.]+)', out).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def compress(ff, src, dst, dur):
    video_kbps = int(TARGET_MB * 8 * 1024 / dur - AUDIO_KBPS)
    if video_kbps < 40:
        print(f'warning: only {video_kbps} kb/s left for video; the picture will be very soft')
    vf = 'scale=1280:-2:flags=lanczos,fps=10'
    with tempfile.TemporaryDirectory() as tmp:
        log = str(Path(tmp) / 'pass')
        common = [ff, '-hide_banner', '-y', '-i', str(src), '-vf', vf, '-c:v', 'libx264', '-preset', 'slow',
                  '-tune', 'stillimage', '-b:v', f'{video_kbps}k', '-g', '300', '-passlogfile', log]
        subprocess.run(common + ['-pass', '1', '-an', '-f', 'null', '-'], check=True)
        subprocess.run(common + ['-pass', '2', '-c:a', 'aac', '-b:a', f'{AUDIO_KBPS}k', '-ac', '1', '-ar', '24000',
                                 '-movflags', '+faststart', str(dst)], check=True)


def silences(ff, video):
    out = subprocess.run([ff, '-hide_banner', '-nostats', '-i', str(video), '-vn', '-af',
                          f'silencedetect=noise={SILENCE_DB}dB:d={SILENCE_MIN}', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', out)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', out)]
    return [[round(a + PAD, 2), round(b - PAD, 2)] for a, b in zip(starts, ends) if b - a - 2 * PAD >= 0.25]


def read_chapters(path):
    chapters = []
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        m = re.match(r'\s*(\d+:\d\d:\d\d)\s+(.*?)(?:\s+\[(\w+)\])?\s*$', line)
        if m:
            c = {'start': m[1], 'title': m[2]}
            if m[3]:
                c['tag'] = m[3]
            chapters.append(c)
    return chapters


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('video')
    p.add_argument('--id', required=True, help='folder name / URL id, e.g. my-talk')
    p.add_argument('--title', required=True)
    p.add_argument('--subtitle', default='')
    p.add_argument('--captions', help='WebVTT transcript (e.g. Zoom .vtt)')
    p.add_argument('--chapters', help='chapters.txt (see above)')
    p.add_argument('--no-compress', action='store_true', help='copy the video as-is')
    a = p.parse_args()

    ff, src = ffmpeg(), Path(a.video)
    out = ROOT / 'webinars' / a.id
    out.mkdir(parents=True, exist_ok=True)
    dur = duration(ff, src)

    if a.no_compress:
        shutil.copy(src, out / 'video.mp4')
    else:
        compress(ff, src, out / 'video.mp4', dur)
    size_mb = (out / 'video.mp4').stat().st_size / 1024 / 1024
    if size_mb >= 100:
        print(f'warning: video.mp4 is {size_mb:.0f} MB, too big for GitHub (100 MB limit)')

    meta = {'title': a.title, 'subtitle': a.subtitle, 'duration': round(dur, 2), 'video': 'video.mp4'}
    sil = silences(ff, out / 'video.mp4')
    (out / 'silences.json').write_text(json.dumps(sil, separators=(',', ':')))
    meta['silences'] = 'silences.json'
    if a.captions:
        shutil.copy(a.captions, out / 'captions.vtt')
        meta['captions'] = 'captions.vtt'
    else:
        meta['captions'] = False
    meta['chapters'] = read_chapters(a.chapters) if a.chapters else []
    (out / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')

    index_path = ROOT / 'webinars.json'
    index = json.loads(index_path.read_text(encoding='utf-8')) if index_path.exists() else []
    index = [w for w in index if w['id'] != a.id] + [{'id': a.id, 'title': a.title, 'subtitle': a.subtitle}]
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'Added {a.id}: {size_mb:.1f} MB video, {len(sil)} pauses, {len(meta["chapters"])} chapters')
    print(f'Open it at ?w={a.id}')


if __name__ == '__main__':
    main()
