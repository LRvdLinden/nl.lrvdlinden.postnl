'use strict';

module.exports = {
  async sync({ homey }) {
    return homey.app.sync({ reason: 'settings', force: true });
  },
  async status({ homey }) {
    return homey.app.getWidgetData();
  },
  async authStatus({ homey }) {
    if (!homey.app.api.hasCredentials()) {
      return { authenticated: false, username: null, updatedAt: null };
    }
    let profile;
    try {
      profile = await homey.app.api.fetchProfile();
    } catch (error) {
      homey.app.error('PostNL login validation failed', error);
      return { authenticated: false, username: null, updatedAt: null };
    }
    return {
      authenticated: true,
      username: profile?.username || null,
      updatedAt: homey.settings.get('snapshot')?.updatedAt || null,
    };
  },
  async startAuth({ homey }) {
    return homey.app.api.createAuthorization();
  },
  async completeAuth({ homey, body }) {
    const callback = body?.callback;
    if (!callback) throw new Error('Plak eerst de callback-URL of autorisatiecode.');
    await homey.app.api.completeAuthorization(callback);
    const profile = await homey.app.api.fetchProfile();
    await homey.app.sync({ reason: 'settings-login', force: true }).catch(error => homey.app.error(error));
    return { authenticated: true, username: profile?.username || null };
  },
  async logout({ homey }) {
    await homey.app.api.logout();
    return { authenticated: false };
  },
};
