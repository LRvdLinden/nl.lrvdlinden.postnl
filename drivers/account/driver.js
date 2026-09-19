'use strict';

const Homey = require('homey');

class PostNLDriver extends Homey.Driver {
  async onInit() {
    this.homey.flow.getConditionCard('mail_expected').registerRunListener(async args => {
      const device = args?.device;
      return Boolean(device && device.getCapabilityValue('postnl_mail_expected'));
    });

    this.homey.flow.getConditionCard('packages_underway').registerRunListener(async args => {
      const device = args?.device;
      return Boolean(device && Number(device.getCapabilityValue('postnl_package_count') || 0) > 0);
    });

    this.homey.flow.getActionCard('sync_now').registerRunListener(async args => {
      if (!args?.device) throw new Error('Geen PostNL-apparaat geselecteerd.');
      await this.homey.app.sync({ reason: 'flow', force: true });
      return true;
    });

    this.log('PostNL device Flow cards registered');
  }

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
