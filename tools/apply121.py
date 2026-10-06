from pathlib import Path
import json, shutil

# Versions
for rel in ['package.json','package-lock.json','.homeycompose/app.json','app.json']:
    p=Path(rel); d=json.loads(p.read_text()); d['version']='1.2.1'
    if rel=='package-lock.json' and d.get('packages',{}).get('') is not None: d['packages']['']['version']='1.2.1'
    p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')

# PostNL tracking detail: retain full journey and extract physical parcel details where exposed.
p=Path('lib/postnl-api.js'); s=p.read_text()
needle="  _trackingEventDescription(event = {}) {\n    return String(event.description || event.message || event.status || event.eventDescription || '').trim();\n  }\n\n"
if '_formatPackageWeight(detail, colli)' not in s:
    block=r'''  _trackingEventDescription(event = {}) {
    return String(event.description || event.message || event.status || event.eventDescription || '').trim();
  }

  _findDeepValue(root, candidateKeys = []) {
    const wanted = new Set(candidateKeys.map(key => String(key).toLowerCase().replace(/[^a-z0-9]/g, '')));
    const queue = [root]; const seen = new Set();
    while (queue.length) {
      const value = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (wanted.has(normalized) && child !== undefined && child !== null && String(child).trim() !== '') return child;
        if (child && typeof child === 'object') queue.push(child);
      }
    }
    return null;
  }

  _formatPackageWeight(detail, colli) {
    for (const root of [colli, detail]) {
      if (!root) continue;
      const direct = this._findDeepValue(root, ['weightText','weightDescription','displayWeight','parcelWeightText']);
      if (direct != null && typeof direct !== 'object') return String(direct).trim();
      const grams = this._findDeepValue(root, ['weightInGrams','weightGrams','grams','weightGram']);
      if (grams != null && !Number.isNaN(Number(grams))) return `${Number(grams)} gram`;
      const kilos = this._findDeepValue(root, ['weightInKg','weightKg','kilograms']);
      if (kilos != null && !Number.isNaN(Number(kilos))) return `${Number(kilos)} kg`;
      const weight = this._findDeepValue(root, ['weight','parcelWeight','grossWeight']);
      if (weight != null && typeof weight !== 'object') {
        const unit = this._findDeepValue(root, ['weightUnit','unitOfWeight','weightUom']);
        return `${String(weight).trim()}${unit ? ` ${String(unit).trim()}` : ''}`.trim();
      }
    }
    return '';
  }

  _formatPackageDimensions(detail, colli) {
    for (const root of [colli, detail]) {
      if (!root) continue;
      const direct = this._findDeepValue(root, ['dimensionsText','dimensionText','dimensionsDescription','sizeDescription','displayDimensions']);
      if (direct != null && typeof direct !== 'object') return String(direct).trim();
      const dimensions = this._findDeepValue(root, ['dimensions','dimension','parcelDimensions','size']);
      if (dimensions && typeof dimensions === 'object' && !Array.isArray(dimensions)) {
        const length = dimensions.length ?? dimensions.depth ?? dimensions.l;
        const width = dimensions.width ?? dimensions.w;
        const height = dimensions.height ?? dimensions.h;
        const unit = dimensions.unit ?? dimensions.uom ?? dimensions.dimensionUnit ?? 'cm';
        if ([length,width,height].every(v => v !== undefined && v !== null && String(v).trim() !== '')) return `${length} x ${width} x ${height} ${unit}`;
      }
      const length = this._findDeepValue(root, ['length','parcelLength','dimensionLength']);
      const width = this._findDeepValue(root, ['width','parcelWidth','dimensionWidth']);
      const height = this._findDeepValue(root, ['height','parcelHeight','dimensionHeight']);
      if ([length,width,height].every(v => v !== null && v !== undefined && typeof v !== 'object')) {
        const unit = this._findDeepValue(root, ['dimensionUnit','dimensionsUnit','sizeUnit','lengthUnit']) || 'cm';
        return `${length} x ${width} x ${height} ${unit}`;
      }
    }
    return '';
  }

'''
    s=s.replace(needle,block,1)
    s=s.replace("    const deliveredByStatus = /\\b(bezorgd|afgehaald)\\b/i.test(officialStatus);\n\n    return {", "    const deliveredByStatus = /\\b(bezorgd|afgehaald)\\b/i.test(officialStatus);\n    const packageWeight = this._formatPackageWeight(detail, colli);\n    const packageDimensions = this._formatPackageDimensions(detail, colli);\n\n    return {",1)
    s=s.replace("      statusFingerprint: fingerprint,\n      delivered: Boolean(parcel.delivered || deliveredByStatus),", "      statusFingerprint: fingerprint,\n      packageWeight: packageWeight || parcel.packageWeight || '',\n      packageDimensions: packageDimensions || parcel.packageDimensions || '',\n      delivered: Boolean(parcel.delivered || deliveredByStatus),",1)
    s=s.replace("      statusFingerprint: [fallbackStatus, item.deliveredTimeStamp || item.creationDateTime || ''].join('|'),\n      deliveredTimeStamp:", "      statusFingerprint: [fallbackStatus, item.deliveredTimeStamp || item.creationDateTime || ''].join('|'),\n      packageWeight: '',\n      packageDimensions: '',\n      deliveredTimeStamp:",1)
p.write_text(s)

# Device values/tokens/capabilities.
p=Path('drivers/account/device.js'); s=p.read_text()
s=s.replace("'postnl_package_delivered', 'postnl_package_shipment_type']", "'postnl_package_delivered', 'postnl_package_shipment_type', 'postnl_package_weight', 'postnl_package_dimensions']",1)
if 'package_weight: String(parcel.packageWeight' not in s:
    s=s.replace("      package_sender: sender, package_tracking: tracking, package_image_available: Boolean(packageImage),", "      package_sender: sender, package_tracking: tracking, package_weight: String(parcel.packageWeight || ''),\n      package_dimensions: String(parcel.packageDimensions || ''), package_image_available: Boolean(packageImage),",1)
if "package_weight: activePackage.packageWeight" not in s:
    s=s.replace("      package_source_account_id: activePackage.sourceAccountId || '', package_tracking: activePackage.barcode || activePackage.id || '',\n      next_delivery:", "      package_source_account_id: activePackage.sourceAccountId || '', package_tracking: activePackage.barcode || activePackage.id || '',\n      package_weight: activePackage.packageWeight || '', package_dimensions: activePackage.packageDimensions || '',\n      next_delivery:",1)
if 'postnl_package_weight:' not in s:
    s=s.replace("      postnl_package_shipment_type: nextPackage?.shipmentType || '—',\n      postnl_status:", "      postnl_package_shipment_type: nextPackage?.shipmentType || '—',\n      postnl_package_weight: nextPackage?.packageWeight || '—',\n      postnl_package_dimensions: nextPackage?.packageDimensions || '—',\n      postnl_status:",1)
p.write_text(s)

# Global Flow tokens; cards stay device-specific.
p=Path('drivers/account/driver.js'); s=p.read_text()
if "package_weight: { type: 'string'" not in s:
    s=s.replace("      package_tracking: { type: 'string', en: 'Parcel tracking number', nl: 'Trackingnummer pakket' },", "      package_tracking: { type: 'string', en: 'Parcel tracking number', nl: 'Trackingnummer pakket' },\n      package_weight: { type: 'string', en: 'Parcel weight', nl: 'Gewicht pakket' },\n      package_dimensions: { type: 'string', en: 'Parcel dimensions', nl: 'Afmetingen pakket' },",1)
if 'package_weight: tokens.package_weight' not in s:
    s=s.replace("      package_tracking: tokens.package_tracking || tokens.barcode || tokens.id, old_status: tokens.old_status,", "      package_tracking: tokens.package_tracking || tokens.barcode || tokens.id, package_weight: tokens.package_weight,\n      package_dimensions: tokens.package_dimensions, old_status: tokens.old_status,",1)
p.write_text(s)

# Flow trigger tokens.
p=Path('drivers/account/driver.flow.compose.json'); d=json.loads(p.read_text())
for trig in d['triggers']:
    if trig['id'] in {'new_package','delivery_window_known','package_status_changed'}:
        names={t['name'] for t in trig.get('tokens',[])}
        if 'package_weight' not in names: trig['tokens'].append({'name':'package_weight','type':'string','title':{'en':'Package weight','nl':'Gewicht pakket'}})
        if 'package_dimensions' not in names: trig['tokens'].append({'name':'package_dimensions','type':'string','title':{'en':'Package dimensions','nl':'Afmetingen pakket'}})
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')

# Capabilities.
capdir=Path('.homeycompose/capabilities')
newcaps={
'postnl_package_weight': {'type':'string','title':{'en':'Parcel weight','nl':'Gewicht pakket'},'getable':True,'setable':False,'insights':False,'icon':'/assets/package.svg'},
'postnl_package_dimensions': {'type':'string','title':{'en':'Parcel dimensions','nl':'Afmetingen pakket'},'getable':True,'setable':False,'insights':False,'icon':'/assets/package.svg'}}
for name,obj in newcaps.items(): (capdir/f'{name}.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
p=Path('drivers/account/driver.compose.json'); dd=json.loads(p.read_text())
for cap in ['postnl_package_weight','postnl_package_dimensions']:
    if cap not in dd['capabilities']:
        idx=dd['capabilities'].index('postnl_package_shipment_type')+1 if 'postnl_package_shipment_type' in dd['capabilities'] else len(dd['capabilities']); dd['capabilities'].insert(idx,cap)
p.write_text(json.dumps(dd,ensure_ascii=False,indent=2)+'\n')

# Journey widget.
w=Path('widgets/pakket-reis'); (w/'public').mkdir(parents=True,exist_ok=True)
(w/'widget.compose.json').write_text(json.dumps({'name':{'en':'Parcel Journey','nl':'Reis van je pakket'},'height':420,'api':{'getData':{'method':'GET','path':'/'},'sync':{'method':'POST','path':'/sync'}},'devices':{'type':'app','singular':True,'filter':{'capabilities':'postnl_package_count'}}},ensure_ascii=False,indent=2)+'\n')
(w/'api.js').write_text("""'use strict';
function str(...values){for(const value of values){if(value===0)return'0';if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim();}return'';}
function rank(item){return Date.parse(item?.deliveryWindowFrom||item?.deliveryDate||item?.statusChangedAt||item?.createdAt||0)||0;}
function device(homey,id){const ids=Array.isArray(id)?id:[id];const all=homey.drivers.getDriver('account').getDevices();return all.find(d=>ids.includes(d.getId()))||all[0]||null;}
module.exports={async getData({homey,query}){const d=device(homey,query?.deviceIds||query?.deviceId);if(!d)throw new Error('PostNL device not found.');const data=d.getWidgetData();const active=(data.packages||[]).filter(p=>!p.delivered).sort((a,b)=>rank(a)-rank(b))[0]||null;return{authenticated:data.authenticated,locale:homey.i18n.getLanguage(),timeZone:homey.clock.getTimezone(),updatedAt:data.updatedAt||null,parcel:active?{id:str(active.id),sender:str(active.sender,active.title,active.sourceDisplayName,'PostNL'),tracking:str(active.barcode,active.id),status:str(active.statusRaw,active.latestStatusEvent,active.status),deliveryWindow:str(active.deliveryWindow),deliveryWindowFrom:str(active.deliveryWindowFrom),deliveryWindowTo:str(active.deliveryWindowTo),weight:str(active.packageWeight),dimensions:str(active.packageDimensions),events:Array.isArray(active.statusEvents)?active.statusEvents.map(e=>({description:str(e.description),timestamp:str(e.timestamp),location:str(e.location)})):[]}:null};},async sync({homey,body}){const d=device(homey,body?.deviceId||body?.deviceIds);if(!d)throw new Error('PostNL device not found.');await d.sync({reason:'widget-journey',force:true});return{ok:true};}};
""")
shutil.copy2('assets/icon.svg',w/'public/icon.svg'); shutil.copy2('assets/package.svg',w/'public/package.svg')
shutil.copy2('widgets/mijn-pakket/preview-light.png',w/'preview-light.png'); shutil.copy2('widgets/mijn-pakket/preview-dark.png',w/'preview-dark.png')
(w/'public/index.html').write_text(r'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark;--orange:#e95a22;--bg:#f4f4f5;--panel:#fff;--primary:#191928;--secondary:#6f7079;--line:#e1e1e5}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;font:14px/1.3 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--primary)}.card{height:100%;border-radius:17px;overflow:hidden;background:var(--bg);display:grid;grid-template-rows:52px 1fr}header{display:flex;align-items:center;padding:0 16px;border-bottom:1px solid var(--line);background:var(--panel)}header img{width:34px;height:34px;object-fit:contain}h1{margin:0 0 0 auto;font-size:17px;color:var(--secondary)}#c{overflow:auto;padding:15px;background:var(--panel)}.hero{padding:0 0 12px 46px;border-bottom:1px solid var(--line)}.sender{font-size:17px;font-weight:800}.status{margin-top:3px;font-size:20px;font-weight:800;line-height:1.18}.track{margin-top:5px;color:var(--secondary);font-size:11px}.facts{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.fact{padding:4px 8px;border-radius:10px;background:#fff0e8;color:#8d3a13;font-size:11px;font-weight:700}.journey{position:relative;padding:12px 0 0 46px}.journey:before{content:"";position:absolute;left:19px;top:18px;bottom:15px;width:3px;background:var(--orange)}.event{position:relative;padding:0 0 18px}.dot{position:absolute;left:-39px;top:2px;width:23px;height:23px;border-radius:50%;background:var(--orange);display:grid;place-items:center;color:white;font-weight:900}.event:first-child .dot{width:34px;height:34px;left:-45px;top:-3px}.event:first-child .msg{font-size:17px;font-weight:800}.when{font-weight:750;font-size:12px}.msg{margin-top:3px;font-size:14px}.loc{margin-top:2px;color:var(--secondary);font-size:11px}.state{height:100%;display:grid;place-items:center;text-align:center;padding:25px;color:var(--secondary)}.state img{display:block;width:84px;margin:0 auto 13px}.state strong{display:block;font-size:17px;color:var(--primary)}@media(prefers-color-scheme:dark){:root{--bg:#202022;--panel:#2e2e30;--primary:#f7f7f8;--secondary:#c2c2c7;--line:#454548}.fact{background:#55321f;color:#ffd2b3}}</style></head><body><main class="card"><header><img src="icon.svg" alt="PostNL"><h1 id="title">Reis van je pakket</h1></header><section id="c"><div class="state">Reis ophalen…</div></section></main><script>const I={nl:{title:'Reis van je pakket',empty:'Er is momenteel geen pakketreis',emptySub:'Zodra er een pakket onderweg is, verschijnt de reis hier.',tracking:'Tracking',weight:'Gewicht',dimensions:'Afmetingen'},en:{title:'Parcel Journey',empty:'There is currently no parcel journey',emptySub:'As soon as a parcel is on its way, its journey appears here.',tracking:'Tracking',weight:'Weight',dimensions:'Dimensions'}};let H,L,TZ;const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));function lang(v){return String(v||'en').split('-')[0]==='nl'?'nl':'en'}function dt(v){if(!v)return'';const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v);try{return new Intl.DateTimeFormat(L==='nl'?'nl-NL':'en-GB',{timeZone:TZ,day:'2-digit',month:'long',hour:'2-digit',minute:'2-digit'}).format(d)}catch(_){return String(v)}}function render(x){const c=document.getElementById('c');if(!x.parcel){c.innerHTML=`<div class="state"><div><img src="package.svg"><strong>${esc(I[L].empty)}</strong><div>${esc(I[L].emptySub)}</div></div></div>`;return}const p=x.parcel;let events=[...(p.events||[])].filter(e=>e.description||e.timestamp).sort((a,b)=>(Date.parse(b.timestamp||'')||0)-(Date.parse(a.timestamp||'')||0));if(!events.length)events=[{description:p.status,timestamp:''}];const facts=[];if(p.weight)facts.push(`<span class="fact">${esc(I[L].weight)}: ${esc(p.weight)}</span>`);if(p.dimensions)facts.push(`<span class="fact">${esc(I[L].dimensions)}: ${esc(p.dimensions)}</span>`);c.innerHTML=`<div class="hero"><div class="sender">${esc(p.sender||'PostNL')}</div><div class="status">${esc(p.status||events[0]?.description||'')}</div><div class="track">${esc(I[L].tracking)}: ${esc(p.tracking||'')}</div><div class="facts">${facts.join('')}</div></div><div class="journey">${events.map((e,i)=>`<div class="event"><span class="dot">${i===0?'▣':'✓'}</span><div class="when">${esc(dt(e.timestamp))}</div><div class="msg">${esc(e.description)}</div>${e.location?`<div class="loc">${esc(e.location)}</div>`:''}</div>`).join('')}</div>`}async function load(){const ids=H.getDeviceIds(),id=ids[0]||'';const x=await H.api('GET','/?deviceId='+encodeURIComponent(id),{});L=lang(x.locale);TZ=x.timeZone||'UTC';document.getElementById('title').textContent=I[L].title;render(x);return id}async function onHomeyReady(Homey){H=Homey;try{const id=await load();Homey.ready();Homey.api('POST','/sync',{deviceId:id}).then(load).catch(()=>{})}catch(e){document.getElementById('c').innerHTML=`<div class="state">${esc(e.message||e)}</div>`;Homey.ready()}}</script></body></html>''')

# app.json generated content additions.
p=Path('app.json'); a=json.loads(p.read_text())
for name,obj in newcaps.items(): a.setdefault('capabilities',{})[name]=obj
for drv in a.get('drivers',[]):
    if drv.get('id')=='account':
        for cap in ['postnl_package_weight','postnl_package_dimensions']:
            if cap not in drv['capabilities']:
                idx=drv['capabilities'].index('postnl_package_shipment_type')+1 if 'postnl_package_shipment_type' in drv['capabilities'] else len(drv['capabilities']); drv['capabilities'].insert(idx,cap)
for trig in a.get('flow',{}).get('triggers',[]):
    if trig.get('id') in {'new_package','delivery_window_known','package_status_changed'}:
        names={t.get('name') for t in trig.get('tokens',[])}
        if 'package_weight' not in names: trig['tokens'].append({'name':'package_weight','type':'string','title':{'en':'Package weight','nl':'Gewicht pakket'}})
        if 'package_dimensions' not in names: trig['tokens'].append({'name':'package_dimensions','type':'string','title':{'en':'Package dimensions','nl':'Afmetingen pakket'}})
a.setdefault('widgets',{})['pakket-reis']={'name':{'en':'Parcel Journey','nl':'Reis van je pakket'},'height':420,'api':{'getData':{'method':'GET','path':'/'},'sync':{'method':'POST','path':'/sync'}},'devices':{'type':'app','singular':True,'filter':{'capabilities':'postnl_package_count'}},'id':'pakket-reis','settings':[]}
p.write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n')

p=Path('.homeychangelog.json'); c=json.loads(p.read_text()); c['1.2.1']={'en':'Added Parcel Journey widget with the full official PostNL tracking timeline. When no parcel is underway, the widget shows an empty state. Package weight and dimensions are now extracted from PostNL tracking data when available and exposed in the journey widget, device capabilities, global Flow tokens and package trigger tokens.','nl':'Nieuwe Reis van je pakket-widget met de volledige officiële PostNL Track & Trace-tijdlijn. Wanneer er geen pakket onderweg is, toont de widget een lege status. Gewicht en afmetingen worden waar beschikbaar uit de PostNL-trackingdata gehaald en zijn beschikbaar in de reis-widget, apparaat-capabilities, globale Flow-tokens en pakket-trigger-tokens.'}; p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')