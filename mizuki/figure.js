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
  let dragTilt = 0, dragTiltVelocity = 0, dragVelocity = 0, dragExcursion = 0;
  let dragStepped = false;
  function advanceDrag(dt) {
    // A damped pendulum retains angular momentum after the pointer stops.
    // Negative SVG rotation moves the body to the right below its head pivot.
    const target=-76*Math.tanh((dragVelocity*.014+dragExcursion*.075)/48);
    const omega=7, damping=3.0, frequency=Math.sqrt(omega*omega-damping*damping);
    const error=dragTilt-target;
    const decay=Math.exp(-damping*dt);
    const cosine=Math.cos(frequency*dt), sine=Math.sin(frequency*dt);
    const velocity=dragTiltVelocity;
    dragTilt=target+decay*(error*cosine+(velocity+damping*error)/frequency*sine);
    dragTiltVelocity=decay*(velocity*cosine-(damping*velocity+omega*omega*error)/frequency*sine);
  }
  const eyeCanvas = document.createElement('canvas');
  eyeCanvas.width = tw;
  eyeCanvas.height = th;
  const eyeContext = eyeCanvas.getContext('2d', {willReadFrequently:true});
  const eyePositions = new WeakMap();

  function findEyes(frame) {
    if (eyePositions.has(frame)) return eyePositions.get(frame);
    const pixels=eyeContext.getImageData(0,0,tw,th).data;
    const marked=new Uint8Array(tw*th),parts=[];
    for(let y=85;y<185;y++) for(let x=85;x<215;x++) {
      const i=y*tw+x,k=i*4;
      marked[i]=pixels[k]-pixels[k+1]>20 && pixels[k+2]-pixels[k+1]>5 &&
        pixels[k]<245 && pixels[k+1]<190 && pixels[k]-pixels[k+2]>-8 ? 1 : 0;
    }
    for(let i=0;i<marked.length;i++) {
      if(!marked[i]) continue;
      marked[i]=0;
      const queue=[i];
      let x0=tw,y0=th,x1=0,y1=0;
      for(let j=0;j<queue.length;j++) {
        const p=queue[j],x=p%tw,y=Math.floor(p/tw);
        x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
        for(const n of [p-1,p+1,p-tw,p+tw]) if(marked[n]) {marked[n]=0;queue.push(n);}
      }
      if(queue.length>12 && y1-y0>5) parts.push({x:(x0+x1)/2,y:(y0+y1)/2,rx:(x1-x0)/2+3,ry:(y1-y0)/2+2,area:queue.length});
    }
    parts.sort((a,b)=>b.area-a.area);
    const near=parts[0];
    const far=near && parts.find(p=>p.x>near.x+12 && Math.abs(p.y-near.y)<15);
    const eyes=near && far ? [near,far] : [];
    eyePositions.set(frame,eyes);
    return eyes;
  }

  // Warp only the interior of each eye. The fixed boundary preserves the
  // original lashes, fringe and skin without painting a replacement patch.
  function gazeFrame(frame, look, wink) {
    eyeContext.clearRect(0,0,tw,th);
    eyeContext.drawImage(frame.img,frame.x,frame.y,tw,th,0,0,tw,th);
    const dynamic=frames.walk.includes(frame)||frames.run.includes(frame)||frames.sit.includes(frame);
    const eyes=dynamic ? findEyes(frame) : [
      {x:(259-65)*tw/370,y:(227-26)*th/427,rx:18*tw/370,ry:23*th/427},
      {x:(318-65)*tw/370,y:(220-26)*th/427,rx:11*tw/370,ry:20*th/427},
    ];
    for (const [index,eye] of eyes.entries()) {
      if (wink && index===1) continue;
      const {x:px,y:py,rx:ex,ry:ey}=eye;
      const x0=Math.floor(px-ex),y0=Math.floor(py-ey);
      const w=Math.ceil(ex*2)+2,h=Math.ceil(ey*2)+2;
      const original=eyeContext.getImageData(x0,y0,w,h);
      const output=new ImageData(new Uint8ClampedArray(original.data),w,h);
      for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
        const radius=Math.hypot((x+x0-px)/ex,(y+y0-py)/ey);
        const offset=(y*w+x)*4;
        const [r,g,b]=original.data.subarray(offset,offset+3);
        const hair=b-r>7;
        const lid=1-smooth((py-y0-y)/(ey*.62));
        const weight=(1-smooth((radius-.48)/.48))*lid*(hair ? 0 : 1);
        const sx=clamp(x-look[0]*1.65*weight,0,w-1.001);
        const sy=clamp(y-look[1]*1.05*weight,0,h-1.001);
        const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
        for(let c=0;c<4;c++) {
          const a=original.data[(iy*w+ix)*4+c]*(1-fx)+original.data[(iy*w+ix+1)*4+c]*fx;
          const b=original.data[((iy+1)*w+ix)*4+c]*(1-fx)+original.data[((iy+1)*w+ix+1)*4+c]*fx;
          output.data[offset+c]=a*(1-fy)+b*fy;
        }
      }
      eyeContext.putImageData(output,x0,y0);
    }
    return eyeCanvas;
  }
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
    const mode = o.mode || 'idle';
    const ctm = group.getScreenCTM();
    // Rotation and squash must not repeatedly resize and clear the canvas.
    const pixels = clamp(fixedDensity || Math.sqrt(Math.abs(ctm ? ctm.a*ctm.d-ctm.b*ctm.c : 1))*(globalThis.devicePixelRatio||1),1,4);
    if ((!density || mode!=='drag') && Math.abs(pixels-density)>.08) {
      density = pixels;
      surface.width = Math.round(width*pixels);
      surface.height = Math.round(height*pixels);
      lastFrame = null;
    }
    const t = finite(o.t), age = finite(o.modeT), kind = o.gesture?.kind;
    const face = o.face || 'neutral';
    const k = clamp(finite(o.gesture?.k));
    if (lastFace !== face) { lastFace=face; faceAt=t; }
    if (previousMode==='drag' && mode==='air') released=t;
    if (previousMode==='air' && mode==='land' && Number.isFinite(released)) released=t;
    if (mode==='dizzy' || mode==='drag') released=-Infinity;
    const dt = clamp(t-(prevTime ?? t),0,.075);
    if (!dragStepped) advanceDrag(dt);
    prevTime=t;
    previousMode=mode;
    let marker = face;
    let frame;
    let dragNext,dragMix=0;
    if (mode==='walk' || mode==='run' || mode==='dance') {
      const gait = mode==='run' ? 'run' : 'walk';
      phase=(phase+dt/(gait==='run'?.47:.57))%1;
      frame=pose(gait,phase);
    } else {
      phase=0;
      const sit = clamp(finite(o.sit));
      if (mode==='drag' || (mode==='air' && face==='dragged')) {
        const position=((age*2.7)%1)*frames.drag.length;
        const i=Math.floor(position);
        frame=frames.drag[i];
        dragNext=frames.drag[(i+1)%frames.drag.length];
        dragMix=position-i;
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
    const trackEyes=['standing','surprised','love','wink','crouch','air','land','walk','run','sit'].some(name=>frames[name].includes(frame));
    const look=trackEyes ? [clamp(finite(o.look?.[0])/5,-1,1),clamp(finite(o.look?.[1])/4,-1,1)] : [0,0];
    const key = [frame,angle,paintMark ? marker : '',marker==='dragged' || marker==='squeeze' ? t : 0,look[0],look[1],dragMix];
    if (!lastFrame || key.some((part,i) => lastFrame[i] !== part)) {
      ctx.setTransform(surface.width/width,0,0,surface.height/height,-left*surface.width/width,-top*surface.height/height);
      ctx.clearRect(left,top,width,height);
      ctx.save();
      if (angle) {
        ctx.translate(128,256); ctx.rotate(angle*Math.PI/180); ctx.translate(-128,-256);
      }
      if (trackEyes && (look[0] || look[1])) ctx.drawImage(gazeFrame(frame,look,marker==='wink'),...model.image);
      else ctx.drawImage(frame.img,frame.x,frame.y,tw,th,...model.image);
      if (dragNext && dragMix>0) {
        // Interpolate the very small limb differences at display frequency.
        ctx.globalCompositeOperation='copy';
        eyeContext.clearRect(0,0,tw,th);
        eyeContext.globalCompositeOperation='source-over';
        eyeContext.globalAlpha=1-dragMix;
        eyeContext.drawImage(frame.img,frame.x,frame.y,tw,th,0,0,tw,th);
        eyeContext.globalCompositeOperation='lighter';
        eyeContext.globalAlpha=dragMix;
        eyeContext.drawImage(dragNext.img,dragNext.x,dragNext.y,tw,th,0,0,tw,th);
        eyeContext.globalAlpha=1;
        eyeContext.globalCompositeOperation='source-over';
        ctx.drawImage(eyeCanvas,...model.image);
        ctx.globalCompositeOperation='source-over';
      }
      ctx.restore();
      if (paintMark) { ctx.save(); drawMark(ctx,marker,t); ctx.restore(); }
      lastFrame=key;
    }
    if (!fixedDensity) sticker.tick(t,overlay,{face:marker===ANNOYED?'angry':marker,mode});
  }

  return {
    draw,
    stepDrag(dt) { dragStepped=true; advanceDrag(dt); },
    setDragVelocity(value) { dragVelocity=finite(value); dragExcursion=0; },
    setDragMotion(velocity,excursion) {
      dragVelocity=finite(velocity);
      dragExcursion=finite(excursion);
    },
    notePoke() { lastFace=undefined; },
    groupTilt: (mode,tilt,lean) => mode==='run' || mode==='walk' ? 0
      : mode==='drag' ? 48*Math.tanh(dragTilt/48) : finite(tilt)*.42+finite(lean)*.33,
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
  let headUnderPointer=false, nativeHeadPet=false, suppressHeadHearts=false;
  const figure = await createMizukiFigure(base,{...opts,setAnnoyed:() => body?.do(ANNOYED)});
  const host = {...opts.host, emit(kind,detail) {
    if (kind==='touch' && detail?.kind==='poke') {figure.notePoke();suppressHeadHearts=false;}
    if (kind==='touch' && detail?.kind==='pet' && headUnderPointer) {
      nativeHeadPet=!detail.asleep;
      return;
    }
    opts.host.emit(kind,detail);
  }};
  body=opts.kit.createBody(host,{figure,words:{[ANNOYED]:{expression:{like:'pout',seconds:1.50}}}});
  const runWord=body.do;
  body.do=word => {
    if(word==='love') suppressHeadHearts=false;
    return runWord(word==='angry' ? ANNOYED : word);
  };
  const pointer=body.pointer;
  const step=body.step;
  let previousPointer,velocity=0,excursion=0,lastMove=0,clock=0;
  const samples=[];
  let strokeOrigin,strokeAxis,strokePeak=0,lastPetAt=-Infinity,lastStrokeAt=0;
  function resetStroke() { strokeOrigin=strokeAxis=undefined;strokePeak=0; }
  function petHead(p,now,layout) {
    const head=layout.hit?.[0];
    headUnderPointer=!!head && Math.hypot(p.x-head.x,p.y-head.y)<=head.r;
    if(!headUnderPointer || layout.pressing || layout.mode==='sleep' || layout.mode==='dizzy') {
      resetStroke(); return;
    }
    if(now-lastStrokeAt>700) resetStroke();
    lastStrokeAt=now;
    const point=[(p.x-head.x)/head.r,(p.y-head.y)/head.r];
    if(!strokeOrigin) {strokeOrigin=point;return;}
    const dx=point[0]-strokeOrigin[0],dy=point[1]-strokeOrigin[1];
    const distance=Math.hypot(dx,dy);
    if(!strokeAxis && distance>=.32) strokeAxis=[dx/distance,dy/distance];
    if(!strokeAxis) return;
    const travel=dx*strokeAxis[0]+dy*strokeAxis[1];
    strokePeak=Math.max(strokePeak,travel);
    if(strokePeak-travel>=.32 && now-lastPetAt>1200 && runWord('love')) {
      lastPetAt=now;
      suppressHeadHearts=false;
      opts.host.emit('touch',{kind:'pet',asleep:false});
      resetStroke();
    }
  }
  body.pointer=(type,p)=>{
    const eventTime=Number.isFinite(p.t) ? p.t : performance.now();
    if(type==='move') petHead(p,eventTime,body.layout());
    else if(type==='down' || type==='leave' || type==='cancel') {resetStroke();headUnderPointer=false;}
    if(type==='move' || type==='down') {
      const now=Number.isFinite(p.t) ? p.t : performance.now();
      const elapsed=previousPointer ? (now-previousPointer.t)/1000 : 0;
      const scale=Math.max(.1,finite(opts.host.bounds().S)||1);
      const moving=type==='move' && elapsed>0 && elapsed<.2;
      const distance=moving ? (p.x-previousPointer.x)/scale : 0;
      if(!moving) samples.length=0;
      samples.push({x:p.x,t:now});
      while(samples.length>2 && now-samples[0].t>45) samples.shift();
      const first=samples[0];
      velocity=moving ? (p.x-first.x)/scale/Math.max(.001,(now-first.t)/1000) : 0;
      if(!moving) excursion=0;
      else if(Math.abs(distance)>.15) {
        excursion=Math.sign(distance)===Math.sign(excursion) ? excursion+distance : distance;
      }
      previousPointer={x:p.x,t:now};
      lastMove=clock;
    } else if(type==='up' || type==='cancel' || type==='leave') {velocity=0;excursion=0;}
    const layout=body.layout();
    if(type==='move' && layout.mode==='sleep' && !layout.pressing) return pointer('leave',p);
    const result=pointer(type,p);
    // The kit's broad pet gesture can choose shy at random. A head stroke
    // consistently uses love, including when both detectors fire together.
    if(nativeHeadPet) {
      nativeHeadPet=false;
      if(body.layout().mode!=='dizzy') {
        const completed=eventTime-lastPetAt<=3200;
        suppressHeadHearts=!completed;
        runWord(completed?'love':'neutral');
      }
    }
    return result;
  };
  body.step=(dt,draw=true)=>{
    const elapsed=clamp(finite(dt),0,.1);
    clock+=elapsed;
    const held=body.layout().mode==='drag' || body.layout().pressing;
    const active=held && clock-lastMove<=.10;
    figure.setDragMotion(active ? velocity : 0,active ? excursion : 0);
    // Keep the host's spring simulation stable during slower display frames.
    const count=Math.max(1,Math.ceil(elapsed*120));
    for(let i=0;i<count;i++) {
      figure.stepDrag(elapsed/count);
      step(elapsed/count,draw && i===count-1);
    }
    if(draw && suppressHeadHearts) opts.host.root.querySelectorAll('.p-heart').forEach(heart=>heart.remove());
  };
  return body;
}
