'use strict';

const Homey = require('homey');

class PostNLDriver extends Homey.Driver {
  async onPair(session) {
    session.setHandler('is_authenticated', async () => ({
      authenticated: this.homey.app.api.hasCredentials(),
    }));
    session.setHandler('start_auth', async () => this.homey.app.api.createAuthorization());
    session.setHandler('complete_auth', async ({ callback }) => {
      await this.homey.app.api.completeAuthorization(callback);
      await this.homey.app.api.fetchProfile();
      return { authenticated: true };
    });
    session.setHandler('list_devices', async () => {
      if (!this.homey.app.api.hasCredentials()) {
        throw new Error('Log eerst in bij PostNL via Meer → Apps → PostNL → Instellingen.');
      }
      const profile = await this.homey.app.api.fetchProfile();
      const username = profile?.username || '';
      return [{
        name: username ? `PostNL (${username})` : 'PostNL',
        data: { id: username || 'postnl-account' },
        store: { username },
      }];
    });
  }
}

module.exports = PostNLDriver;
