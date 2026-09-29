'use strict';

const zlib = require('zlib');

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
  '_': ['00000','00000','00000','00000','00000','00000','11111'],
};

function crcTable(){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;}
const CRC=crcTable();
function crc32(buf){let c=0xffffffff;for(const b of buf)c=CRC[(c^b)&0xff]^(c>>>8);return(c^0xffffffff)>>>0;}
function chunk(type,data=Buffer.alloc(0)){const t=Buffer.from(type),l=Buffer.alloc(4),r=Buffer.alloc(4);l.writeUInt32BE(data.length);r.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([l,t,data,r]);}
function encodePng(w,h,rgba){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){const row=y*(w*4+1);raw[row]=0;rgba.copy(raw,row+1,y*w*4,(y+1)*w*4);}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND')]);}
function canvas(w,h,bg=[245,245,246,255]){const rgba=Buffer.alloc(w*h*4);for(let i=0;i<w*h;i++){rgba[i*4]=bg[0];rgba[i*4+1]=bg[1];rgba[i*4+2]=bg[2];rgba[i*4+3]=bg[3];}return{width:w,height:h,rgba};}
function pixel(c,x,y,col){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=c.width||y>=c.height)return;const i=(y*c.width+x)*4,a=(col[3]??255)/255,ia=1-a;c.rgba[i]=Math.round(col[0]*a+c.rgba[i]*ia);c.rgba[i+1]=Math.round(col[1]*a+c.rgba[i+1]*ia);c.rgba[i+2]=Math.round(col[2]*a+c.rgba[i+2]*ia);c.rgba[i+3]=255;}
function rect(c,x,y,w,h,col){for(let yy=Math.max(0,Math.round(y));yy<Math.min(c.height,Math.round(y+h));yy++)for(let xx=Math.max(0,Math.round(x));xx<Math.min(c.width,Math.round(x+w));xx++)pixel(c,xx,yy,col);}
function line(c,x1,y1,x2,y2,col,width=1){const dx=Math.abs(x2-x1),sx=x1<x2?1:-1,dy=-Math.abs(y2-y1),sy=y1<y2?1:-1;let err=dx+dy;while(true){rect(c,x1-width/2,y1-width/2,width,width,col);if(x1===x2&&y1===y2)break;const e2=2*err;if(e2>=dy){err+=dy;x1+=sx;}if(e2<=dx){err+=dx;y1+=sy;}}}
function roundedRect(c,x,y,w,h,r,fill,border){rect(c,x+r,y,w-2*r,h,fill);rect(c,x,y+r,w,h-2*r,fill);for(let yy=0;yy<r;yy++)for(let xx=0;xx<r;xx++)if((xx-r+.5)**2+(yy-r+.5)**2<=r*r){pixel(c,x+xx,y+yy,fill);pixel(c,x+w-1-xx,y+yy,fill);pixel(c,x+xx,y+h-1-yy,fill);pixel(c,x+w-1-xx,y+h-1-yy,fill);}if(border){line(c,x+r,y,x+w-r,y,border);line(c,x+r,y+h-1,x+w-r,y+h-1,border);line(c,x,y+r,x,y+h-r,border);line(c,x+w-1,y+r,x+w-1,y+h-r,border);}}
function circle(c,cx,cy,r,fill,stroke,sw=1){for(let y=-r-sw;y<=r+sw;y++)for(let x=-r-sw;x<=r+sw;x++){const d=Math.sqrt(x*x+y*y);if(fill&&d<=r-sw/2)pixel(c,cx+x,cy+y,fill);if(stroke&&d>=r-sw/2&&d<=r+sw/2)pixel(c,cx+x,cy+y,stroke);}}
function drawText(c,x,y,str,scale,col,maxWidth=Infinity){str=String(str||'').toUpperCase();const adv=6*scale,max=Math.max(1,Math.floor(maxWidth/adv));if(str.length>max)str=str.slice(0,Math.max(1,max-1));let xx=x;for(const ch0 of str){const ch=FONT[ch0]?ch0:(FONT[ch0.toUpperCase()]?ch0.toUpperCase():' '),g=FONT[ch]||FONT[' '];for(let gy=0;gy<7;gy++)for(let gx=0;gx<5;gx++)if(g[gy][gx]==='1')rect(c,xx+gx*scale,y+gy*scale,scale,scale,col);xx+=adv;}return xx-x;}
function drawVan(c,x,y,s=1){const orange=[251,98,0,255],blue=[32,49,82,255],light=[231,242,249,255],white=[255,255,255,255],dark=[37,46,59,255];roundedRect(c,x,y+24*s,116*s,58*s,8*s,light,null);rect(c,x,y+62*s,116*s,20*s,blue);roundedRect(c,x+105*s,y+35*s,62*s,47*s,8*s,orange,null);rect(c,x+114*s,y+43*s,25*s,22*s,white);rect(c,x+141*s,y+49*s,18*s,16*s,light);circle(c,x+34*s,y+86*s,15*s,dark,null);circle(c,x+34*s,y+86*s,6*s,[178,190,202,255],null);circle(c,x+137*s,y+86*s,15*s,dark,null);circle(c,x+137*s,y+86*s,6*s,[178,190,202,255],null);drawText(c,x+25*s,y+43*s,'POSTNL',Math.max(1,Math.round(2*s)),orange,75*s);}
function hhmm(total){total=((Math.round(total)%1440)+1440)%1440;return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');}
function renderDeliveryCard(opts={}){
 const c=canvas(800,800),white=[255,255,255,255],border=[222,222,224,255],primary=[35,35,35,255],secondary=[116,115,120,255],muted=[151,150,155,255],orange=[251,98,0,255],timeline=[119,123,156,255],tick=[207,207,213,255];
 roundedRect(c,20,20,760,760,24,white,border);
 rect(c,58,56,28,22,[254,231,132,255]);rect(c,77,58,6,7,[255,141,0,255]);line(c,64,66,75,66,[34,32,46,255],2);
 drawText(c,102,58,opts.sender||'PostNL',3,primary,470);drawText(c,590,60,opts.status||'',2,secondary,150);
 drawText(c,58,135,opts.headline||'',3,primary,680);if(opts.tracking)drawText(c,58,180,'TRACKING: '+opts.tracking,2,muted,680);
 drawVan(c,275,295,1.45);
 const x1=70,x2=730,y=610,pct=Math.max(0,Math.min(1,Number(opts.progress||0))),dotX=Math.round(x1+(x2-x1)*pct);line(c,x1,y,x2,y,timeline,4);line(c,x1,y,dotX,y,orange,4);
 const sp=Math.max(0,Math.min(1,Number(opts.windowStartPct??.25))),ep=Math.max(0,Math.min(1,Number(opts.windowEndPct??.75))),sx=Math.round(x1+(x2-x1)*sp),ex=Math.round(x1+(x2-x1)*ep);line(c,sx,y-14,sx,y+14,tick,4);line(c,ex,y-14,ex,y+14,tick,4);circle(c,dotX,y,11,white,orange,5);
 drawText(c,x1,655,opts.timelineStart||'',2,muted,150);const mid=opts.timelineMid||'';drawText(c,400-mid.length*6,655,mid,2,muted,150);const end=opts.timelineEnd||'';drawText(c,x2-end.length*12,655,end,2,muted,150);
 return encodePng(c.width,c.height,c.rgba);
}
function renderNoPackageCard(language='en'){
 const c=canvas(800,800),white=[255,255,255,255],border=[222,222,224,255],primary=[35,35,35,255],lineCol=[119,123,156,255],orange=[251,98,0,255];
 roundedRect(c,20,20,760,760,24,white,border);drawVan(c,275,225,1.45);
 const text=language==='nl'?'ER IS GEEN PAKKET ONDERWEG':'THERE IS NO PARCEL ON THE WAY';const w=text.length*18;drawText(c,Math.max(55,(800-w)/2),430,text,3,primary,690);
 line(c,70,600,730,600,lineCol,4);circle(c,70,600,11,white,orange,5);return encodePng(c.width,c.height,c.rgba);
}
module.exports={renderDeliveryCard,renderNoPackageCard,hhmm};
