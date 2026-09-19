'use strict';

const Homey = require('homey');
const PostNLApi = require('./lib/postnl-api');

class PostNLApp extends Homey.App {
  async onInit() {
    this.api = new PostNLApi({ homey: this.homey, log: (...args) => this.log(...args) });
    this.snapshot = this.homey.settings.get('snapshot') || { letters: [], packages: [], updatedAt: null };
    this.syncing = null;
    this._letterImageCache = new Map();

    this._interval = this.homey.setInterval(() => this.sync({ reason: 'interval' }).catch(this.error), 5 * 60 * 1000);
    this._midnightInterval = this.homey.setInterval(() => this._midnightCheck(), 60 * 1000);

    if (this.api.hasCredentials()) {
      this.homey.setTimeout(() => this.sync({ reason: 'startup' }).catch(this.error), 10 * 1000);
    }
    this.log(`[PostNLApp] PostNL ${Homey.manifest.version} initialized`, JSON.stringify(this.api.getAuthDiagnostics()));
  }

  async onUninit() {
    if (this._interval) this.homey.clearInterval(this._interval);
    if (this._midnightInterval) this.homey.clearInterval(this._midnightInterval);
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
    if (!this.api.hasCredentials()) {
      if (!['interval', 'startup', 'midnight'].includes(reason)) {
        this.log('[PostNLApp] sync_skipped_not_authenticated', JSON.stringify({ reason, ...this.api.getAuthDiagnostics() }));
        throw new Error(this.homey.__('errors.not_authenticated'));
      }
      return this.snapshot;
    }
    this.log('[PostNLApp] sync_started', JSON.stringify({ reason, ...this.api.getAuthDiagnostics() }));
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
        mailApiError: live.mailApiError || null,
        reason,
      };
      this.snapshot = snapshot;
      this.log('[PostNLApp] sync_completed', JSON.stringify({ reason, letters: letters.length, packages: live.packages.length, mailApiStatus: snapshot.mailApiStatus, ...this.api.getAuthDiagnostics() }));
      await this.homey.settings.set('snapshot', snapshot);
      await this._triggerChanges(previous, snapshot);
      await this._updateDevices(snapshot, null);
      return snapshot;
    } catch (error) {
      this.error('[PostNLApp] sync_failed', JSON.stringify({ reason, ...this.api.safeErrorInfo(error), ...this.api.getAuthDiagnostics() }));
      const authError = error.statusCode === 401 || error.code === 'AUTH_EXPIRED';
      await this._updateDevices(previous, error);
      const devices = this.homey.drivers.getDriver('account').getDevices();
      for (const device of devices) {
        if (authError) await device.triggerLoginExpired().catch(this.error);
        await device.triggerSyncFailed(error.message).catch(this.error);
      }
      throw error;
    }
  }

  async getLetterImage(letter) {
    if (!letter?.imageData || !String(letter.imageData).startsWith('data:')) return null;
    const cacheKey = `${letter.id || 'mail'}:${letter.imageData.length}`;
    if (this._letterImageCache.has(cacheKey)) return this._letterImageCache.get(cacheKey);

    const match = String(letter.imageData).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return null;
    const contentType = match[1] || 'image/jpeg';
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) return null;

    const image = await this.homey.images.createImage();
    image.setStream(async stream => {
      stream.contentType = contentType;
      stream.filename = `postnl-${String(letter.id || 'mail').replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
      stream.end(buffer);
      return stream;
    });
    this._letterImageCache.set(cacheKey, image);

    if (this._letterImageCache.size > 25) {
      const first = this._letterImageCache.keys().next().value;
      this._letterImageCache.delete(first);
    }
    return image;
  }

  async _triggerChanges(previous, current) {
    const devices = this.homey.drivers.getDriver('account').getDevices();
    for (const device of devices) {
      await device.handleSnapshotChanges(previous, current).catch(error => {
        this.error('[PostNLApp] device_flow_dispatch_failed', JSON.stringify(this.api.safeErrorInfo(error)));
      });
    }
  }

  async _updateDevices(snapshot, error) {
    const devices = this.homey.drivers.getDriver('account').getDevices();
    for (const device of devices) await device.applySnapshot(snapshot, error);
  }

  getWidgetData() {
    return {
      letters: (this.snapshot.letters || []).slice(0, 20),
      packages: (this.snapshot.packages || []).slice(0, 40),
      updatedAt: this.snapshot.updatedAt,
      authenticated: this.api.hasCredentials(),
      mailApiStatus: this.snapshot.mailApiStatus || 'unknown',
      mailApiError: this.snapshot.mailApiError || null,
      deliveredPackageCount: (this.snapshot.packages || []).filter(item => item.delivered).length,
      activePackageCount: (this.snapshot.packages || []).filter(item => !item.delivered).length,
    };
  }
}

module.exports = PostNLApp;
