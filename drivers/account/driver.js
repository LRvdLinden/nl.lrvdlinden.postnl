'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const PostNLApi = require('../../lib/postnl-api');

class PostNLDriver extends Homey.Driver {
  async onInit() {
    // Device Flow triggers are initialized once on the Driver. Devices delegate
    // triggering here so Homey's card lifecycle is consistent for every account.
    this._flowTriggers = {
      new_mail: this.homey.flow.getDeviceTriggerCard('new_mail'),
      new_package: this.homey.flow.getDeviceTriggerCard('new_package'),
      delivery_window_known: this.homey.flow.getDeviceTriggerCard('delivery_window_known'),
      package_status_changed: this.homey.flow.getDeviceTriggerCard('package_status_changed'),
      package_delivered: this.homey.flow.getDeviceTriggerCard('package_delivered'),
      delivery_window_changed: this.homey.flow.getDeviceTriggerCard('delivery_window_changed'),
      package_event_changed: this.homey.flow.getDeviceTriggerCard('package_event_changed'),
      package_weight_known: this.homey.flow.getDeviceTriggerCard('package_weight_known'),
      package_dimensions_known: this.homey.flow.getDeviceTriggerCard('package_dimensions_known'),
      sync_failed: this.homey.flow.getDeviceTriggerCard('sync_failed'),
      login_expired: this.homey.flow.getDeviceTriggerCard('login_expired'),
    };

    this.homey.flow.getConditionCard('mail_expected').registerRunListener(async ({ device }) => Boolean(device && device.isMailExpected()));
    this.homey.flow.getConditionCard('packages_underway').registerRunListener(async ({ device }) => Boolean(device && device.hasPackagesUnderway()));
    this.homey.flow.getConditionCard('delivery_window_known').registerRunListener(async ({ device }) => Boolean(device && device.hasDeliveryWindowKnown()));
    this.homey.flow.getConditionCard('postnl_connected').registerRunListener(async ({ device }) => Boolean(device && device.isPostNLConnected()));
    this.homey.flow.getConditionCard('package_has_weight').registerRunListener(async ({ device }) => Boolean(device && device.currentPackageHasWeight()));
    this.homey.flow.getConditionCard('package_has_dimensions').registerRunListener(async ({ device }) => Boolean(device && device.currentPackageHasDimensions()));
    this.homey.flow.getConditionCard('package_status_is').registerRunListener(async ({ device, status }) => Boolean(device && device.currentPackageStatusIs(status)));
    this.homey.flow.getActionCard('sync_now').registerRunListener(async ({ device }) => {
      if (!device) throw new Error('No PostNL device selected.');
      await device.sync({ reason: 'flow', force: true });
      return true;
    });

    // Global Flow tags. Flow cards themselves remain device-specific.
    this._globalTokens = new Map();
  }

  _globalTokenDefinitions() {
    return {
      mail_expected: { type: 'boolean', en: 'Mail expected', nl: 'Post verwacht' },
      mail_count: { type: 'number', en: 'Mail items', nl: 'Poststukken' },
      mail_id: { type: 'string', en: 'Latest mail item ID', nl: 'Laatste poststuk-ID' },
      mail_title: { type: 'string', en: 'Latest mail item', nl: 'Laatste poststuk' },
      mail_sender: { type: 'string', en: 'Latest mail sender', nl: 'Afzender laatste poststuk' },
      mail_date: { type: 'string', en: 'Latest mail delivery date', nl: 'Bezorgdatum laatste poststuk' },
      mail_unread: { type: 'boolean', en: 'Latest mail unread', nl: 'Laatste poststuk ongelezen' },
      package_count: { type: 'number', en: 'Parcels underway', nl: 'Pakketten onderweg' },
      package_id: { type: 'string', en: 'Current parcel ID', nl: 'Huidig pakket-ID' },
      package_sender: { type: 'string', en: 'Parcel sender', nl: 'Afzender pakket' },
      package_receiver: { type: 'string', en: 'Parcel receiver', nl: 'Ontvanger pakket' },
      package_title: { type: 'string', en: 'Parcel', nl: 'Pakket' },
      package_barcode: { type: 'string', en: 'Parcel barcode', nl: 'Barcode pakket' },
      package_status: { type: 'string', en: 'Parcel status', nl: 'Pakketstatus' },
      package_status_raw: { type: 'string', en: 'Official PostNL status', nl: 'Officiële PostNL-status' },
      package_status_code: { type: 'string', en: 'Official PostNL status code', nl: 'Officiële PostNL-statuscode' },
      package_status_event: { type: 'string', en: 'Latest PostNL status event', nl: 'Laatste PostNL-statusgebeurtenis' },
      package_status_event_time: { type: 'string', en: 'Latest PostNL status time', nl: 'Tijdstip laatste PostNL-status' },
      package_delivery_date: { type: 'string', en: 'Parcel delivery date', nl: 'Bezorgdatum pakket' },
      package_delivery_window: { type: 'string', en: 'Parcel delivery window', nl: 'Bezorgvenster pakket' },
      package_delivery_window_from: { type: 'string', en: 'Parcel delivery window from', nl: 'Bezorgvenster pakket vanaf' },
      package_delivery_window_to: { type: 'string', en: 'Parcel delivery window to', nl: 'Bezorgvenster pakket tot' },
      package_delivery_window_type: { type: 'string', en: 'Parcel delivery window type', nl: 'Type bezorgvenster pakket' },
      package_details_url: { type: 'string', en: 'Parcel tracking URL', nl: 'Tracking-URL pakket' },
      package_shipment_type: { type: 'string', en: 'Parcel shipment type', nl: 'Zendingstype pakket' },
      package_delivery_address_type: { type: 'string', en: 'Parcel delivery address type', nl: 'Type bezorgadres pakket' },
      package_direction: { type: 'string', en: 'Parcel direction', nl: 'Richting pakket' },
      package_created_at: { type: 'string', en: 'Parcel created at', nl: 'Pakket aangemaakt op' },
      package_delivered: { type: 'boolean', en: 'Parcel delivered', nl: 'Pakket bezorgd' },
      package_shared_from: { type: 'string', en: 'Parcel shared from', nl: 'Pakket gedeeld via' },
      package_source_account_id: { type: 'string', en: 'Parcel source account ID', nl: 'Bronaccount-ID pakket' },
      package_tracking: { type: 'string', en: 'Parcel tracking number', nl: 'Trackingnummer pakket' },
      package_weight: { type: 'string', en: 'Parcel weight', nl: 'Gewicht pakket' },
      package_dimensions: { type: 'string', en: 'Parcel dimensions', nl: 'Afmetingen pakket' },
      next_delivery: { type: 'string', en: 'Next delivery', nl: 'Volgende bezorging' },
      connection_status: { type: 'string', en: 'PostNL connection status', nl: 'PostNL-verbindingsstatus' },
      last_update: { type: 'string', en: 'Last PostNL update', nl: 'Laatste PostNL-update' },
      old_status: { type: 'string', en: 'Previous parcel status', nl: 'Vorige pakketstatus' },
      last_error: { type: 'string', en: 'Last PostNL error', nl: 'Laatste PostNL-fout' },
      last_trigger: { type: 'string', en: 'Last PostNL trigger', nl: 'Laatste PostNL-trigger' },
      last_trigger_time: { type: 'string', en: 'Last PostNL trigger time', nl: 'Tijdstip laatste PostNL-trigger' },
    };
  }

  _globalTokenDeviceKey(device) {
    return crypto.createHash('sha1').update(String(device?.getData?.().id || device?.getId?.() || 'postnl')).digest('hex').slice(0, 10);
  }

  async ensureGlobalTokens(device) {
    const deviceKey = this._globalTokenDeviceKey(device);
    const language = this.homey.i18n.getLanguage() === 'nl' ? 'nl' : 'en';
    const deviceName = device?.getName?.() || (language === 'nl' ? 'Mijn PostNL' : 'My PostNL');
    if (!this._globalTokens) this._globalTokens = new Map();
    if (!this._globalTokens.has(deviceKey)) this._globalTokens.set(deviceKey, new Map());
    const set = this._globalTokens.get(deviceKey);
    for (const [name, definition] of Object.entries(this._globalTokenDefinitions())) {
      if (set.has(name)) continue;
      const id = `postnl_${deviceKey}_${name}`;
      const title = `${deviceName} · ${definition[language] || definition.en}`;
      let token;
      try { token = await this.homey.flow.createToken(id, { type: definition.type, title }); }
      catch (error) { try { token = await this.homey.flow.getToken(id); } catch (_) { throw error; } }
      if (token) set.set(name, token);
    }
    return set;
  }

  async updateGlobalTokens(device, values = {}) {
    const set = await this.ensureGlobalTokens(device);
    const definitions = this._globalTokenDefinitions();
    await Promise.all(Object.entries(values).map(async ([name, value]) => {
      const token = set.get(name); const definition = definitions[name]; if (!token || !definition) return;
      let safeValue = value;
      if (definition.type === 'boolean') safeValue = Boolean(value);
      else if (definition.type === 'number') safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
      else safeValue = value == null ? '' : String(value);
      await token.setValue(safeValue).catch(error => this.error('[GlobalToken]', name, error));
    }));
  }

  async updateGlobalEventTokens(cardId, device, tokens = {}) {
    const common = { last_trigger: String(cardId || ''), last_trigger_time: new Date().toISOString() };
    if (cardId === 'new_mail') Object.assign(common, { mail_count: tokens.count, mail_id: tokens.id, mail_title: tokens.title, mail_sender: tokens.sender, mail_date: tokens.date, mail_unread: tokens.unread });
    if (['new_package', 'delivery_window_known', 'package_status_changed', 'package_delivered', 'delivery_window_changed', 'package_event_changed', 'package_weight_known', 'package_dimensions_known'].includes(cardId)) Object.assign(common, { package_id: tokens.id, package_sender: tokens.sender, package_receiver: tokens.receiver, package_title: tokens.title, package_barcode: tokens.barcode, package_status: tokens.status, package_status_raw: tokens.status_raw, package_status_code: tokens.status_code, package_status_event: tokens.status_event, package_status_event_time: tokens.status_event_time, package_delivery_date: tokens.delivery_date, package_delivery_window: tokens.delivery_window, package_delivery_window_from: tokens.delivery_window_from, package_delivery_window_to: tokens.delivery_window_to, package_delivery_window_type: tokens.delivery_window_type, package_details_url: tokens.details_url, package_shipment_type: tokens.shipment_type, package_delivery_address_type: tokens.delivery_address_type, package_direction: tokens.direction, package_created_at: tokens.created_at, package_delivered: tokens.delivered, package_shared_from: tokens.shared_from, package_source_account_id: tokens.source_account_id, package_tracking: tokens.package_tracking || tokens.barcode || tokens.id, old_status: tokens.old_status });
    if (cardId === 'sync_failed') common.last_error = tokens.error;
    await this.updateGlobalTokens(device, common);
  }

  async triggerDeviceFlow(cardId, device, tokens = {}, state = {}) {
    const card = this._flowTriggers?.[cardId];
    if (!card) throw new Error(`PostNL Flow trigger not initialized: ${cardId}`);
    const safeTokens = Object.fromEntries(Object.entries(tokens || {}).filter(([, value]) => value !== undefined));
    try {
      this.log('[FlowTrigger]', cardId, device?.getName?.() || device?.getId?.() || 'unknown', JSON.stringify(
        Object.fromEntries(Object.entries(safeTokens).filter(([key]) => !['image', 'package_image'].includes(key)))
      ));
      await this.updateGlobalEventTokens(cardId, device, safeTokens).catch(error => this.error('[GlobalToken] event update failed', error));
      await card.trigger(device, safeTokens, state || {});
      this.log('[FlowTrigger]', cardId, 'accepted');
      return true;
    } catch (error) {
      this.error('[FlowTrigger]', cardId, 'failed', error);
      throw error;
    }
  }

  _createMemoryStorage() {
    const values = new Map();
    return { get: key => values.get(key), set: async (key, value) => values.set(key, value), unset: async key => values.delete(key) };
  }

  _createPairApi() {
    return new PostNLApi({ homey: this.homey, log: (...args) => this.log('[PairAuth]', ...args), storage: this._createMemoryStorage() });
  }

  _accountDevice(profile, api) {
    const username = String(profile?.username || '').trim();
    if (!username) throw new Error('PostNL did not return an account identifier.');
    const stable = crypto.createHash('sha256').update(username.toLowerCase()).digest('hex').slice(0, 24);
    return {
      name: this.homey.i18n.getLanguage() === 'nl' ? 'Mijn PostNL' : 'My PostNL',
      data: { id: `postnl-${stable}` },
      store: {
        username,
        auth: api.exportAuth(),
        snapshot: { letters: [], liveLetters: [], packages: [], updatedAt: null, account: profile || null, mailApiStatus: 'unknown', mailApiError: null },
      },
    };
  }

  async onPair(session) {
    const api = this._createPairApi();
    let profile = null;
    session.setHandler('start_auth', async () => api.createAuthorization());
    session.setHandler('complete_auth', async callback => {
      await api.completeAuthorization(callback);
      profile = await api.fetchProfile();
      return { authenticated: true, username: profile?.username || '', device: this._accountDevice(profile, api) };
    });
  }

  async onRepair(session, device) {
    const api = this._createPairApi();
    session.setHandler('start_auth', async () => api.createAuthorization());
    session.setHandler('complete_auth', async callback => {
      await api.completeAuthorization(callback);
      const profile = await api.fetchProfile();
      await device.updateCredentials(api.exportAuth(), profile);
      return { authenticated: true, username: profile?.username || '' };
    });
  }
}

module.exports = PostNLDriver;
