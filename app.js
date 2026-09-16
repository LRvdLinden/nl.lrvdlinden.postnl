'use strict';

const Homey = require('homey');
const PostNLApi = require('./lib/postnl-api');

class PostNLApp extends Homey.App {
  async onInit() {
    this.api = new PostNLApi({ homey: this.homey, log: (...args) => this.log(...args) });
    this.snapshot = this.homey.settings.get('snapshot') || { letters: [], packages: [], updatedAt: null };
    this.syncing = null;

    this._registerFlows();
    this._interval = this.homey.setInterval(() => this.sync({ reason: 'interval' }).catch(this.error), 5 * 60 * 1000);
    this._midnightInterval = this.homey.setInterval(() => this._midnightCheck(), 60 * 1000);

    if (this.api.hasCredentials()) {
      this.homey.setTimeout(() => this.sync({ reason: 'startup' }).catch(this.error), 10 * 1000);
    }
    this.log(`PostNL ${Homey.manifest.version} initialized`);
  }

  async onUninit() {
    if (this._interval) this.homey.clearInterval(this._interval);
    if (this._midnightInterval) this.homey.clearInterval(this._midnightInterval);
  }

  _registerFlows() {
    this.homey.flow.getActionCard('sync_now').registerRunListener(async () => {
      await this.sync({ reason: 'flow', force: true });
      return true;
    });
    this.homey.flow.getConditionCard('mail_expected').registerRunListener(async () => this.snapshot.letters.length > 0);
    this.homey.flow.getConditionCard('packages_underway').registerRunListener(async () => this.snapshot.packages.some(p => !p.delivered));
  }

  async _midnightCheck() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.homey.clock.getTimezone(), hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const [hour, minute] = formatter.format(now).split(':').map(Number);
    if (hour === 0 && [1, 6, 11, 16, 21, 31, 46].includes(minute)) {
      await this.sync({ reason: 'midnight', force: true }).catch(this.error);
    }
  }

  async sync({ reason = 'manual', force = false } = {}) {
    if (this.syncing) return this.syncing;
    this.syncing = this._sync({ reason, force }).finally(() => { this.syncing = null; });
    return this.syncing;
  }

  async _sync({ reason }) {
    if (!this.api.hasCredentials()) throw new Error(this.homey.__('errors.not_authenticated'));
    const previous = this.snapshot || { letters: [], packages: [] };
    try {
      const live = await this.api.fetchAll();
      const letters = await this.api.archiveLetters(live.letters, previous.letters || []);
      const snapshot = {
        letters,
        packages: live.packages,
        updatedAt: new Date().toISOString(),
        account: live.account || null,
        mailApiStatus: live.mailApiStatus || 'unknown',
        reason,
      };
      this.snapshot = snapshot;
      await this.homey.settings.set('snapshot', snapshot);
      await this._triggerChanges(previous, snapshot);
      await this._updateDevices(snapshot, null);
      return snapshot;
    } catch (error) {
      this.error('PostNL sync failed', error);
      const authError = error.statusCode === 401 || error.code === 'AUTH_EXPIRED';
      await this._updateDevices(previous, error);
      const devices = this.homey.drivers.getDriver('account').getDevices();
      for (const device of devices) {
        if (authError) await this.homey.flow.getTriggerCard('login_expired').trigger(device).catch(this.error);
        await this.homey.flow.getTriggerCard('sync_failed').trigger(device, { error: error.message }).catch(this.error);
      }
      throw error;
    }
  }

  async _triggerChanges(previous, current) {
    const devices = this.homey.drivers.getDriver('account').getDevices();
    const oldLetterIds = new Set((previous.letters || []).map(item => item.id));
    const newLetters = current.letters.filter(item => !oldLetterIds.has(item.id));
    const oldPackages = new Map((previous.packages || []).map(item => [item.id, item]));

    for (const device of devices) {
      if (newLetters.length) {
        await this.homey.flow.getTriggerCard('new_mail').trigger(device, {
          count: newLetters.length,
          date: this.api.formatDate(newLetters[0].deliveryDate),
        }).catch(this.error);
      }
      for (const parcel of current.packages) {
        const old = oldPackages.get(parcel.id);
        const tokens = { title: parcel.title || parcel.barcode || 'PostNL', status: parcel.status || '', delivery_window: parcel.deliveryWindow || '' };
        if (!old) await this.homey.flow.getTriggerCard('new_package').trigger(device, tokens).catch(this.error);
        else if (`${old.status}|${old.deliveryWindow}` !== `${parcel.status}|${parcel.deliveryWindow}`) {
          await this.homey.flow.getTriggerCard('package_status_changed').trigger(device, tokens).catch(this.error);
        }
      }
    }
  }

  async _updateDevices(snapshot, error) {
    const devices = this.homey.drivers.getDriver('account').getDevices();
    for (const device of devices) await device.applySnapshot(snapshot, error);
  }

  getWidgetData() {
    return {
      letters: (this.snapshot.letters || []).slice(0, 12),
      packages: (this.snapshot.packages || []).filter(item => !item.delivered),
      updatedAt: this.snapshot.updatedAt,
      authenticated: this.api.hasCredentials(),
      mailApiStatus: this.snapshot.mailApiStatus || 'unknown',
    };
  }
}

module.exports = PostNLApp;
