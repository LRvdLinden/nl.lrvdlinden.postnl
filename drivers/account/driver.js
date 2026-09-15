'use strict';

const Homey = require('homey');

class PostNLDriver extends Homey.Driver {
  async onPair(session) {
    session.setHandler('is_authenticated', async () => {
      if (!this.homey.app.api.hasCredentials()) return { authenticated: false };
      try {
        await this.homey.app.api.fetchProfile();
        return { authenticated: true };
      } catch (error) {
        this.error('PostNL login validation failed', error);
        return { authenticated: false };
      }
    });
    session.setHandler('list_devices', async () => {
      if (!this.homey.app.api.hasCredentials()) {
        throw new Error('Log eerst in bij PostNL via Meer → Apps → PostNL → Instellingen.');
      }
      const profile = await this.homey.app.api.fetchProfile();
      const username = profile?.username || '';
      return [{
        name: this.homey.__('device.name'),
        data: { id: username || 'postnl-account' },
        store: { username },
      }];
    });
  }
}

module.exports = PostNLDriver;
