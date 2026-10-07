from pathlib import Path
import json, copy, subprocess

# Restore the exact v1.2.2 widget previews.
for widget in ['mijn-post','mijn-pakket','pakket-details','pakket-reis']:
    for name in ['preview-light.png','preview-dark.png']:
        data = subprocess.check_output(['git','show',f'v1.2.2:widgets/{widget}/{name}'])
        (Path('widgets')/widget/name).write_bytes(data)

p=Path('app.json')
d=json.loads(p.read_text())
flow=d['flow']
triggers=flow['triggers']
existing={x['id'] for x in triggers}
base=next(x for x in triggers if x['id']=='package_status_changed')
base_tokens=[t for t in base['tokens'] if t.get('name')!='old_status']
device_args=copy.deepcopy(base['args'])

def trig(id_,en,nl,extra=None,highlight=False):
    toks=copy.deepcopy(base_tokens)
    if extra: toks=copy.deepcopy(extra)+toks
    obj={'id':id_,'title':{'en':en,'nl':nl},'args':copy.deepcopy(device_args),'tokens':toks}
    if highlight: obj['highlight']=True
    return obj

for card in [
    trig('package_delivered','A parcel was delivered','Een pakket is bezorgd',highlight=True),
    trig('delivery_window_changed','A parcel delivery window changed','Het bezorgvenster van een pakket is gewijzigd',[{'name':'old_delivery_window','type':'string','title':{'en':'Previous delivery window','nl':'Vorig bezorgvenster'}}],True),
    trig('package_event_changed','A new PostNL parcel event was received','Er is een nieuwe PostNL-pakketgebeurtenis',[{'name':'old_event','type':'string','title':{'en':'Previous PostNL event','nl':'Vorige PostNL-gebeurtenis'}}]),
    trig('package_weight_known','Parcel weight became available','Het gewicht van een pakket is bekend'),
    trig('package_dimensions_known','Parcel dimensions became available','De afmetingen van een pakket zijn bekend'),
]:
    if card['id'] not in existing:
        triggers.append(card)
        existing.add(card['id'])

conditions=flow['conditions']
condition_ids={x['id'] for x in conditions}
for card in [
    {'id':'postnl_connected','title':{'en':'PostNL is connected','nl':'PostNL is verbonden'},'args':copy.deepcopy(device_args)},
    {'id':'package_has_weight','title':{'en':'The current parcel has weight information','nl':'Het huidige pakket heeft gewichtsinformatie'},'args':copy.deepcopy(device_args)},
    {'id':'package_has_dimensions','title':{'en':'The current parcel has dimensions','nl':'Het huidige pakket heeft afmetingen'},'args':copy.deepcopy(device_args)},
    {'id':'package_status_is','title':{'en':'The current parcel status is [[status]]','nl':'De huidige pakketstatus is [[status]]'},'args':copy.deepcopy(device_args)+[{'type':'text','name':'status','title':{'en':'Status','nl':'Status'},'placeholder':{'en':'e.g. Courier is on the way','nl':'bijv. Bezorger is onderweg'}}]},
]:
    if card['id'] not in condition_ids:
        conditions.append(card)
        condition_ids.add(card['id'])
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')

p=Path('drivers/account/driver.js')
s=p.read_text()
if "package_delivered: this.homey.flow.getDeviceTriggerCard('package_delivered')" not in s:
    s=s.replace("      package_status_changed: this.homey.flow.getDeviceTriggerCard('package_status_changed'),\n",
                "      package_status_changed: this.homey.flow.getDeviceTriggerCard('package_status_changed'),\n"
                "      package_delivered: this.homey.flow.getDeviceTriggerCard('package_delivered'),\n"
                "      delivery_window_changed: this.homey.flow.getDeviceTriggerCard('delivery_window_changed'),\n"
                "      package_event_changed: this.homey.flow.getDeviceTriggerCard('package_event_changed'),\n"
                "      package_weight_known: this.homey.flow.getDeviceTriggerCard('package_weight_known'),\n"
                "      package_dimensions_known: this.homey.flow.getDeviceTriggerCard('package_dimensions_known'),\n")
if "getConditionCard('postnl_connected')" not in s:
    s=s.replace("    this.homey.flow.getConditionCard('delivery_window_known').registerRunListener(async ({ device }) => Boolean(device && device.hasDeliveryWindowKnown()));\n",
                "    this.homey.flow.getConditionCard('delivery_window_known').registerRunListener(async ({ device }) => Boolean(device && device.hasDeliveryWindowKnown()));\n"
                "    this.homey.flow.getConditionCard('postnl_connected').registerRunListener(async ({ device }) => Boolean(device && device.isPostNLConnected()));\n"
                "    this.homey.flow.getConditionCard('package_has_weight').registerRunListener(async ({ device }) => Boolean(device && device.currentPackageHasWeight()));\n"
                "    this.homey.flow.getConditionCard('package_has_dimensions').registerRunListener(async ({ device }) => Boolean(device && device.currentPackageHasDimensions()));\n"
                "    this.homey.flow.getConditionCard('package_status_is').registerRunListener(async ({ device, status }) => Boolean(device && device.currentPackageStatusIs(status)));\n")
s=s.replace("    if (['new_package', 'delivery_window_known', 'package_status_changed'].includes(cardId)) Object.assign(common, {",
            "    if (['new_package', 'delivery_window_known', 'package_status_changed', 'package_delivered', 'delivery_window_changed', 'package_event_changed', 'package_weight_known', 'package_dimensions_known'].includes(cardId)) Object.assign(common, {")
p.write_text(s)

p=Path('drivers/account/device.js')
s=p.read_text()
if 'async triggerPackageDelivered' not in s:
    s=s.replace("  async triggerPackageStatusChanged(tokens = {}) { return this._triggerDeviceFlow('package_status_changed', tokens); }\n",
                "  async triggerPackageStatusChanged(tokens = {}) { return this._triggerDeviceFlow('package_status_changed', tokens); }\n"
                "  async triggerPackageDelivered(tokens = {}) { return this._triggerDeviceFlow('package_delivered', tokens); }\n"
                "  async triggerDeliveryWindowChanged(tokens = {}) { return this._triggerDeviceFlow('delivery_window_changed', tokens); }\n"
                "  async triggerPackageEventChanged(tokens = {}) { return this._triggerDeviceFlow('package_event_changed', tokens); }\n"
                "  async triggerPackageWeightKnown(tokens = {}) { return this._triggerDeviceFlow('package_weight_known', tokens); }\n"
                "  async triggerPackageDimensionsKnown(tokens = {}) { return this._triggerDeviceFlow('package_dimensions_known', tokens); }\n")
old="""      if (old && this._packageStatusFingerprint(old) !== this._packageStatusFingerprint(parcel)) {
        await this.triggerPackageStatusChanged({
          ...tokens,
          old_status: String(old.statusRaw || localizePackageStatus(this.homey, old.status) || old.status || ''),
        });
      }
"""
new="""      if (old) {
        const oldWindow = old.deliveryWindow || this.api.formatWindow(old.deliveryWindowFrom, old.deliveryWindowTo) || '';
        const newWindow = parcel.deliveryWindow || this.api.formatWindow(parcel.deliveryWindowFrom, parcel.deliveryWindowTo) || '';
        if (newWindow && oldWindow && newWindow !== oldWindow && !parcel.delivered) await this.triggerDeliveryWindowChanged({ ...tokens, old_delivery_window: oldWindow });
        const oldEvent = String(old.latestStatusEvent || old.statusRaw || old.status || '');
        const newEvent = String(parcel.latestStatusEvent || parcel.statusRaw || parcel.status || '');
        if (newEvent && newEvent !== oldEvent) await this.triggerPackageEventChanged({ ...tokens, old_event: oldEvent });
        if (!String(old.weight || '').trim() && String(parcel.weight || '').trim()) await this.triggerPackageWeightKnown(tokens);
        if (!String(old.dimensions || '').trim() && String(parcel.dimensions || '').trim()) await this.triggerPackageDimensionsKnown(tokens);
        if (!old.delivered && parcel.delivered) await this.triggerPackageDelivered(tokens);
        if (this._packageStatusFingerprint(old) !== this._packageStatusFingerprint(parcel)) {
          await this.triggerPackageStatusChanged({
            ...tokens,
            old_status: String(old.statusRaw || localizePackageStatus(this.homey, old.status) || old.status || ''),
          });
        }
      }
"""
if old in s: s=s.replace(old,new)
old2="""        if (this._packageStatusFingerprint(old) !== this._packageStatusFingerprint(refreshed)) {
          const tokens = await this._packageTokens(refreshed);
          await this.triggerPackageStatusChanged({
            ...tokens,
            old_status: String(old.statusRaw || localizePackageStatus(this.homey, old.status) || old.status || ''),
          });
        }
"""
new2="""        if (this._packageStatusFingerprint(old) !== this._packageStatusFingerprint(refreshed)) {
          const tokens = await this._packageTokens(refreshed);
          const oldEvent = String(old.latestStatusEvent || old.statusRaw || old.status || '');
          const newEvent = String(refreshed.latestStatusEvent || refreshed.statusRaw || refreshed.status || '');
          if (newEvent && newEvent !== oldEvent) await this.triggerPackageEventChanged({ ...tokens, old_event: oldEvent });
          if (!old.delivered && refreshed.delivered) await this.triggerPackageDelivered(tokens);
          if (!String(old.weight || '').trim() && String(refreshed.weight || '').trim()) await this.triggerPackageWeightKnown(tokens);
          if (!String(old.dimensions || '').trim() && String(refreshed.dimensions || '').trim()) await this.triggerPackageDimensionsKnown(tokens);
          await this.triggerPackageStatusChanged({
            ...tokens,
            old_status: String(old.statusRaw || localizePackageStatus(this.homey, old.status) || old.status || ''),
          });
        }
"""
if old2 in s: s=s.replace(old2,new2)
old3="""  isMailExpected() { return Boolean(this.getCapabilityValue('postnl_mail_expected')); }
  hasPackagesUnderway() { return Number(this.getCapabilityValue('postnl_package_count') || 0) > 0; }
  hasDeliveryWindowKnown() { return (this.snapshot.packages || []).some(parcel => !parcel.delivered && this._hasDeliveryWindow(parcel)); }
"""
new3="""  isMailExpected() { return Boolean(this.getCapabilityValue('postnl_mail_expected')); }
  hasPackagesUnderway() { return Number(this.getCapabilityValue('postnl_package_count') || 0) > 0; }
  hasDeliveryWindowKnown() { return (this.snapshot.packages || []).some(parcel => !parcel.delivered && this._hasDeliveryWindow(parcel)); }
  isPostNLConnected() { return Boolean(this.api && this.api.hasCredentials()); }
  currentPackageHasWeight() { const parcel = this._selectActivePackage(); return Boolean(parcel && String(parcel.weight || '').trim()); }
  currentPackageHasDimensions() { const parcel = this._selectActivePackage(); return Boolean(parcel && String(parcel.dimensions || '').trim()); }
  currentPackageStatusIs(expected = '') {
    const parcel = this._selectActivePackage();
    if (!parcel) return false;
    const actual = String(parcel.statusRaw || parcel.latestStatusEvent || localizePackageStatus(this.homey, parcel.status) || parcel.status || '').trim().toLocaleLowerCase();
    return actual === String(expected || '').trim().toLocaleLowerCase();
  }
"""
if old3 in s: s=s.replace(old3,new3)
p.write_text(s)

p=Path('.homeychangelog.json')
ch=json.loads(p.read_text())
ch['1.2.3']={
  'en':'Added device Flow triggers for parcel delivered, delivery window changed, new PostNL parcel event, parcel weight available and parcel dimensions available. Added conditions for PostNL connected, parcel weight available, parcel dimensions available and current parcel status. Restored the v1.2.2 widget preview images.',
  'nl':'Apparaat-Flowtriggers toegevoegd voor pakket bezorgd, bezorgvenster gewijzigd, nieuwe PostNL-pakketgebeurtenis, pakketgewicht bekend en pakketafmetingen bekend. Ook voorwaarden toegevoegd voor PostNL verbonden, pakketgewicht beschikbaar, pakketafmetingen beschikbaar en huidige pakketstatus. De widget-previews van v1.2.2 zijn teruggezet.'
}
p.write_text(json.dumps(ch,ensure_ascii=False,indent=2)+'\n')
