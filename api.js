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
      return { authenticated: false, username: null, updatedAt: null, ...homey.app.api.getAuthHealth() };
    }
    let profile;
    try {
      profile = await homey.app.api.fetchProfile();
    } catch (error) {
      homey.app.error('PostNL login validation failed', error);
      return { authenticated: false, username: null, updatedAt: null, ...homey.app.api.getAuthHealth(), validationError: error.message };
    }
    const snapshot = homey.settings.get('snapshot') || {};
    const packages = snapshot.packages || [];
    return {
      authenticated: true,
      username: profile?.username || null,
      updatedAt: snapshot.updatedAt || null,
      mailApiStatus: snapshot.mailApiStatus || 'unknown',
      mailApiError: snapshot.mailApiError || null,
      activePackageCount: packages.filter(item => !item.delivered).length,
      deliveredPackageCount: packages.filter(item => item.delivered).length,
      ...homey.app.api.getAuthHealth(),
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
    const snapshot = { letters: [], packages: [], updatedAt: null, account: null, mailApiStatus: 'unknown', mailApiError: null, reason: 'logout' };
    homey.app.snapshot = snapshot;
    await homey.settings.set('snapshot', snapshot);
    await homey.app._updateDevices(snapshot, null);
    return { authenticated: false };
  },
};
