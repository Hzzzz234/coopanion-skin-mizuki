import { createSticker } from './sticker.js';

const SVG = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const finite = v => Number.isFinite(v) ? v : 0;
const smooth = v => { const k = clamp(v); return k*k*(3-2*k); };
const ANNOYED = 'mizuki-annoyed';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`无法读取水月贴图 ${url}`));
    img.src = String(url);
  });
}

function drawMark(ctx, face, t) {
  if (face === 'dragged' || face === 'squeeze') {
    ctx.translate(191, 96 + 2*Math.sin(t*7));
    ctx.fillStyle = '#a9dcf7';
    ctx.strokeStyle = '#477ba5';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0,-6);
    ctx.quadraticCurveTo(8,3,3,6);
    ctx.quadraticCurveTo(-3,8,-4,3);
    ctx.quadraticCurveTo(-4,0,0,-6);
    ctx.fill(); ctx.stroke();
  } else if (face === ANNOYED || face === 'angry') {
    ctx.translate(199, 68);
    ctx.strokeStyle = '#d95e68';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i=0;i<4;i++) {
      ctx.beginPath();
      ctx.moveTo(-8,-2);
      ctx.quadraticCurveTo(-2,-2,-2,-8);
      ctx.stroke();
      ctx.rotate(Math.PI/2);
    }
  } else if (face === 'surprised' || face === 'scared') {
    ctx.translate(193, 64);
    ctx.fillStyle = '#384c79';
    ctx.beginPath(); ctx.roundRect(-1.3,-7,2.6,9,1.3); ctx.fill();
    ctx.beginPath(); ctx.arc(0,5,1.3,0,TAU); ctx.fill();
  }
}

export async function createMizukiFigure(base = new URL('./',import.meta.url), opts = {}) {
  const asset = opts.asset || (name => new URL(name,base));
  const load = opts.loadImage || loadImage;
  const model = opts.model ?? await fetch(asset('model.json')).then(r => {
    if (!r.ok) throw new Error('无法读取水月 model.json');
    return r.json();
  });
  const [left,top,right,bottom] = model.view;
  const width = right-left, height = bottom-top;
  const [tw,th] = model.cell;
  const frames = Object.fromEntries(await Promise.all(Object.entries(model.sequences).map(async ([name,sheets]) => {
    const atlases = await Promise.all(sheets.map(async sheet => {
      const img = await load(asset(sheet.file));
      if (img.naturalWidth !== sheet.columns*tw || img.naturalHeight !== Math.ceil(sheet.count/sheet.columns)*th)
        throw new Error(`水月贴图尺寸错误 ${sheet.file}`);
      return Array.from({length:sheet.count},(_,i) => ({img,x:(i%sheet.columns)*tw,y:Math.floor(i/sheet.columns)*th}));
    }));
    return [name,atlases.flat()];
  })));

  let owner, box, surface, ctx, overlay, sticker, lastFace, faceAt = 0, released = -Infinity, previousMode;
  let lastFrame, density = 0, phase = 0, prevTime;
  function mount(group) {
    sticker?.hide();
    owner = group;
    const doc = group.ownerDocument;
    box = doc.createElementNS(SVG,'foreignObject');
    for (const [name,value] of Object.entries({x:left,y:top,width,height})) box.setAttribute(name,value);
    surface = doc.createElement('canvas');
    surface.style.cssText='width:100%;height:100%;display:block';
    box.appendChild(surface);
    overlay = doc.createElementNS(SVG,'g');
    group.replaceChildren(box,overlay);
    ctx = surface.getContext('2d');
    sticker = createSticker(base,{loadImage:load});
    lastFrame = null;
    density = 0;
  }

  function pose(name, progress = 0) {
    const cells = frames[name];
    return cells[Math.min(cells.length-1,Math.floor(clamp(progress)*cells.length))];
  }

  function draw(group, fc = {}, o = {}, fixedDensity = 0) {
    if (owner !== group || !group.contains(box)) mount(group);
    const ctm = group.getScreenCTM();
    const pixels = clamp(fixedDensity || Math.hypot(ctm?.c ?? 0,ctm?.d ?? 1)*(globalThis.devicePixelRatio||1),1,4);
    if (Math.abs(pixels-density)>.08) {
      density = pixels;
      surface.width = Math.round(width*pixels);
      surface.height = Math.round(height*pixels);
      lastFrame = null;
    }
    const mode = o.mode || 'idle';
    const t = finite(o.t), age = finite(o.modeT), kind = o.gesture?.kind;
    const face = o.face || 'neutral';
    const k = clamp(finite(o.gesture?.k));
    if (lastFace !== face) { lastFace=face; faceAt=t; }
    if (previousMode==='drag' && mode==='air') released=t;
    if (previousMode==='air' && mode==='land' && Number.isFinite(released)) released=t;
    if (mode==='dizzy' || mode==='drag') released=-Infinity;
    const dt = clamp(t-(prevTime ?? t),0,.075);
    prevTime=t;
    previousMode=mode;
    let marker = face;
    let frame;
    if (mode==='walk' || mode==='run' || mode==='dance') {
      const gait = mode==='run' ? 'run' : 'walk';
      phase=(phase+dt/(gait==='run'?.47:.57))%1;
      frame=pose(gait,phase);
    } else {
      phase=0;
      const sit = clamp(finite(o.sit));
      if (mode==='drag' || (mode==='air' && face==='dragged')) {
        frame=pose('drag',(age*2.7)%1);
        marker='dragged';
      } else if (mode==='dizzy' && age<2.4) {
        frame=age<.12 ? pose('sit',smooth(age/.12)) : pose('dizzy',(age-.12)/2.28);
      } else if (mode==='crouch') {
        frame=pose('crouch',age/.16);
      } else if (mode==='air' && face!=='surprised') {
        frame=pose('air',age/.61);
      } else if (mode==='land' && t-released>.9) {
        frame=pose('land',age/.31);
      } else if (mode==='sleep' && sit>.88) {
        frame=pose('sleep',(age/1.55)%1);
      } else if (sit>.045 && mode!=='land' && mode!=='air') {
        frame=pose('sit',sit);
      } else {
        if (t-released<.90 && (mode==='air' || mode==='land' || mode==='idle')) marker='surprised';
        if (marker===ANNOYED || marker==='angry' || marker==='pout' || marker==='determined') {
          frame=pose('annoyed',marker===ANNOYED || marker==='angry' ? (t-faceAt)/.667 : 1);
          if (face==='angry' && ['idle','look','land','sit'].includes(mode)) opts.setAnnoyed?.();
        } else if (marker==='love') frame=pose('love');
        else if (marker==='wink') frame=pose('wink');
        else if (['happy','smug','excited','bowing','content'].includes(marker)) frame=pose('happy',((t-faceAt)*2)%1);
        else if (['surprised','scared','confused','waking','cry'].includes(marker) || finite(o.talk)>.47) frame=pose('surprised');
        else if (['sleep','sleepy','flustered','squeeze'].includes(marker) || finite(o.blink)>.68) frame=pose('blink');
        else frame=pose('standing');
      }
    }

    const arc = Math.sin(Math.PI*k);
    const angle = kind==='nod' ? 3*arc*Math.sin(k*TAU) : kind==='shake' ? 3*arc*Math.sin(k*TAU*2)
      : kind==='bow' ? 8*arc : kind==='wave' ? 2*arc*Math.sin(k*TAU*2) : 0;
    const paintMark = [ANNOYED,'angry','dragged','squeeze','surprised','scared'].includes(marker);
    const key = [frame,angle,paintMark ? marker : '',marker==='dragged' || marker==='squeeze' ? Math.floor(t*25) : 0];
    if (!lastFrame || key.some((part,i) => lastFrame[i] !== part)) {
      ctx.setTransform(surface.width/width,0,0,surface.height/height,-left*surface.width/width,-top*surface.height/height);
      ctx.clearRect(left,top,width,height);
      ctx.save();
      if (angle) {
        ctx.translate(128,256); ctx.rotate(angle*Math.PI/180); ctx.translate(-128,-256);
      }
      ctx.drawImage(frame.img,frame.x,frame.y,tw,th,...model.image);
      ctx.restore();
      if (paintMark) { ctx.save(); drawMark(ctx,marker,t); ctx.restore(); }
      lastFrame=key;
    }
    if (!fixedDensity) sticker.tick(t,overlay,{face:marker===ANNOYED?'angry':marker,mode});
  }

  return {
    draw,
    notePoke() { lastFace=undefined; },
    groupTilt: (mode,tilt,lean) => mode==='run' || mode==='walk' ? 0
      : mode==='drag' ? clamp(finite(tilt)*.55,-11,11) : finite(tilt)*.42+finite(lean)*.33,
    gestures:['nod','shake','wave','bow'],
    colors:{z:'#557eb5'},
    anchors:{gaze:[145,144],tear:[132,154],tears:[[131,151],[165,147]],z:[182,64],hearts:[91,169,42],bubble:[128,46]},
    extent:[41,37,218,258],
    hits:[[128,113,64],[132,202,50]],
    model,
    schemes:[],
    setScheme: () => Promise.resolve(),
    preload: () => Promise.resolve(),
    painted: Promise.resolve(),
    dispose() { sticker?.hide(); owner?.replaceChildren(); owner=undefined; }
  };
}

export async function createMizukiBody(base, opts) {
  let body;
  const figure = await createMizukiFigure(base,{...opts,setAnnoyed:() => body?.do(ANNOYED)});
  const host = {...opts.host, emit(kind,detail) {
    if (kind==='touch' && detail?.kind==='poke') figure.notePoke();
    opts.host.emit(kind,detail);
  }};
  body=opts.kit.createBody(host,{figure,words:{[ANNOYED]:{expression:{like:'pout',seconds:1.50}}}});
  const runWord=body.do;
  body.do=word => runWord(word==='angry' ? ANNOYED : word);
  return body;
}
