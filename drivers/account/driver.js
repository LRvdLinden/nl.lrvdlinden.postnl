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
      sync_failed: this.homey.flow.getDeviceTriggerCard('sync_failed'),
      login_expired: this.homey.flow.getDeviceTriggerCard('login_expired'),
    };

    this.homey.flow.getConditionCard('mail_expected').registerRunListener(async ({ device }) => Boolean(device && device.isMailExpected()));
    this.homey.flow.getConditionCard('packages_underway').registerRunListener(async ({ device }) => Boolean(device && device.hasPackagesUnderway()));
    this.homey.flow.getConditionCard('delivery_window_known').registerRunListener(async ({ device }) => Boolean(device && device.hasDeliveryWindowKnown()));
    this.homey.flow.getActionCard('sync_now').registerRunListener(async ({ device }) => {
      if (!device) throw new Error('No PostNL device selected.');
      await device.sync({ reason: 'flow', force: true });
      return true;
    });
  }

  async triggerDeviceFlow(cardId, device, tokens = {}, state = {}) {
    const card = this._flowTriggers?.[cardId];
    if (!card) throw new Error(`PostNL Flow trigger not initialized: ${cardId}`);
    const safeTokens = Object.fromEntries(Object.entries(tokens || {}).filter(([, value]) => value !== undefined));
    try {
      this.log('[FlowTrigger]', cardId, device?.getName?.() || device?.getId?.() || 'unknown', JSON.stringify(
        Object.fromEntries(Object.entries(safeTokens).filter(([key]) => !['image', 'package_image'].includes(key)))
      ));
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
