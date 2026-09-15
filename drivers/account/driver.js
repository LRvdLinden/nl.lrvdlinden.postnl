'use strict';

const Homey = require('homey');

class PostNLDriver extends Homey.Driver {
  async onPair(session) {
    session.setHandler('start_auth', async () => this.homey.app.api.createAuthorization());
    session.setHandler('complete_auth', async ({ callback }) => {
      await this.homey.app.api.completeAuthorization(callback);
      const profile = await this.homey.app.api.fetchProfile().catch(() => null);
      return { id: profile?.username || 'postnl-account', name: 'PostNL', profile };
    });
  }
}

module.exports = PostNLDriver;
