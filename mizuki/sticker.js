/**
 * 桌宠自己"发表情包"：把 media/ 里的小工具刚发射的图片举到身边。
 *
 * 形象包的代码跑在沙箱里，碰不到文件系统、也调不动资源管理器；它只能从自己所在的
 * 形象包地址读文件。所以分工是：
 *   tools\media.ps1  —— 找到 Coopanion、打开文件夹、从 data\media 挑一张图，
 *                       转成 PNG 写进 <形象包>\media\current.png，同时把 <形象包>\media\stamp.png
 *                       刷成一个新的随机颜色（这就是"新快递到了"的信号）。
 *   这个文件         —— 每隔一会儿只读 stamp.png（一张 4×4 的图，几十字节），颜色变了才去读
 *                       current.png，然后把它举到身边，弹一下、停几秒、淡出。
 * 读的是同一个本地服务（形象包自己的目录），不联网、不扫盘。
 */

const NS = 'http://www.w3.org/2000/svg';

// 表情 → 图片文件夹（tools\media.ps1 把 data\media 里同名子文件夹的图同步到 media\moods\<名字>\）
const MOOD_OF = {
  neutral: 'neutral', happy: 'happy', content: 'happy', listening: 'happy', wink: 'happy',
  love: 'love', shy: 'shy', flustered: 'shy', surprised: 'surprised', scared: 'surprised', waking: 'surprised',
  angry: 'angry', determined: 'angry', sad: 'sad', cry: 'sad', worried: 'sad',
  sleepy: 'sleepy', sleep: 'sleepy', squeeze: 'sleepy', excited: 'excited', thinking: 'thinking',
  smug: 'smug', pout: 'pout', confused: 'confused', dizzy: 'confused',
};
const SLOTS = 8;            // 每个心情最多同步 8 张
const AUTO_MIN = 26;        // 秒：自动发一张的最短间隔
const AUTO_MAX = 62;        // 秒：最长间隔
const AUTO_COOLDOWN = 14;   // 秒：手动发射后先安静一会儿
const POLL = 1.7;        // 秒：多久看一眼 stamp
const HOLD = 6.4;        // 秒：举在手里多久
const FADE = 0.6;        // 秒：淡出
const BOX = 78;          // 单位：图片最长边（台面单位，256 = 全身高）

export function createSticker(base, opts = {}) {
  const urlOf = p => new URL(p, base).href;
  const load = opts.loadImage || (url => new Promise((ok, bad) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => ok(im);
    im.onerror = () => bad(new Error('no image'));
    im.src = url;
  }));

  const probe = document.createElement('canvas');
  probe.width = 4; probe.height = 4;
  const pctx = probe.getContext('2d', { willReadFrequently: true });

  let host = null, g = null, imgEl = null, frameEl = null;
  let stamp = null, busy = false, nextAt = 0, now = 0, stampMissing = false;
  let card = null, shownAt = 0;
  // 自动发射：下一次的时间、每个心情"有图的槽位"、以及整体没图时的退避
  let autoAt = 6 + Math.random() * 10, autoBusy = false, lastShown = -1e9;
  const missing = new Map();   // mood -> Set(不可用的序号)
  let noMoodsUntil = 0, resetAt = 0;

  /** 4×4 缩略图的像素，作为"这张图是哪张"的指纹。 */
  function readStamp(image) {
    try {
      pctx.clearRect(0, 0, 4, 4);
      pctx.drawImage(image, 0, 0, 4, 4);
      const d = pctx.getImageData(0, 0, 4, 4).data;
      const sig = Array.from(d).join(',');
      // 工具把发射时刻写在 0、1 号像素上（16 位秒数，约 18 小时回绕），B 通道是标记
      let fired = null;
      if (d[2] === 0x9E && d[6] === 0x37) fired = d[0] | (d[1] << 8) | (d[4] << 16) | (d[5] << 24);
      return { sig, fired };
    } catch { return null; }
  }

  /** 只在 90 秒内发射过的才算"新的"：宠物重启时不会把上次那张又举一遍。 */
  function isFresh(fired) {
    if (fired == null) return false;
    const nowSec = Math.floor(Date.now() / 1000) % 65536;
    const age = ((nowSec - fired) % 65536 + 65536) % 65536;
    return age < 90;
  }

  function ensure(group) {
    if (host === group && g && g.parentNode === group) return;
    host = group;
    if (!g) {
      g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'sticker');
      g.setAttribute('pointer-events', 'none');
      g.style.display = 'none';
    }
    group.appendChild(g);
  }

  function hide() {
    card = null;
    if (g) { g.style.display = 'none'; g.replaceChildren(); }
    imgEl = null; frameEl = null;
  }

  function show(image, at) {
    const w = image.naturalWidth || image.width || 1;
    const h = image.naturalHeight || image.height || 1;
    const k = BOX / Math.max(w, h);
    const W = Math.max(8, w * k), H = Math.max(8, h * k);
    const pad = 2.6;
    const x = 168, y = 22;                       // rig 单位：脑袋右边、肩膀上方
    const rot = (Math.random() * 6 - 3);         // 一点点歪，像随手贴上去的

    frameEl = document.createElementNS(NS, 'rect');
    frameEl.setAttribute('x', String(-pad));
    frameEl.setAttribute('y', String(-pad));
    frameEl.setAttribute('width', String(W + pad * 2));
    frameEl.setAttribute('height', String(H + pad * 2));
    frameEl.setAttribute('rx', '4.5');
    frameEl.setAttribute('fill', '#fdfdfb');
    frameEl.setAttribute('stroke', 'rgba(60,44,32,.35)');
    frameEl.setAttribute('stroke-width', '.9');

    imgEl = document.createElementNS(NS, 'image');
    imgEl.setAttribute('href', image.src);
    imgEl.setAttribute('x', '0');
    imgEl.setAttribute('y', '0');
    imgEl.setAttribute('width', String(W));
    imgEl.setAttribute('height', String(H));
    imgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    g.replaceChildren(frameEl, imgEl);
    g.style.display = '';
    g.dataset.x = String(x);
    g.dataset.y = String(y);
    g.dataset.rot = String(rot);
    card = { W, H };
    shownAt = (at == null ? now : at);
    lastShown = shownAt;
  }

  /** 每帧调用：group 是形象包里给贴纸留的 <g>，t 是桌宠自己的时钟（秒），ctx 是当前表情与动作。 */
  function tick(t, group, ctx) {
    if (!group) return;
    now = t;
    ensure(group);
    if (g && card) {
      const age = Math.max(0, t - shownAt);
      const life = HOLD + FADE;
      if (age > life) { hide(); }
      else {
        // 弹出：先蹿到 1.08，再落回 1；之后轻轻浮着，最后淡出
        const pop = age < .3 ? 0.55 + 0.45 * easeOutBack(Math.min(1, age / .3)) : 1;
        const sway = Math.sin(age * 2.1) * 1.4 + Math.sin(age * 3.7) * .5;
        const lift = -Math.min(age, .9) * 2.2 - Math.abs(sway) * .35;
        const opacity = age < HOLD ? 1 : Math.max(0, 1 - (age - HOLD) / FADE);
        const x = Number(g.dataset.x), y = Number(g.dataset.y), rot = Number(g.dataset.rot);
        const k = (BOX / Math.max(card.W, card.H)) === 0 ? 1 : 1;   // 尺寸已经在图片上定好
        g.setAttribute('transform',
          `translate(${f(x + sway)} ${f(y + lift)}) rotate(${f(rot + (card ? 0 : 0))}) scale(${f(pop * k)})`);
        g.setAttribute('opacity', f(opacity));
      }
    }
    if (busy || t < nextAt) return;
    nextAt = t + (stampMissing ? 12 : POLL);   // 还没发射过：12 秒问一次就够，别空转
    poll();

    // —— 自动发表情包：按现在这张脸去对应心情的文件夹里随手拿一张 ——
    if (autoBusy || t < autoAt || t < noMoodsUntil) return;
    if (t - lastShown < AUTO_COOLDOWN) return;
    const face = ctx && ctx.face, mode = ctx && ctx.mode;
    if (mode === 'drag' || mode === 'air' || mode === 'crouch') { autoAt = t + 6; return; }
    autoAt = t + AUTO_MIN + Math.random() * (AUTO_MAX - AUTO_MIN);
    autoBusy = true;
    autoSend(t, MOOD_OF[face] || 'any').then(ok => {
      autoBusy = false;
      if (!ok && !card) noMoodsUntil = t + 300;   // 一个心情都没图：五分钟后再试，别每半分钟去问一遍
    });
  }

  /** 从某个心情的槽位里随机拿一张；拿不到就试 any。 */
  function autoSend(t, mood) {
    return tryMood(t, mood).then(ok => ok ? true : (mood === 'any' ? false : tryMood(t, 'any')));
  }

  /** 在 1..SLOTS 的槽位里随机挑几个没试坏的，加载到就举起来。 */
  function tryMood(t, mood) {
    if (now - (resetAt || 0) > 300) { missing.clear(); resetAt = now; }   // 五分钟清一次，重新发现新同步的图
    if (!missing.has(mood)) missing.set(mood, new Set());
    const bad = missing.get(mood);
    const order = [];
    for (let i = 1; i <= SLOTS; i++) if (!bad.has(i)) order.push(i);
    if (!order.length) return Promise.resolve(false);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    let p = Promise.resolve(false);
    order.slice(0, 3).forEach(k => {
      p = p.then(ok => ok ? true : load(urlOf(`media/moods/${mood}/${k}.png`) + '?v=' + Date.now())
        .then(pic => { show(pic, t); return true; })
        .catch(() => { bad.add(k); return false; }));
    });
    return p;
  }

  function poll() {
    busy = true;
    load(urlOf('media/stamp.png') + '?v=' + Date.now())
      .then(im => {
        stampMissing = false;
        const read = readStamp(im);
        if (!read) return;
        if (read.sig === stamp) return;
        stamp = read.sig;
        if (!isFresh(read.fired)) return;
        return load(urlOf('media/current.png') + '?v=' + Date.now()).then(pic => show(pic));
      })
      .catch(() => { stampMissing = true; })
      .then(() => { busy = false; }, () => { busy = false; });
  }

  const f = n => Math.round(n * 100) / 100;
  function easeOutBack(x) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }

  return { tick, hide };
}
