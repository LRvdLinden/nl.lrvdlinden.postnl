'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const PostNLApi = require('../../lib/postnl-api');

class PostNLDriver extends Homey.Driver {
  async onInit() {
    this.homey.flow.getConditionCard('mail_expected').registerRunListener(async ({ device }) => Boolean(device && device.isMailExpected()));
    this.homey.flow.getConditionCard('packages_underway').registerRunListener(async ({ device }) => Boolean(device && device.hasPackagesUnderway()));
    this.homey.flow.getActionCard('sync_now').registerRunListener(async ({ device }) => {
      if (!device) throw new Error('No PostNL device selected.');
      await device.sync({ reason: 'flow', force: true });
      return true;
    });
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
        snapshot: { letters: [], packages: [], updatedAt: null, account: profile || null, mailApiStatus: 'unknown', mailApiError: null },
        authExpiredNotified: false,
      },
    };
  }

  async onPair(session) {
    const api = this._createPairApi();
    session.setHandler('start_auth', async () => api.createAuthorization());
    session.setHandler('complete_auth', async callback => {
      await api.completeAuthorization(callback);
      const profile = await api.fetchProfile();
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
