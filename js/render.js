// Pakali paver renderer: draws real-size pavers into marked areas of a photo, in perspective.
// No AI involved; everything outside the marked shapes is the untouched photo.
(function(global){
'use strict';

/* ---- small PRNG so the same job always draws the same pavers ---- */
function rng(seed){let s=seed>>>0||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return((s>>>0)%100000)/100000}}
function hash2(i,j){let h=(i*374761393+j*668265263)|0;h=(h^(h>>>13))*1274126177|0;return((h^(h>>>16))>>>0)/4294967296}

function noise(x,y){const i=Math.floor(x),j=Math.floor(y),fx=x-i,fy=y-j;const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  const a=hash2(i,j),b=hash2(i+1,j),c=hash2(i,j+1),d=hash2(i+1,j+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v}
/* ---- ground-plane camera model ----
   Camera at height hc (ft), level, focal f (px), horizon at row yh (px).
   Ground point under pixel (x,y): Z = f*hc/(y-yh), X = (x-cx)*hc/(y-yh). */
function makeCamera(W,H,yh,hc){
  const f=0.75*Math.max(W,H), cx=W/2;
  return {
    toGround(x,y){const d=y-yh;if(d<=0.5)return null;return [(x-cx)*hc/d, f*hc/d]},
    f,cx,yh,hc
  };
}
function polyArea(pts){let a=0;for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[(i+1)%pts.length];a+=p[0]*q[1]-q[0]*p[1]}return Math.abs(a)/2}

/* Choose horizon + camera height. The horizon sits a bit above the highest mark;
   camera height is then tuned so the marked area matches the square footage entered (if any). */
function fitCamera(W,H,shapes,sqft){
  let top=Infinity;shapes.forEach(s=>s.forEach(p=>{top=Math.min(top,p[1]*H)}));
  const yh=Math.max(-0.4*H, top-0.14*H);
  let hc=5;
  if(sqft>0){
    const cam=makeCamera(W,H,yh,1);
    let a1=0;shapes.forEach(s=>{const g=s.map(p=>cam.toGround(p[0]*W,p[1]*H));if(g.every(Boolean))a1+=polyArea(g)});
    if(a1>0){hc=Math.sqrt(sqft/a1);hc=Math.min(9,Math.max(3.5,hc))} // keep it believable
  }
  return makeCamera(W,H,yh,hc);
}

/* ---- paver layouts (plan view, inches). Return {id, u, v, w, h} = brick id + local coords + brick size ---- */
const LAYOUT={
  // rows 9" deep, pieces 6/9/12" long, random per row (Stonehurst 3-piece look)
  random(x,y){
    const row=Math.floor(y/9);const v=y-row*9;
    const off=hash2(row,7)*36;let xx=x+off;
    const cycle=hash2(row,3)<0.5?[12,9,6,9,12,6,9]:[9,12,6,12,9,6,12];
    const L=cycle.reduce((a,b)=>a+b,0);
    let k=Math.floor(xx/L);let r=xx-k*L;let i=0;while(r>=cycle[i]){r-=cycle[i];i++}
    return {id:row*1000+k*10+i,u:r,v,w:cycle[i],h:9};
  },
  running(x,y){
    const row=Math.floor(y/6);const v=y-row*6;const xx=x+(row%2?4.5:0);
    const k=Math.floor(xx/9);return {id:row*1000+k,u:xx-k*9,v,w:9,h:6};
  },
  // 90-degree herringbone with 4.5x9" bricks, laid 45 degrees to the edge
  herringbone(x,y){
    const a=4.5;const c=Math.SQRT1_2;const X=(x+y)*c/a,Y=(y-x)*c/a;
    const i=Math.floor(X),j=Math.floor(Y);const m=((i-j)%4+4)%4;
    // horizontal pair (m 0,1) / vertical pair (m 2,3)
    if(m<2){const bx=i-m;return {id:bx*100003+j,u:(X-bx)*a,v:(Y-j)*a,w:2*a,h:a}}
    const by=j-(3-m);return {id:i*100003+by+50000,u:(X-i)*a,v:(Y-by)*a,w:a,h:2*a};
  },
  // Turf Grid Tile: 24" squares, 4" turf joints
  turf(x,y){const P=28;const i=Math.floor(x/P),j=Math.floor(y/P);return {id:i*1000+j,u:x-i*P,v:y-j*P,w:24,h:24,turf:true}}
};

/* ---- main render ----
   photo: HTMLCanvasElement/Image (already sized), shapes: [[ [nx,ny],... ], ...] normalized,
   tex: {canvas of swatch (corrected), pxPerInch}, opts: {pattern, sqft, border, turfTex} */
function render(photo,shapes,tex,opts){
  const W=photo.width||photo.naturalWidth,H=photo.height||photo.naturalHeight;
  const out=document.createElement('canvas');out.width=W;out.height=H;const ctx=out.getContext('2d');
  ctx.drawImage(photo,0,0,W,H);
  shapes=shapes.filter(s=>s.length>=3);if(!shapes.length)return out;
  const cam=fitCamera(W,H,shapes,opts.sqft||0);

  // mask (anti-aliased) from the shapes
  const mc=document.createElement('canvas');mc.width=W;mc.height=H;const mx=mc.getContext('2d');
  mx.fillStyle='#fff';shapes.forEach(s=>{mx.beginPath();s.forEach((p,i)=>i?mx.lineTo(p[0]*W,p[1]*H):mx.moveTo(p[0]*W,p[1]*H));mx.closePath();mx.fill()});
  const mask=mx.getImageData(0,0,W,H).data;

  // align rows with the first edge of the first shape (usually along the house)
  const s0=shapes[0];const g0=cam.toGround(s0[0][0]*W,s0[0][1]*H),g1=cam.toGround(s0[1][0]*W,s0[1][1]*H);
  let ang=0;if(g0&&g1)ang=Math.atan2(g1[1]-g0[1],g1[0]-g0[0]);
  const ca=Math.cos(-ang),sa=Math.sin(-ang);const org=g0||[0,0];

  // soft lighting from the original photo (keeps big shadows, e.g. palm-tree shade)
  const small=document.createElement('canvas');const sw=64,sh=Math.round(64*H/W);small.width=sw;small.height=sh;
  const sx=small.getContext('2d');sx.filter='blur(2px)';sx.drawImage(photo,0,0,sw,sh);const sd=sx.getImageData(0,0,sw,sh).data;
  let lsum=0,ln=0;for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const mi=((Math.floor(y*H/sh))*W+Math.floor(x*W/sw))*4;if(mask[mi]>128){const k=(y*sw+x)*4;lsum+=sd[k]*.3+sd[k+1]*.59+sd[k+2]*.11;ln++}}
  const lmean=ln?lsum/ln:128;
  const light=(x,y)=>{const k=(Math.min(sh-1,Math.floor(y*sh/H))*sw+Math.min(sw-1,Math.floor(x*sw/W)))*4;
    const l=sd[k]*.3+sd[k+1]*.59+sd[k+2]*.11;return Math.max(0.55,Math.min(1.15,0.35+0.65*l/lmean))};

  const pal=tex.palette;const cum=[];let acc=0;pal.forEach(c=>{acc+=c[3];cum.push(acc)});
  const avg=[0,1,2].map(k=>pal.reduce((a,c)=>a+c[k]*c[3],0)/acc);
  const soft=pal.map(c=>[0,1,2].map(k=>c[k]*0.6+avg[k]*0.4).concat(c[3])); // calmer brick-to-brick contrast, like real blends
  const pick=h=>{h*=acc;for(let i=0;i<cum.length;i++)if(h<=cum[i])return soft[i];return soft[soft.length-1]};
  const turfT=opts.turfTex?opts.turfTex.getContext('2d').getImageData(0,0,opts.turfTex.width,opts.turfTex.height):null;
  const lay=LAYOUT[opts.pattern]||LAYOUT.random;
  const layer=document.createElement('canvas');layer.width=W;layer.height=H;const lx=layer.getContext('2d');
  const img=lx.createImageData(W,H);const d=img.data;
  const plan=(x,y)=>{const g=cam.toGround(x,y);if(!g)return null;const dx=(g[0]-org[0])*12,dy=(g[1]-org[1])*12;return [dx*ca-dy*sa,dx*sa+dy*ca]};
  const jointW=opts.pattern==='turf'?0:0.22; // inches
  const segs=[];if(opts.border){shapes.forEach(sh=>{const pp=sh.map(q=>plan(q[0]*W,q[1]*H));for(let i=0;i<pp.length;i++){const a=pp[i],b=pp[(i+1)%pp.length];if(a&&b)segs.push([a,b])}})}
  const edgeDist=p=>{let m=1e9;for(const [a,b] of segs){const dx=b[0]-a[0],dy=b[1]-a[1];const L=dx*dx+dy*dy||1;let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L;t=Math.max(0,Math.min(1,t));m=Math.min(m,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy))}return m};

  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const i4=(y*W+x)*4;const m=mask[i4];if(!m)continue;
      const p=plan(x+.5,y+.5);if(!p)continue;
      const q=plan(x+1.5,y+.5),r=plan(x+.5,y+1.5);
      const fp=q&&r?Math.max(Math.hypot(q[0]-p[0],q[1]-p[1]),Math.hypot(r[0]-p[0],r[1]-p[1])):1; // inches per pixel
      let b=lay(p[0],p[1]);let isBorder=false;
      if(segs.length){const ed=edgeDist(p);if(ed<9){isBorder=true;const k=Math.floor((p[0]*0.7+p[1]*0.7)/6);b={id:900000+k,u:Math.min(ed,9-ed)+0.5,v:4.5,w:12,h:9}}}
      const edge=Math.min(b.u,b.w-b.u,b.v,b.h-b.v); // inches to nearest joint
      let R,G,B;
      // brick colour: two palette colours mottled with slate-like streak noise
      const c1=isBorder?[74,73,70]:pick(hash2(b.id,11)),c2=isBorder?[60,60,58]:pick(hash2(b.id,29)),tone=0.9+hash2(b.id,47)*0.2;
      const nz=noise(p[0]*0.9+b.id*3.1,p[1]*0.35)*0.6+noise(p[0]*3.2,p[1]*3.2)*0.4;const t=Math.max(0,Math.min(1,(nz-0.3)*1.6));
      const grain=(hash2((p[0]*8)|0,(p[1]*8)|0)-0.5)*14;
      R=(c1[0]*(1-t)+c2[0]*t)*tone+grain;G=(c1[1]*(1-t)+c2[1]*t)*tone+grain;B=(c1[2]*(1-t)+c2[2]*t)*tone+grain;
      // bevel: slightly darker near edges
      const bev=Math.min(1,edge/0.8);const shade=0.82+0.18*bev;R*=shade;G*=shade;B*=shade;
      if(b.turf){
        // tiles are light concrete; joints are turf
        const P=28,jx=p[0]-Math.floor(p[0]/P)*P,jy=p[1]-Math.floor(p[1]/P)*P;
        if(jx>24||jy>24){const k=((((y*7)%turfT.height)*turfT.width+((x*7)%turfT.width))*4);R=turfT.data[k];G=turfT.data[k+1];B=turfT.data[k+2]}
        else{const tid=hash2(Math.floor(p[0]/28),Math.floor(p[1]/28));const n=(noise(p[0]*0.25,p[1]*0.25)-0.5)*22+(noise(p[0]*2,p[1]*2)-0.5)*10+tid*10;R=196+n;G=193+n;B=186+n;const e=Math.min(jx,24-jx,jy,24-jy);const bv=Math.min(1,e/0.7);R*=0.86+0.14*bv;G*=0.86+0.14*bv;B*=0.86+0.14*bv}
      }else{
        // sand joint, faded out when the joint is thinner than a pixel (avoids flicker far away)
        const jw=jointW/2;const cover=Math.max(0,Math.min(1,(jw-edge)/fp+0.5));const jStrength=Math.min(1,jw*2/fp);
        const jm=cover*Math.min(1,0.25+jStrength);
        R=R*(1-jm)+120*jm;G=G*(1-jm)+112*jm;B=B*(1-jm)+100*jm;
      }
      const L=light(x,y);R*=L;G*=L;B*=L;
      const gr=(Math.random()-0.5)*10;
      d[i4]=Math.min(255,R*1.06+gr);d[i4+1]=Math.min(255,G*1.06+gr);d[i4+2]=Math.min(255,B*1.06+gr);d[i4+3]=m;
    }
  }
  lx.putImageData(img,0,0);ctx.save();ctx.filter='blur('+Math.max(0.4,W/2600)+'px)';ctx.drawImage(layer,0,0);ctx.restore();
  // thin shadow line along the outer edge so the pavers sit "in" the ground
  ctx.save();ctx.globalAlpha=0.35;ctx.strokeStyle='#2a2a22';ctx.lineWidth=Math.max(1.5,W/700);
  shapes.forEach(s=>{ctx.beginPath();s.forEach((p,i)=>i?ctx.lineTo(p[0]*W,p[1]*H):ctx.moveTo(p[0]*W,p[1]*H));ctx.closePath();ctx.stroke()});ctx.restore();
  return out;
}
function drawFence(out,lines,cam){
  const ctx=out.getContext('2d');const W=out.width,H=out.height;
  const toPix=(X,Z)=>{const y=cam.yh+cam.f*cam.hc/Z;return [cam.cx+X*(y-cam.yh)/cam.hc,y]};
  const pxPerFt=y=>(y-cam.yh)/cam.hc;
  // draw far segments first so near panels overlap correctly
  const panels=[];
  lines.forEach(line=>{for(let i=0;i<line.length-1;i++){
    const a=cam.toGround(line[i][0]*W,line[i][1]*H),b=cam.toGround(line[i+1][0]*W,line[i+1][1]*H);if(!a||!b)continue;
    const L=Math.hypot(b[0]-a[0],b[1]-a[1]);const n=Math.max(1,Math.round(L/6));
    for(let k=0;k<n;k++){const t0=k/n,t1=(k+1)/n;
      const g0=[a[0]+(b[0]-a[0])*t0,a[1]+(b[1]-a[1])*t0],g1=[a[0]+(b[0]-a[0])*t1,a[1]+(b[1]-a[1])*t1];
      panels.push({g0,g1,z:(g0[1]+g1[1])/2,first:k===0&&i===0,last:k===n-1})}}});
  panels.sort((p,q)=>q.z-p.z);
  for(const P of panels){
    const b0=toPix(...P.g0),b1=toPix(...P.g1);const h0=6*pxPerFt(b0[1]),h1=6*pxPerFt(b1[1]);
    // panel
    const gr=ctx.createLinearGradient(0,Math.min(b0[1]-h0,b1[1]-h1),0,Math.max(b0[1],b1[1]));gr.addColorStop(0,'#fbfbf8');gr.addColorStop(1,'#e4e4df');
    ctx.fillStyle=gr;ctx.beginPath();ctx.moveTo(b0[0],b0[1]);ctx.lineTo(b1[0],b1[1]);ctx.lineTo(b1[0],b1[1]-h1);ctx.lineTo(b0[0],b0[1]-h0);ctx.closePath();ctx.fill();
    // vertical tongue-and-groove lines
    ctx.strokeStyle='rgba(150,150,140,.35)';ctx.lineWidth=Math.max(0.6,pxPerFt(b0[1])/40);
    for(let s=1;s<12;s++){const t=s/12;const x=b0[0]+(b1[0]-b0[0])*t,y=b0[1]+(b1[1]-b0[1])*t,h=h0+(h1-h0)*t;ctx.beginPath();ctx.moveTo(x,y-h*0.04);ctx.lineTo(x,y-h*0.94);ctx.stroke()}
    // rails
    ctx.strokeStyle='rgba(120,120,110,.45)';ctx.lineWidth=Math.max(1,pxPerFt(b0[1])/18);
    for(const r of [0.04,0.95]){ctx.beginPath();ctx.moveTo(b0[0],b0[1]-h0*r);ctx.lineTo(b1[0],b1[1]-h1*r);ctx.stroke()}
    // posts at both ends
    for(const [bp,h] of [[b0,h0],[b1,h1]]){const pw=5/12*pxPerFt(bp[1]);const ph=h*1.06;
      ctx.fillStyle='#fdfdfb';ctx.fillRect(bp[0]-pw/2,bp[1]-ph,pw,ph);ctx.strokeStyle='rgba(110,110,100,.5)';ctx.lineWidth=Math.max(0.8,pw/10);ctx.strokeRect(bp[0]-pw/2,bp[1]-ph,pw,ph);
      ctx.fillStyle='#f2f2ee';ctx.fillRect(bp[0]-pw*0.65,bp[1]-ph-pw*0.35,pw*1.3,pw*0.35)}
    // contact shadow
    ctx.strokeStyle='rgba(40,40,30,.35)';ctx.lineWidth=Math.max(1,pxPerFt(b0[1])/10);ctx.beginPath();ctx.moveTo(b0[0],b0[1]);ctx.lineTo(b1[0],b1[1]);ctx.stroke();
  }
}
/* marks: {pavers:[shapes], turf:[shapes], fence:[lines]} normalized; opts: {palette, pattern, border, sqftPavers, sqftTurf, turfTex} */
function renderAll(photo,marks,opts){
  let cur=photo;const W=photo.width,H=photo.height;
  const pv=(marks.pavers||[]).filter(s=>s.length>=3),tg=(marks.turf||[]).filter(s=>s.length>=3),fn=(marks.fence||[]).filter(s=>s.length>=2);
  if(pv.length)cur=render(cur,pv,{palette:opts.palette},{pattern:opts.pattern,sqft:opts.sqftPavers,border:opts.border});
  if(tg.length)cur=render(cur,tg,{palette:opts.palette},{pattern:'turf',sqft:opts.sqftTurf,turfTex:opts.turfTex});
  if(fn.length){if(cur===photo){const c=document.createElement('canvas');c.width=W;c.height=H;c.getContext('2d').drawImage(photo,0,0);cur=c}
    const all=pv.concat(tg).concat(fn);const cam=fitCamera(W,H,all,opts.sqftPavers||0);drawFence(cur,fn,cam)}
  return cur;
}
global.PakaliRender={render,renderAll,fitCamera};
})(window);
