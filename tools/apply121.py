from pathlib import Path
import json, shutil

# Version
for rel in ['package.json','package-lock.json','.homeycompose/app.json','app.json']:
    p=Path(rel); d=json.loads(p.read_text()); d['version']='1.2.1'
    if rel=='package-lock.json' and d.get('packages',{}).get('') is not None: d['packages']['']['version']='1.2.1'
    p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')

# Weight and dimensions from official Track & Trace response
p=Path('lib/postnl-api.js'); s=p.read_text()
anchor="""  _trackingEventDescription(event = {}) {\n    return String(event.description || event.message || event.status || event.eventDescription || '').trim();\n  }\n\n"""
if '_trackingPhysicalProperties' not in s:
    insert=r'''  _trackingPhysicalProperties(colli = {}) {
    const candidates = [colli?.physicalProperties, colli?.parcelCharacteristics, colli?.characteristics, colli?.measurements, colli?.dimensions, colli?.size, colli].filter(value => value && typeof value === 'object');
    const first = (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
    let weight = first(colli.weightInGrams, colli.weightInGram, colli.weightGram, colli.weight, colli.parcelWeight);
    let length, width, height, unit;
    for (const obj of candidates) {
      if (weight == null) weight = first(obj.weightInGrams, obj.weightInGram, obj.weightGram, obj.weight, obj.mass, obj.value);
      length = length ?? first(obj.length, obj.depth, obj.longSide, obj.l);
      width = width ?? first(obj.width, obj.shortSide, obj.w);
      height = height ?? first(obj.height, obj.h);
      unit = unit ?? first(obj.unit, obj.dimensionUnit, obj.dimensionsUnit, obj.unitOfMeasure);
      if ((!length || !width || !height) && Array.isArray(obj.dimensions) && obj.dimensions.length >= 3) [length, width, height] = obj.dimensions;
    }
    const number = value => { if (typeof value === 'number') return Number.isFinite(value) ? value : null; const m=String(value ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
    const formatNumber = value => { const n=number(value); if(n==null)return''; return Number.isInteger(n)?String(n):String(Math.round(n*10)/10).replace('.', ','); };
    let weightText='';
    if(weight!=null){ if(typeof weight==='string'&&/(?:g|kg)\b/i.test(weight)) weightText=String(weight).trim(); else {const n=number(weight); if(n!=null) weightText=`${formatNumber(n)} gram`;}}
    const l=formatNumber(length),w=formatNumber(width),h=formatNumber(height),unitText=String(unit||'cm').toLowerCase().replace('centimeter','cm').replace('centimetre','cm');
    return {weight:weightText,dimensions:l&&w&&h?`${l} x ${w} x ${h} ${unitText}`:''};
  }

'''
    s=s.replace(anchor,anchor+insert)
s=s.replace("    const deliveredByStatus = /\\b(bezorgd|afgehaald)\\b/i.test(officialStatus);\n\n    return {", "    const deliveredByStatus = /\\b(bezorgd|afgehaald)\\b/i.test(officialStatus);\n    const physical = this._trackingPhysicalProperties(colli);\n\n    return {")
s=s.replace("      deliveryWindow: this.formatWindow(etaFrom, etaTo) || parcel.deliveryWindow || '',\n    };", "      deliveryWindow: this.formatWindow(etaFrom, etaTo) || parcel.deliveryWindow || '',\n      weight: physical.weight || parcel.weight || '',\n      dimensions: physical.dimensions || parcel.dimensions || '',\n    };")
if "      weight: '',\n      dimensions: ''," not in s:
    s=s.replace("      statusFingerprint: [fallbackStatus, item.deliveredTimeStamp || item.creationDateTime || ''].join('|'),\n", "      statusFingerprint: [fallbackStatus, item.deliveredTimeStamp || item.creationDateTime || ''].join('|'),\n      weight: '',\n      dimensions: '',\n")
p.write_text(s)

# Global tokens
p=Path('drivers/account/driver.js'); s=p.read_text()
if 'package_weight:' not in s:
    s=s.replace("      package_tracking: { type: 'string', en: 'Parcel tracking number', nl: 'Trackingnummer pakket' },\n", "      package_tracking: { type: 'string', en: 'Parcel tracking number', nl: 'Trackingnummer pakket' },\n      package_weight: { type: 'string', en: 'Parcel weight', nl: 'Gewicht pakket' },\n      package_dimensions: { type: 'string', en: 'Parcel dimensions', nl: 'Afmetingen pakket' },\n")
    s=s.replace("      package_tracking: tokens.package_tracking || tokens.barcode || tokens.id, old_status: tokens.old_status,\n", "      package_tracking: tokens.package_tracking || tokens.barcode || tokens.id, package_weight: tokens.weight, package_dimensions: tokens.dimensions, old_status: tokens.old_status,\n")
p.write_text(s)

# Device capabilities and token values
p=Path('drivers/account/device.js'); s=p.read_text()
s=s.replace("'postnl_package_delivered', 'postnl_package_shipment_type']", "'postnl_package_delivered', 'postnl_package_shipment_type', 'postnl_package_weight', 'postnl_package_dimensions']")
if "weight: String(parcel.weight || '')" not in s:
    s=s.replace("      package_status_text: status, package_window_text: deliveryWindow, package_delivery_date: deliveryDate,\n", "      weight: String(parcel.weight || ''), dimensions: String(parcel.dimensions || ''),\n      package_status_text: status, package_window_text: deliveryWindow, package_delivery_date: deliveryDate,\n")
if 'package_weight: activePackage.weight' not in s:
    s=s.replace("      package_source_account_id: activePackage.sourceAccountId || '', package_tracking: activePackage.barcode || activePackage.id || '',\n", "      package_source_account_id: activePackage.sourceAccountId || '', package_tracking: activePackage.barcode || activePackage.id || '',\n      package_weight: activePackage.weight || '', package_dimensions: activePackage.dimensions || '',\n")
if 'postnl_package_weight:' not in s:
    s=s.replace("      postnl_package_shipment_type: nextPackage?.shipmentType || '—',\n", "      postnl_package_shipment_type: nextPackage?.shipmentType || '—',\n      postnl_package_weight: nextPackage?.weight || '—',\n      postnl_package_dimensions: nextPackage?.dimensions || '—',\n")
p.write_text(s)

# Package Flow tokens
p=Path('drivers/account/driver.flow.compose.json'); d=json.loads(p.read_text())
for trig in d.get('triggers',[]):
    if trig.get('id') in {'new_package','delivery_window_known','package_status_changed'}:
        names={t['name'] for t in trig.get('tokens',[])}
        if 'weight' not in names: trig['tokens'].append({'name':'weight','type':'string','title':{'en':'Weight','nl':'Gewicht'}})
        if 'dimensions' not in names: trig['tokens'].append({'name':'dimensions','type':'string','title':{'en':'Dimensions','nl':'Afmetingen'}})
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')

# New device capabilities
caps={
'postnl_package_weight':{'type':'string','title':{'en':'Parcel weight','nl':'Gewicht pakket'},'getable':True,'setable':False,'insights':False,'icon':'/assets/package.svg'},
'postnl_package_dimensions':{'type':'string','title':{'en':'Parcel dimensions','nl':'Afmetingen pakket'},'getable':True,'setable':False,'insights':False,'icon':'/assets/package.svg'}
}
capdir=Path('.homeycompose/capabilities'); capdir.mkdir(parents=True,exist_ok=True)
for cid,obj in caps.items(): (capdir/f'{cid}.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
p=Path('drivers/account/driver.compose.json'); dd=json.loads(p.read_text())
for cid in caps:
    if cid not in dd['capabilities']: dd['capabilities'].insert(-2,cid)
p.write_text(json.dumps(dd,ensure_ascii=False,indent=2)+'\n')

# My Packages details
p=Path('widgets/mijn-pakket/api.js'); s=p.read_text()
if 'weight:str(parcel.weight)' not in s:
    s=s.replace("shipmentType:str(parcel.shipmentType),deliveryAddressType:str(parcel.deliveryAddressType),direction:str(parcel.direction),sharedFrom:str(parcel.sourceDisplayName),sourceAccountId:str(parcel.sourceAccountId),title:str(parcel.title),detailsUrl:str(parcel.detailsUrl),delivered:Boolean(parcel.delivered)", "shipmentType:str(parcel.shipmentType),deliveryAddressType:str(parcel.deliveryAddressType),direction:str(parcel.direction),sharedFrom:str(parcel.sourceDisplayName),sourceAccountId:str(parcel.sourceAccountId),title:str(parcel.title),detailsUrl:str(parcel.detailsUrl),weight:str(parcel.weight),dimensions:str(parcel.dimensions),statusEvents:Array.isArray(parcel.statusEvents)?parcel.statusEvents:[],delivered:Boolean(parcel.delivered)")
p.write_text(s)
p=Path('widgets/mijn-pakket/public/index.html'); s=p.read_text()
s=s.replace("sharedFrom:'Shared from',lastEvent:'Last event',close:'Close'", "sharedFrom:'Shared from',lastEvent:'Last event',weight:'Weight',dimensions:'Dimensions',close:'Close'")
s=s.replace("sharedFrom:'Gedeeld via',lastEvent:'Laatste gebeurtenis',close:'Sluiten'", "sharedFrom:'Gedeeld via',lastEvent:'Laatste gebeurtenis',weight:'Gewicht',dimensions:'Afmetingen',close:'Sluiten'")
if 'labels.weight,p.weight' not in s: s=s.replace("detailRow(list,labels.sharedFrom,p.sharedFrom);detailRow(list,labels.lastEvent,p.lastEvent||p.status);", "detailRow(list,labels.sharedFrom,p.sharedFrom);detailRow(list,labels.weight,p.weight);detailRow(list,labels.dimensions,p.dimensions);detailRow(list,labels.lastEvent,p.lastEvent||p.status);")
p.write_text(s)

# Parcel Journey widget
w=Path('widgets/reis-pakket'); (w/'public').mkdir(parents=True,exist_ok=True)
(w/'widget.compose.json').write_text(json.dumps({'name':{'en':'Parcel Journey','nl':'Reis van je pakket'},'height':420,'api':{'getData':{'method':'GET','path':'/'},'sync':{'method':'POST','path':'/sync'}},'devices':{'type':'app','singular':True,'filter':{'capabilities':'postnl_package_count'}}},ensure_ascii=False,indent=2)+'\n')
(w/'api.js').write_text("""'use strict';\nfunction ids(v){if(Array.isArray(v))return v.map(String).filter(Boolean);if(typeof v!=='string')return[];return v.split(',').map(x=>x.trim()).filter(Boolean)}\nfunction str(...v){for(const x of v){if(x===0)return'0';if(x!==undefined&&x!==null&&String(x).trim())return String(x).trim()}return''}\nfunction device(homey,raw){const wanted=ids(raw),list=homey.drivers.getDriver('account').getDevices(),id=wanted[0]||String(raw||'').trim(),d=list.find(x=>x.getId()===id);if(!d)throw new Error('Select a PostNL device for this widget.');return d}\nfunction rank(p){const raw=p?.deliveryWindowFrom||p?.deliveryDate||p?.createdAt||'';const t=Date.parse(raw);return Number.isFinite(t)?t:Number.MAX_SAFE_INTEGER}\nmodule.exports={async getData({homey,query}){const d=device(homey,query?.deviceIds||query?.deviceId),data=d.getWidgetData(),active=(data.packages||[]).filter(p=>!p.delivered).sort((a,b)=>rank(a)-rank(b))[0]||null;return{authenticated:data.authenticated,locale:homey.i18n.getLanguage(),timeZone:homey.clock.getTimezone(),updatedAt:data.updatedAt||null,parcel:active?{id:str(active.id),sender:str(active.sender,active.title,active.sourceDisplayName,'PostNL'),tracking:str(active.barcode,active.id),status:str(active.statusRaw,active.latestStatusEvent,active.status),deliveryWindow:str(active.deliveryWindow),deliveryWindowFrom:str(active.deliveryWindowFrom),deliveryWindowTo:str(active.deliveryWindowTo),weight:str(active.weight),dimensions:str(active.dimensions),events:Array.isArray(active.statusEvents)?active.statusEvents:[]}:null}},async sync({homey,body}){const d=device(homey,body?.deviceIds||body?.deviceId);await d.sync({reason:'widget',force:true});return{ok:true}}};\n""")
shutil.copy2('assets/icon.svg',w/'public/icon.svg'); shutil.copy2('assets/package.svg',w/'public/package.svg')
shutil.copy2('widgets/mijn-pakket/preview-light.png',w/'preview-light.png'); shutil.copy2('widgets/mijn-pakket/preview-dark.png',w/'preview-dark.png')
html='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark;--bg:#f4f4f5;--header:#fafafa;--border:#dedee0;--primary:#20202a;--secondary:#676773;--orange:#e75a1c}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:var(--primary);font:14px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{height:100%;display:grid;grid-template-rows:52px minmax(0,1fr);border-radius:17px;overflow:hidden;background:var(--bg)}header{display:flex;align-items:center;padding:0 18px;background:var(--header);border-bottom:1px solid var(--border)}header img{width:36px;height:36px}h1{margin:0 0 0 auto;font-size:18px;color:#77767b}.body{overflow:auto;padding:15px 16px 18px}.summary{padding:0 2px 12px;border-bottom:1px solid var(--border)}.sender{font-size:16px;font-weight:800}.tracking,.physical{color:var(--secondary);font-size:11px;margin-top:3px}.status{font-size:18px;font-weight:850;margin-top:8px;overflow-wrap:anywhere}.journey{position:relative;padding:12px 0 0 42px}.journey:before{content:"";position:absolute;left:17px;top:24px;bottom:18px;width:3px;background:var(--orange)}.event{position:relative;padding:0 0 18px;min-height:55px}.dot{position:absolute;left:-41px;top:2px;width:31px;height:31px;border-radius:50%;display:grid;place-items:center;background:var(--orange);color:#fff;font-size:18px;font-weight:900}.event:first-child .dot{width:38px;height:38px;left:-44px;top:-1px}.when{font-weight:750;font-size:12px}.msg{font-size:14px;margin-top:4px;overflow-wrap:anywhere}.event:first-child .msg{font-size:18px;font-weight:850}.location{font-size:11px;color:var(--secondary);margin-top:3px}.state{height:100%;display:grid;place-items:center;text-align:center;padding:25px;color:#77767b}.state img{width:105px;margin-bottom:14px}.state strong{display:block;font-size:17px;color:var(--primary)}@media(prefers-color-scheme:dark){:root{--bg:#202022;--header:#29292b;--border:#454548;--primary:#f4f4f5;--secondary:#c4c3c7}}</style></head><body><main class="card"><header><img src="icon.svg"><h1 id="title">Reis van je pakket</h1></header><section id="body" class="body"><div class="state">Pakketreis ophalen…</div></section></main><script>const t={nl:{title:'Reis van je pakket',loading:'Pakketreis ophalen…',empty:'Er is momenteel geen pakketreis.',tracking:'Tracking',weight:'Gewicht',dimensions:'Afmetingen',login:'Koppel eerst je PostNL-account.'},en:{title:'Parcel Journey',loading:'Loading parcel journey…',empty:'There is currently no parcel journey.',tracking:'Tracking',weight:'Weight',dimensions:'Dimensions',login:'Connect your PostNL account first.'}};function L(v){return String(v||'en').split('-')[0]==='nl'?'nl':'en'}function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}function fmt(v,locale,tz){const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v||'');try{return new Intl.DateTimeFormat(locale==='nl'?'nl-NL':'en-GB',{timeZone:tz,day:'2-digit',month:'long',hour:'2-digit',minute:'2-digit'}).format(d)}catch(_){return String(v||'')}}function onHomeyReady(Homey){const body=document.getElementById('body'),title=document.getElementById('title');let id=(Homey.getDeviceIds()||[])[0]||'',busy=false;async function get(){return Homey.api('GET','/?deviceId='+encodeURIComponent(id),{})}function render(x){const lang=L(x.locale),w=t[lang];title.textContent=w.title;if(!x.authenticated){body.innerHTML='<div class="state">'+esc(w.login)+'</div>';return}const p=x.parcel;if(!p){body.innerHTML='<div class="state"><div><img src="package.svg"><strong>'+esc(w.empty)+'</strong></div></div>';return}const physical=[p.weight?w.weight+': '+p.weight:'',p.dimensions?w.dimensions+': '+p.dimensions:''].filter(Boolean).join(' · ');const events=[...(p.events||[])].sort((a,b)=>(Date.parse(b.timestamp||'')||0)-(Date.parse(a.timestamp||'')||0));let h='<section class="summary"><div class="sender">'+esc(p.sender||'PostNL')+'</div><div class="tracking">'+esc(w.tracking)+': '+esc(p.tracking)+'</div>'+(physical?'<div class="physical">'+esc(physical)+'</div>':'')+'<div class="status">'+esc(p.status||'')+'</div></section>';if(!events.length)events.push({description:p.status,timestamp:x.updatedAt||''});h+='<div class="journey">'+events.map((e,i)=>'<article class="event"><span class="dot">'+(i?'✓':'▣')+'</span><div class="when">'+esc(fmt(e.timestamp,x.locale,x.timeZone))+'</div><div class="msg">'+esc(e.description||'')+'</div>'+(e.location?'<div class="location">'+esc(e.location)+'</div>':'')+'</article>').join('')+'</div>';body.innerHTML=h}async function load(show=true){if(show)body.innerHTML='<div class="state">'+t.nl.loading+'</div>';try{render(await get())}catch(e){body.innerHTML='<div class="state">'+esc(e.message||e)+'</div>'}}async function refresh(){if(busy)return;busy=true;try{await Homey.api('POST','/sync',{deviceId:id});await load(false)}catch(_){}finally{busy=false}}(async()=>{await load(true);Homey.ready();refresh();setInterval(refresh,60000)})()}</script></body></html>'''
(w/'public/index.html').write_text(html)

# Generated app.json mirror
p=Path('app.json'); app=json.loads(p.read_text())
for cid,obj in caps.items(): app.setdefault('capabilities',{})[cid]=obj
for drv in app.get('drivers',[]):
    if drv.get('id')=='account':
        for cid in caps:
            if cid not in drv['capabilities']: drv['capabilities'].insert(-2,cid)
for trig in app.get('flow',{}).get('triggers',[]):
    if trig.get('id') in {'new_package','delivery_window_known','package_status_changed'}:
        names={t['name'] for t in trig.get('tokens',[])}
        if 'weight' not in names: trig['tokens'].append({'name':'weight','type':'string','title':{'en':'Weight','nl':'Gewicht'}})
        if 'dimensions' not in names: trig['tokens'].append({'name':'dimensions','type':'string','title':{'en':'Dimensions','nl':'Afmetingen'}})
app.setdefault('widgets',{})['reis-pakket']={'name':{'en':'Parcel Journey','nl':'Reis van je pakket'},'height':420,'api':{'getData':{'method':'GET','path':'/'},'sync':{'method':'POST','path':'/sync'}},'devices':{'type':'app','singular':True,'filter':{'capabilities':'postnl_package_count'}},'id':'reis-pakket','settings':[]}
p.write_text(json.dumps(app,ensure_ascii=False,indent=2)+'\n')

p=Path('.homeychangelog.json'); ch=json.loads(p.read_text()); ch['1.2.1']={'en':'Added Parcel Journey widget with the official PostNL tracking timeline for the current active parcel. When no parcel is underway, including after delivery, the widget shows an empty state. Added parcel weight and dimensions to device capabilities, global Flow tokens, package Flow trigger tokens and My Packages details whenever PostNL provides these values.','nl':'Nieuwe widget Reis van je pakket met de officiële PostNL Track & Trace-tijdlijn van het huidige actieve pakket. Wanneer er geen pakket onderweg is, dus ook na bezorging, toont de widget een lege status. Gewicht en afmetingen zijn toegevoegd aan apparaat-capabilities, globale Flow-tokens, pakket-Flowtokens en Mijn Pakketten-details wanneer PostNL deze gegevens beschikbaar stelt.'}; p.write_text(json.dumps(ch,ensure_ascii=False,indent=2)+'\n')
