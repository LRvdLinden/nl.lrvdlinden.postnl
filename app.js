'use strict';

const Homey = require('homey');

class PostNLApp extends Homey.App {
  async onInit() {
    this._syncInterval = this.homey.setInterval(() => this.syncAllDevices('interval'), 5 * 60 * 1000);
    this._midnightInterval = this.homey.setInterval(() => this._midnightCheck(), 60 * 1000);

    this.homey.setTimeout(() => this._migrateLegacyAccount().catch(this.error), 3000);
    this.homey.setTimeout(() => this.syncAllDevices('startup'), 10000);
    this.log(`PostNL ${Homey.manifest.version} initialized in per-device account mode`);
  }

  async onUninit() {
    if (this._syncInterval) this.homey.clearInterval(this._syncInterval);
    if (this._midnightInterval) this.homey.clearInterval(this._midnightInterval);
  }

  getAccountDevices() {
    try { return this.homey.drivers.getDriver('account').getDevices(); }
    catch (_) { return []; }
  }

  async syncAllDevices(reason = 'manual') {
    const devices = this.getAccountDevices();
    await Promise.allSettled(devices.map(device => device.sync({ reason, force: reason !== 'interval' })));
  }

  async _midnightCheck() {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.homey.clock.getTimezone(), hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const [hour, minute] = formatter.format(new Date()).split(':').map(Number);
    if (hour === 0 && [1, 6, 11, 16, 21, 31, 46].includes(minute)) await this.syncAllDevices('midnight');
  }

  async _migrateLegacyAccount() {
    const auth = this.homey.settings.get('auth');
    const snapshot = this.homey.settings.get('snapshot');
    if (!auth) return;

    const devices = this.getAccountDevices();
    const target = devices.find(device => !device.hasAccountCredentials());
    if (!target) return;

    await target.importLegacyAccount(auth, snapshot || null);
    await this.homey.settings.unset('auth');
    await this.homey.settings.unset('oauth_pending');
    await this.homey.settings.unset('snapshot');
    this.log('[Migration] moved legacy app-level PostNL account to device storage');
  }
}

module.exports = PostNLApp;
