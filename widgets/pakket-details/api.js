'use strict';
const localizePackageStatus = require('../../lib/status-i18n');
function ids(v){if(Array.isArray(v))return v.map(String).filter(Boolean);if(typeof v!=='string')return[];return v.split(',').map(x=>x.trim()).filter(Boolean)}
function str(...v){for(const x of v){if(x===0)return'0';if(x!==undefined&&x!==null&&String(x).trim())return String(x).trim()}return''}
function device(homey,raw){const wanted=ids(raw),list=homey.drivers.getDriver('account').getDevices(),id=wanted[0]||String(raw||'').trim(),d=list.find(x=>x.getId()===id);if(!d)throw new Error('Select a PostNL device for this widget.');return d}
function rank(p){const raw=p?.deliveryWindowFrom||p?.deliveryDate||p?.createdAt||'';const t=Date.parse(raw);return Number.isFinite(t)?t:Number.MAX_SAFE_INTEGER}
module.exports={
 async getData({homey,query}){const d=device(homey,query?.deviceIds||query?.deviceId),data=d.getWidgetData(),active=(data.packages||[]).filter(p=>!p.delivered).sort((a,b)=>rank(a)-rank(b))[0]||null;return{authenticated:data.authenticated,locale:homey.i18n.getLanguage(),timeZone:homey.clock.getTimezone(),updatedAt:data.updatedAt||null,parcel:active?{id:str(active.id),sender:str(active.sender,active.title,active.sourceDisplayName,'PostNL'),tracking:str(active.barcode,active.id),status:localizePackageStatus(homey,active.status||''),deliveryDate:str(active.deliveryDate,active.deliveryWindowFrom),deliveryWindow:str(active.deliveryWindow),deliveryWindowFrom:str(active.deliveryWindowFrom),deliveryWindowTo:str(active.deliveryWindowTo),detailsUrl:str(active.detailsUrl),createdAt:str(active.createdAt),shipmentType:str(active.shipmentType),direction:str(active.direction)}:null}},
 async sync({homey,body}){const d=device(homey,body?.deviceIds||body?.deviceId);await d.sync({reason:'widget',force:true});return{ok:true}}
};
