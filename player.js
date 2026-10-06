// Webinar Player — loads a webinar from webinars/<id>/meta.json (?w=<id>), or lists webinars.json when no id is given.
const toSec = s => typeof s === 'number' ? s : s.split(':').reduce((a, b) => a * 60 + +b, 0);
const fmt = t => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TAG_LABEL = { promo: 'Promo', filler: 'Filler' };
const tagLabel = t => TAG_LABEL[t] || (t.charAt(0).toUpperCase() + t.slice(1));

const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } },
                set(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} } };

const $ = id => document.getElementById(id);
const v = $('v'), seek = $('seek'), segsEl = $('segs'), tip = $('tip'), knob = $('knob'), list = $('list'), player = $('player');
let chapters = [], SILENCES = [], CUES = [], webinarId = '';
let dur = 0, segEls = [], liEls = [], curIdx = -1;

// ---------- Loading ----------
async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }
async function getText(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.text(); }

// Parses WebVTT into [[start, end, text]]. Drops "Audio shared by …" cues (shared music) and "Speaker: " prefixes.
function parseVTT(txt) {
  const out = [], re = /(\d+:)?(\d+):(\d+(?:\.\d+)?)\s*-->\s*(\d+:)?(\d+):(\d+(?:\.\d+)?)[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/g;
  const sec = (h, m, s) => (h ? parseInt(h) : 0) * 3600 + parseInt(m) * 60 + parseFloat(s);
  let m;
  while ((m = re.exec(txt.replace(/\r/g, '')))) {
    let text = m[7].trim().replace(/\n/g, ' ').replace(/<[^>]+>/g, '');
    if (!text || /^Audio shared by /.test(text)) continue;
    text = text.replace(/^[^:]{1,40}: /, '');
    out.push([sec(m[1], m[2], m[3]), sec(m[4], m[5], m[6]), text]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

async function showLibrary() {
  document.title = 'Webinar Player';
  document.body.classList.add('library-mode');
  let items = [];
  try { items = await getJSON('webinars.json'); } catch (e) { return fail(e); }
  if (items.length === 1) { location.replace('?w=' + encodeURIComponent(items[0].id)); return; }
  $('library').innerHTML = '<h1>Webinars</h1>' + items.map(w =>
    `<a class="card" href="?w=${encodeURIComponent(w.id)}"><b>${esc(w.title)}</b><span class="sub">${esc(w.subtitle || '')}</span></a>`).join('');
}

async function loadWebinar(id) {
  const base = `webinars/${encodeURIComponent(id)}/`;
  let meta;
  try { meta = await getJSON(base + 'meta.json'); } catch (e) { return fail(e); }
  webinarId = id;
  document.title = meta.title || 'Webinar Player';
  $('title').textContent = meta.title || id;
  $('subtitle').textContent = [meta.subtitle, 'Keys: space/k play · ←/→ 10s · ,/. prev/next chapter · c captions · s skip silence · p flag · f fullscreen'].filter(Boolean).join(' · ');
  dur = meta.duration || 0;
  chapters = (meta.chapters && meta.chapters.length ? meta.chapters : [{ start: 0, title: meta.title || 'Full video' }])
    .map(c => ({ start: toSec(c.start), title: c.title, tag: c.tag || '' }));
  $('legend').hidden = !chapters.some(c => c.tag);
  $('flagBtn').hidden = !chapters.some(c => c.tag);
  v.src = base + (meta.video || 'video.mp4');
  const [sil, vtt] = await Promise.all([
    meta.silences === false ? null : getJSON(base + (meta.silences || 'silences.json')).catch(() => null),
    meta.captions === false ? null : getText(base + (meta.captions || 'captions.vtt')).catch(() => null),
  ]);
  SILENCES = sil || []; CUES = vtt ? parseVTT(vtt) : [];
  for (const id of ['skipBtn', 'marginBtn', 'longBtn']) $(id).hidden = !SILENCES.length;
  $('ccBtn').hidden = !CUES.length;
  totalSilence = SILENCES.reduce((s, [a, b]) => s + b - a, 0);
  build();
}

function fail(e) {
  const local = location.protocol === 'file:';
  $('library').innerHTML = `<div class="err"><b>Couldn't load this page's data.</b><br>${esc(e.message || e)}` +
    (local ? '<br><br>Browsers block this when the page is opened as a file. Serve the folder instead, e.g. <code>python -m http.server</code>, then open <code>http://localhost:8000</code>.' : '') + '</div>';
  document.body.classList.add('library-mode');
}

// ---------- Chapters & seek bar ----------
function build() {
  if (!dur) return;
  chapters.forEach((c, i) => c.end = i < chapters.length - 1 ? chapters[i + 1].start : dur);
  segsEl.innerHTML = ''; list.innerHTML = ''; segEls = []; liEls = []; curIdx = -1;
  chapters.forEach((c, i) => {
    const s = document.createElement('div'); s.className = 'seg' + (c.tag ? ' tagged' : '');
    s.style.flex = `${Math.max(1, c.end - c.start)} 0 0`;
    s.innerHTML = '<div class="buf"></div><div class="fill"></div>';
    segsEl.appendChild(s); segEls.push(s);
    const li = document.createElement('li'); if (c.tag) li.className = 'tagged';
    const badge = c.tag ? `<span class="badge">${esc(tagLabel(c.tag))}</span>` : '';
    li.innerHTML = `<span class="ts">${fmt(c.start)}</span><span>${esc(c.title)}<span class="dur">${Math.max(1, Math.round((c.end - c.start) / 60))} min${badge}</span></span>`;
    li.onclick = () => { v.currentTime = c.start; v.play(); };
    list.appendChild(li); liEls.push(li);
  });
  $('count').textContent = `· ${chapters.length}`;
  render();
}

const chapterAt = t => { for (let i = chapters.length - 1; i >= 0; i--) if (t >= chapters[i].start) return i; return 0; };

function fillTo(els, t, key) {
  chapters.forEach((c, i) => {
    if (!els[i]) return;
    const p = t <= c.start ? 0 : t >= c.end ? 1 : (t - c.start) / (c.end - c.start);
    els[i].querySelector(key).style.width = (p * 100) + '%';
  });
}

function render() {
  if (!segEls.length) return;
  const t = v.currentTime;
  fillTo(segEls, t, '.fill');
  knob.style.left = (timeToX(t) / seek.clientWidth * 100) + '%';
  $('time').textContent = `${fmt(t)} / ${fmt(dur)}`;
  const i = chapterAt(t);
  if (i !== curIdx) {
    liEls[curIdx]?.classList.remove('active');
    liEls[i].classList.add('active');
    liEls[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('curChap').textContent = chapters[i].title;
    curIdx = i;
  }
}

// map between pixel x and time, honouring the 2px gaps between segments
function xToTime(x) {
  const base = segsEl.getBoundingClientRect().left;
  for (let i = 0; i < segEls.length; i++) {
    const r = segEls[i].getBoundingClientRect(), l = r.left - base, w = r.width;
    if (x <= l + w + 1 || i === segEls.length - 1) {
      const p = Math.min(1, Math.max(0, (x - l) / w));
      return { t: chapters[i].start + p * (chapters[i].end - chapters[i].start), i };
    }
  }
}
function timeToX(t) {
  const i = chapterAt(t), c = chapters[i], el = segEls[i]; if (!el) return 0;
  const base = segsEl.getBoundingClientRect().left, r = el.getBoundingClientRect();
  return r.left - base + r.width * Math.min(1, (t - c.start) / (c.end - c.start));
}

let hoverIdx = -1, dragging = false;
function hover(e) {
  const rect = seek.getBoundingClientRect(), x = Math.min(rect.width, Math.max(0, e.clientX - rect.left));
  const { t, i } = xToTime(x);
  tip.querySelector('.t-name').textContent = chapters[i].title;
  tip.querySelector('.t-tag').textContent = chapters[i].tag && document.body.classList.contains('flag') ? `Less relevant · ${tagLabel(chapters[i].tag)}` : '';
  tip.querySelector('.t-time').textContent = fmt(t);
  const half = Math.min(170, tip.offsetWidth / 2);
  tip.style.left = Math.min(rect.width - half, Math.max(half, x)) + 'px';
  if (i !== hoverIdx) { segEls[hoverIdx]?.classList.remove('hover'); segEls[i].classList.add('hover'); hoverIdx = i; }
  return t;
}
seek.addEventListener('mousemove', e => { if (!segEls.length) return; const t = hover(e); if (dragging) { v.currentTime = t; render(); } });
seek.addEventListener('mouseleave', () => { segEls[hoverIdx]?.classList.remove('hover'); hoverIdx = -1; });
seek.addEventListener('mousedown', e => { if (!segEls.length) return; dragging = true; seek.classList.add('drag'); v.currentTime = hover(e); render(); });
window.addEventListener('mouseup', () => { dragging = false; seek.classList.remove('drag'); });
window.addEventListener('mousemove', e => { if (dragging && !seek.matches(':hover')) { v.currentTime = hover(e); render(); } });

// ---------- Basic controls ----------
const PLAY = 'M8 5v14l11-7z', PAUSE = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';
const toggle = () => v.paused ? v.play() : v.pause();
$('play').onclick = toggle; v.onclick = toggle;
v.onplay = () => $('playIcon').setAttribute('d', PAUSE);
v.onpause = () => $('playIcon').setAttribute('d', PLAY);
$('back').onclick = () => v.currentTime -= 10;
$('fwd').onclick = () => v.currentTime += 10;
$('mute').onclick = () => { v.muted = !v.muted; $('mute').style.opacity = v.muted ? .45 : 1; };
$('vol').oninput = e => { v.volume = e.target.value; v.muted = false; $('mute').style.opacity = 1; };
const rates = [1, 1.25, 1.5, 1.75, 2, 0.75];
let userRate = 1;
$('rate').onclick = () => { userRate = rates[(rates.indexOf(userRate) + 1) % rates.length]; v.playbackRate = userRate; $('rate').textContent = userRate + '×'; };
$('fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : player.requestFullscreen();

// ---------- Skip silence: long pauses jump or play at 8×, short ones play at 4× ----------
let skipOn = store.get('skipSilence', true), inGap = false, savedSec = 0, lastT = 0, totalSilence = 0;
let marginOn = store.get('silenceMargin', true), longJump = store.get('longJump', false);
const MARGIN = 0.3, LONG_RATE = 8;
// returns the effective [start, end] of the silence at t, shrunk by the optional safety margin
const silenceAt = t => { let lo = 0, hi = SILENCES.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, [a, b] = SILENCES[m];
    if (t < a) hi = m - 1; else if (t >= b) lo = m + 1;
    else { const pad = marginOn ? MARGIN : 0, s = a + pad, e = b - pad; return e - s >= 0.15 && t >= s && t < e ? [s, e] : null; } }
  return null; };
function endGap() { if (inGap) { inGap = false; v.playbackRate = userRate; } }
function setSkip(on) { skipOn = on; $('skipBtn').classList.toggle('on', on); store.set('skipSilence', on); if (!on) endGap(); }
$('skipBtn').onclick = () => setSkip(!skipOn);
function setMargin(on) { marginOn = on; $('marginBtn').classList.toggle('on', on); store.set('silenceMargin', on); endGap(); }
$('marginBtn').onclick = () => setMargin(!marginOn);
$('marginBtn').textContent = `+${MARGIN * 1000} ms margin`;
function setLong(jump) { longJump = jump; $('longBtn').textContent = jump ? 'Long pauses: Jump' : `Long pauses: ${LONG_RATE}×`; store.set('longJump', jump); endGap(); }
$('longBtn').onclick = () => setLong(!longJump);
setSkip(skipOn); setMargin(marginOn); setLong(longJump);
function silenceLoop() {
  if (!v.paused && skipOn && !v.seeking && SILENCES.length) {
    const t = v.currentTime, gap = silenceAt(t);
    if (gap) {
      const left = gap[1] - t, total = gap[1] - gap[0];
      if (total > 1.2 && longJump && left > 0.3) { v.currentTime = gap[1]; savedSec += left; endGap(); }
      else {
        const want = Math.max(userRate, total > 1.2 ? LONG_RATE : 4);
        if (!inGap || v.playbackRate !== want) { inGap = true; v.playbackRate = want; }
        else savedSec += (t - lastT) * (1 - 1 / v.playbackRate);
      }
    } else endGap();
    lastT = t;
  }
  requestAnimationFrame(silenceLoop);
}
requestAnimationFrame(silenceLoop);
setInterval(() => { $('saved').textContent = skipOn && SILENCES.length ? `Skip silence saved ${fmt(savedSec)} so far · ~${Math.round(totalSilence / 60)} min of pauses in total` : ''; }, 1000);

// ---------- Flag tagged (promo / filler) chapters ----------
function setFlag(on) { document.body.classList.toggle('flag', on); $('flagBtn').classList.toggle('on', on); store.set('flagPromos', on); }
$('flagBtn').onclick = () => setFlag(!document.body.classList.contains('flag'));
setFlag(store.get('flagPromos', true));

// ---------- Captions (fetched from captions.vtt, drawn as an overlay) ----------
let ccOn = store.get('captions', false);
const cueAt = t => { let lo = 0, hi = CUES.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (t < CUES[m][0]) hi = m - 1; else if (t >= CUES[m][1]) lo = m + 1; else return CUES[m][2]; }
  return ''; };
function setCC(on) { ccOn = on; $('ccBtn').classList.toggle('on', on); $('caption').classList.toggle('off', !on); store.set('captions', on); }
$('ccBtn').onclick = () => setCC(!ccOn);
setCC(ccOn);
(function ccLoop() { if (ccOn) { const txt = cueAt(v.currentTime); if ($('caption').textContent !== txt) $('caption').textContent = txt; } requestAnimationFrame(ccLoop); })();

// ---------- Resume where you left off (per webinar) ----------
const posKey = () => 'resumeAt:' + webinarId;
const savePos = () => { if (webinarId) try { localStorage.setItem(posKey(), v.currentTime.toFixed(1)); } catch {} };
v.addEventListener('loadedmetadata', () => {
  dur = v.duration; build();
  let at = 0; try { at = parseFloat(localStorage.getItem(posKey())) || 0; } catch {}
  if (at > 1 && at < dur - 5) v.currentTime = at;
});
setInterval(() => { if (!v.paused) savePos(); }, 2000);
v.addEventListener('pause', savePos);
v.addEventListener('seeked', savePos);
window.addEventListener('pagehide', savePos);
v.addEventListener('timeupdate', render);
v.addEventListener('seeked', render);
v.addEventListener('progress', () => { if (v.buffered.length) fillTo(segEls, v.buffered.end(v.buffered.length - 1), '.buf'); });
v.addEventListener('error', () => { if (v.getAttribute('src')) player.innerHTML = '<div class="err">Couldn\'t load the video file.</div>'; });
window.addEventListener('resize', render);

let idleT;
const wake = () => { player.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => !v.paused && player.classList.add('idle'), 2500); };
player.addEventListener('mousemove', wake);

$('filter').oninput = e => { const q = e.target.value.toLowerCase(); liEls.forEach((li, i) => li.classList.toggle('hide', !chapters[i].title.toLowerCase().includes(q))); };

document.addEventListener('keydown', e => {
  if (!chapters.length || (e.target.tagName === 'INPUT' && e.target.type !== 'range')) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
  else if (k === 'arrowleft' || k === 'j') v.currentTime -= 10;
  else if (k === 'arrowright' || k === 'l') v.currentTime += 10;
  else if (k === 'm') $('mute').click();
  else if (k === 'f') $('fs').click();
  else if (k === 'c' && CUES.length) $('ccBtn').click();
  else if (k === 's' && SILENCES.length) $('skipBtn').click();
  else if (k === 'p') $('flagBtn').click();
  else if (k === '.') v.currentTime = chapters[Math.min(chapters.length - 1, chapterAt(v.currentTime) + 1)].start;
  else if (k === ',') { const i = chapterAt(v.currentTime); v.currentTime = chapters[v.currentTime - chapters[i].start > 3 ? i : Math.max(0, i - 1)].start; }
  wake();
});

const wid = new URLSearchParams(location.search).get('w');
wid ? loadWebinar(wid) : showLibrary();
