'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const FONT = {
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01111','10000','10000','10000','10000','10000','01111'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01111','10000','10000','10111','10001','10001','01111'],
  'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['11111','00100','00100','00100','00100','00100','11111'],
  'J': ['00111','00010','00010','00010','10010','10010','01100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','11001','10101','10011','10001','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','11011','10001'],
  'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','01010','00100','00100','00100','00100'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  ':': ['00000','00100','00100','00000','00100','00100','00000'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '.': ['00000','00000','00000','00000','00000','00110','00110'],
  '/': ['00001','00010','00010','00100','01000','01000','10000'],
  '•': ['00000','00000','01110','01110','01110','00000','00000'],
  '_': ['00000','00000','00000','00000','00000','00000','11111'],
};

// ---------------------------------------------------------------------------
// Memory notes (v1.2.9)
// The card is 800x800 RGBA. Earlier builds allocated the canvas, a second raw
// copy for PNG filtering, a concatenated IDAT copy for the CRC, decoded the van
// PNG on every render and kept three font atlases as full RGBA (~5 MB) forever.
// The canvas now carries the PNG filter byte per row so it is deflated in place,
// CRCs are streamed, the van is decoded once and font atlases keep only their
// alpha channel (1/4 of the size).
// ---------------------------------------------------------------------------
function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crcTable();
function crcUpdate(c, buf) {
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c;
}
function chunk(type, data = Buffer.alloc(0)) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE((crcUpdate(crcUpdate(0xffffffff, t), data) ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodeCanvas(c) {
  // c.rgba already contains a filter byte (0 = none) at the start of every row.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.width, 0); ihdr.writeUInt32BE(c.height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(c.rgba, { level: 6, memLevel: 7 })), chunk('IEND'),
  ]);
}
function decodePng(buffer) {
  const sig = buffer.subarray(0, 8);
  if (!sig.equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG');
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0; const idat = [];
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos); const type = buffer.toString('ascii', pos + 4, pos + 8); const data = buffer.subarray(pos + 8, pos + 8 + len); pos += 12 + len;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error('Only RGBA PNG supported');
  const data = zlib.inflateSync(idat.length === 1 ? idat[0] : Buffer.concat(idat)); const bpp = 4; const stride = width * bpp; const out = Buffer.alloc(width * height * 4); let inPos = 0;
  const paeth = (a,b,c) => { const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c; };
  for (let y=0; y<height; y++) {
    const filter = data[inPos++];
    for (let x=0; x<stride; x++) {
      const raw = data[inPos++]; const a = x>=bpp ? out[y*stride+x-bpp] : 0; const b = y>0 ? out[(y-1)*stride+x] : 0; const c = (y>0&&x>=bpp) ? out[(y-1)*stride+x-bpp] : 0;
      let val = raw;
      if (filter===1) val=(raw+a)&255; else if(filter===2) val=(raw+b)&255; else if(filter===3) val=(raw+Math.floor((a+b)/2))&255; else if(filter===4) val=(raw+paeth(a,b,c))&255;
      out[y*stride+x]=val;
    }
  }
  return { width, height, rgba: out };
}
function canvas(width, height, bg=[245,245,246,255]) {
  const stride = width * 4 + 1;
  const rgba = Buffer.allocUnsafe(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride; rgba[row] = 0;
    for (let x = 0; x < width; x++) { const i = row + 1 + x * 4; rgba[i]=bg[0]; rgba[i+1]=bg[1]; rgba[i+2]=bg[2]; rgba[i+3]=bg[3]; }
  }
  return { width, height, stride, rgba };
}
function blend(c,x,y,r,g,b,alpha){ if(x<0||y<0||x>=c.width||y>=c.height)return; const i=y*c.stride+1+x*4; const a=alpha/255, ia=1-a; c.rgba[i]=Math.round(r*a+c.rgba[i]*ia);c.rgba[i+1]=Math.round(g*a+c.rgba[i+1]*ia);c.rgba[i+2]=Math.round(b*a+c.rgba[i+2]*ia);c.rgba[i+3]=255; }
function pixel(c,x,y,col){ blend(c,x,y,col[0],col[1],col[2],col[3]??255); }
function rect(c,x,y,w,h,col){ const a=col[3]??255; for(let yy=Math.max(0,y);yy<Math.min(c.height,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(c.width,x+w);xx++)blend(c,xx,yy,col[0],col[1],col[2],a); }
function roundedRect(c,x,y,w,h,r,fill,border){ rect(c,x+r,y,w-2*r,h,fill); rect(c,x,y+r,w,h-2*r,fill); for(let yy=0;yy<r;yy++)for(let xx=0;xx<r;xx++){if((xx-r+0.5)**2+(yy-r+0.5)**2<=r*r){pixel(c,x+xx,y+yy,fill);pixel(c,x+w-1-xx,y+yy,fill);pixel(c,x+xx,y+h-1-yy,fill);pixel(c,x+w-1-xx,y+h-1-yy,fill);}} if(border){line(c,x+r,y,x+w-r,y,border,1);line(c,x+r,y+h-1,x+w-r,y+h-1,border,1);line(c,x,y+r,x,y+h-r,border,1);line(c,x+w-1,y+r,x+w-1,y+h-r,border,1);} }
function line(c,x1,y1,x2,y2,col,width=1){ const dx=Math.abs(x2-x1), sx=x1<x2?1:-1, dy=-Math.abs(y2-y1), sy=y1<y2?1:-1; let err=dx+dy; while(true){rect(c,Math.round(x1-width/2),Math.round(y1-width/2),width,width,col); if(x1===x2&&y1===y2)break; const e2=2*err;if(e2>=dy){err+=dy;x1+=sx;}if(e2<=dx){err+=dx;y1+=sy;}} }
function circle(c,cx,cy,r,fill,stroke,sw=1){ for(let y=-r-sw;y<=r+sw;y++)for(let x=-r-sw;x<=r+sw;x++){const d=Math.sqrt(x*x+y*y);if(fill&&d<=r-sw/2)pixel(c,cx+x,cy+y,fill);if(stroke&&d>=r-sw/2&&d<=r+sw/2)pixel(c,cx+x,cy+y,stroke);} }
function drawPixelText(c,x,y,str,scale,col,maxWidth=Infinity){ str=String(str||'').toUpperCase(); const advance=6*scale; const maxChars=Math.max(1,Math.floor(maxWidth/advance)); if(str.length>maxChars) str=str.slice(0,Math.max(1,maxChars-3))+ '...'; let xx=x; for(const ch0 of str){ const ch=FONT[ch0]?ch0:(FONT[ch0.toUpperCase()]?ch0.toUpperCase():' '); const glyph=FONT[ch]||FONT[' ']; for(let gy=0;gy<7;gy++)for(let gx=0;gx<5;gx++)if(glyph[gy][gx]==='1')rect(c,xx+gx*scale,y+gy*scale,scale,scale,col); xx+=advance; } return xx-x; }

let FONT_ATLAS = null;
function loadFontAtlas(){
  if (FONT_ATLAS) return FONT_ATLAS;
  try {
    const assets = path.join(__dirname, '..', 'assets');
    const meta = JSON.parse(fs.readFileSync(path.join(assets, 'font-atlas.json'), 'utf8'));
    const atlases = {};
    for (const [key, info] of Object.entries(meta.atlases || {})) {
      const source = fs.readFileSync(path.join(assets, info.file));
      const bytes = info.encoding === 'base64-png' ? Buffer.from(source.toString('utf8').trim(), 'base64') : source;
      const decoded = decodePng(bytes);
      // Glyphs are drawn with the caller's colour; only the alpha channel is needed.
      const alpha = Buffer.allocUnsafe(decoded.width * decoded.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = decoded.rgba[i * 4 + 3];
      atlases[key] = { ...info, image: { width: decoded.width, height: decoded.height, alpha } };
    }
    FONT_ATLAS = { chars: meta.chars || '', atlases };
  } catch (_) {
    FONT_ATLAS = { chars: '', atlases: {} };
  }
  return FONT_ATLAS;
}
function textWidth(str, face){
  const atlas = loadFontAtlas(); const info = atlas.atlases[face];
  if (!info) return String(str||'').length * 16;
  let width = 0; const fallback = Math.max(0, atlas.chars.indexOf('?'));
  for (const ch of String(str||'')) { const idx = atlas.chars.indexOf(ch); width += Number(info.advance[idx >= 0 ? idx : fallback] || info.size * 0.6); }
  return width;
}
function blitGlyph(c, info, index, dx, dy, col){
  const img=info.image, cw=info.cellWidth, ch=info.cellHeight, cols=info.cols; const sx=(index%cols)*cw, sy=Math.floor(index/cols)*ch;
  const ca=(col[3]??255)/255;
  for(let y=0;y<ch;y++) for(let x=0;x<cw;x++){
    const alpha=img.alpha[(sy+y)*img.width+(sx+x)]; if(!alpha) continue;
    blend(c,dx+x,dy+y,col[0],col[1],col[2],Math.round(alpha*ca));
  }
}
function drawAtlasText(c,x,y,str,face,col,maxWidth=Infinity,align='left'){
  const atlas=loadFontAtlas(), info=atlas.atlases[face]; if(!info) return drawPixelText(c,x,y,str,2,col,maxWidth);
  let value=String(str||''); const fallback=Math.max(0,atlas.chars.indexOf('?'));
  if(textWidth(value,face)>maxWidth){
    const ellipsis='...'; const ellW=textWidth(ellipsis,face); let out='';
    for(const ch of value){ if(textWidth(out+ch,face)+ellW>maxWidth) break; out+=ch; }
    value=out+ellipsis;
  }
  const total=textWidth(value,face); let xx=align==='center'?x-total/2:align==='right'?x-total:x;
  for(const ch of value){ const idx=atlas.chars.indexOf(ch); const use=idx>=0?idx:fallback; blitGlyph(c,info,use,Math.round(xx),Math.round(y),col); xx += Number(info.advance[use] || info.size*0.6); }
  return total;
}
function wrapAtlasText(str,face,maxWidth){
  const words=String(str||'').trim().split(/\s+/).filter(Boolean); if(!words.length)return []; const lines=[]; let line='';
  for(const word of words){ const candidate=line?`${line} ${word}`:word; if(!line||textWidth(candidate,face)<=maxWidth){line=candidate;continue;} lines.push(line); line=word; }
  if(line)lines.push(line); return lines;
}
function drawAtlasWrappedText(c,x,y,str,face,col,maxWidth,lineHeight=26,align='left'){
  const lines=wrapAtlasText(str,face,maxWidth); for(let i=0;i<lines.length;i++) drawAtlasText(c,x,y+i*lineHeight,lines[i],face,col,maxWidth,align); return lines.length;
}
function blitScaled(c,img,dx,dy,dw,dh){ for(let y=0;y<dh;y++){const sy=Math.min(img.height-1,Math.floor(y*img.height/dh));for(let x=0;x<dw;x++){const sx=Math.min(img.width-1,Math.floor(x*img.width/dw));const si=(sy*img.width+sx)*4;blend(c,dx+x,dy+y,img.rgba[si],img.rgba[si+1],img.rgba[si+2],img.rgba[si+3]);}} }
function hhmm(total){ total=((Math.round(total)%1440)+1440)%1440; return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`; }

let DELIVERY_VAN = null;
function loadDeliveryVan(){
  if (DELIVERY_VAN) return DELIVERY_VAN;
  const file = path.join(__dirname, '..', 'assets', 'postnl-van-static.b64');
  DELIVERY_VAN = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  return DELIVERY_VAN;
}
// The van is decoded once (213x114 RGBA, ~97 KB) instead of on every render.
let DELIVERY_VAN_DECODED = null;
function decodedVan(vanPng){
  if (!vanPng || vanPng === DELIVERY_VAN) {
    if (!DELIVERY_VAN_DECODED) DELIVERY_VAN_DECODED = decodePng(loadDeliveryVan());
    return DELIVERY_VAN_DECODED;
  }
  return decodePng(vanPng);
}
function renderNoPackageCard(opts={}){
  const c=canvas(800,800,[245,245,246,255]); const white=[255,255,255,255], border=[222,222,224,255], primary=[35,35,35,255], orange=[251,98,0,255], timeline=[119,123,156,255];
  roundedRect(c,20,20,760,760,24,white,border);
  const vanPng=opts.vanPng||loadDeliveryVan();
  if(vanPng){try{const van=decodedVan(vanPng); const dw=300, dh=Math.round(van.height*dw/van.width); blitScaled(c,van,Math.round((800-dw)/2),225,dw,dh);}catch(_){}}
  const label=opts.language==='nl'?'Er is geen pakket onderweg':'There is currently no parcel on the way';
  drawAtlasText(c,400,430,label,'bold36',primary,650,'center');
  const y=575,x1=70,x2=730; line(c,x1,y,x2,y,timeline,4); circle(c,x1,y,11,white,orange,5);
  return encodeCanvas(c);
}

function renderDeliveryCard(opts={}){
  const c=canvas(800,800,[245,245,246,255]); const white=[255,255,255,255], border=[222,222,224,255], primary=[35,35,35,255], secondary=[116,115,120,255], muted=[151,150,155,255], orange=[251,98,0,255], timeline=[119,123,156,255], tick=[207,207,213,255];
  roundedRect(c,20,20,760,760,24,white,border);
  // small parcel icon
  rect(c,58,56,28,22,[254,231,132,255]); rect(c,77,58,6,7,[255,141,0,255]); line(c,64,66,75,66,[34,32,46,255],2);
  drawAtlasText(c,102,47,opts.sender||'PostNL','bold30',primary,365); drawAtlasWrappedText(c,738,42,opts.status||'','regular22',secondary,265,25,'right');
  drawAtlasText(c,58,122,opts.headline||'','bold36',primary,684); if(opts.tracking) drawAtlasText(c,58,174,`Tracking: ${opts.tracking}`,'regular22',muted,684);
  if(opts.vanPng){try{const van=decodedVan(opts.vanPng); const dw=285, dh=Math.round(van.height*dw/van.width); blitScaled(c,van,258,292,dw,dh);}catch(_){} }
  const x1=70,x2=730,y=610; line(c,x1,y,x2,y,timeline,4); const pct=Math.max(0,Math.min(1,Number(opts.progress||0))); const dotX=Math.round(x1+(x2-x1)*pct); line(c,x1,y,dotX,y,orange,4);
  const startPct=Math.max(0,Math.min(1,Number(opts.windowStartPct??0.25))), endPct=Math.max(0,Math.min(1,Number(opts.windowEndPct??0.75))); const sx=Math.round(x1+(x2-x1)*startPct), ex=Math.round(x1+(x2-x1)*endPct); line(c,sx,y-14,sx,y+14,tick,4); line(c,ex,y-14,ex,y+14,tick,4); circle(c,dotX,y,11,white,orange,5);
  drawAtlasText(c,x1,646,opts.timelineStart||'','regular22',muted,150); const mid=opts.timelineMid||''; drawAtlasText(c,400,646,mid,'regular22',muted,150,'center'); const end=opts.timelineEnd||''; drawAtlasText(c,x2,646,end,'regular22',muted,150,'right');
  return encodeCanvas(c);
}
module.exports={renderDeliveryCard,renderNoPackageCard,loadDeliveryVan,hhmm};
