'use strict';

const Homey = require('homey');
const PostNLApi = require('./lib/postnl-api');

class PostNLApp extends Homey.App {
  async onInit() {
    this.api = new PostNLApi({ homey: this.homey, log: (...args) => this.log(...args) });
    this.snapshot = this.homey.settings.get('snapshot') || { letters: [], packages: [], updatedAt: null };
    this.syncing = null;
    this._letterImageCache = new Map();

    this._registerFlows();
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
        if (authError) await this.homey.flow.getTriggerCard('login_expired').trigger(device).catch(this.error);
        await this.homey.flow.getTriggerCard('sync_failed').trigger(device, { error: error.message }).catch(this.error);
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

    // Keep the cache bounded. PostNL itself only retains a short MyMail history.
    if (this._letterImageCache.size > 25) {
      const first = this._letterImageCache.keys().next().value;
      this._letterImageCache.delete(first);
    }
    return image;
  }

  _packageTokens(parcel) {
    return {
      id: parcel.id || '',
      sender: parcel.sender || '',
      receiver: parcel.receiver || '',
      title: parcel.title || parcel.sender || parcel.barcode || 'PostNL',
      barcode: parcel.barcode || '',
      status: parcel.status || '',
      delivery_date: parcel.deliveryDate ? this.api.formatDate(parcel.deliveryDate) : '',
      delivery_window: parcel.deliveryWindow || '',
      delivery_window_from: parcel.deliveryWindowFrom || '',
      delivery_window_to: parcel.deliveryWindowTo || '',
      delivery_window_type: parcel.deliveryWindowType || '',
      details_url: parcel.detailsUrl || '',
      shipment_type: parcel.shipmentType || '',
      delivery_address_type: parcel.deliveryAddressType || '',
      direction: parcel.direction || '',
      created_at: parcel.createdAt || '',
      delivered: Boolean(parcel.delivered),
      shared_from: parcel.sourceDisplayName || '',
      source_account_id: parcel.sourceAccountId || '',
    };
  }

  async _triggerChanges(previous, current) {
    const devices = this.homey.drivers.getDriver('account').getDevices();
    const oldLetterIds = new Set((previous.letters || []).map(item => item.id));
    const newLetters = current.letters.filter(item => !oldLetterIds.has(item.id));
    const oldPackages = new Map((previous.packages || []).map(item => [item.id, item]));

    for (const device of devices) {
      if (newLetters.length) {
        const newest = newLetters[0];
        const image = await this.getLetterImage(newest).catch(error => {
          this.error('[PostNLApp] image_token_failed', JSON.stringify(this.api.safeErrorInfo(error)));
          return null;
        });
        const tokens = {
          count: newLetters.length,
          id: newest.id || '',
          title: newest.title || '',
          sender: newest.sender || '',
          date: this.api.formatDate(newest.deliveryDate),
          unread: Boolean(newest.unread),
          image_available: Boolean(image),
        };
        if (image) tokens.image = image;
        await this.homey.flow.getTriggerCard('new_mail').trigger(device, tokens).catch(this.error);
      }

      for (const parcel of current.packages) {
        const old = oldPackages.get(parcel.id);
        const tokens = this._packageTokens(parcel);
        if (!old) {
          await this.homey.flow.getTriggerCard('new_package').trigger(device, tokens).catch(this.error);
        } else if (`${old.status}|${old.deliveryWindow}|${old.deliveryDate}` !== `${parcel.status}|${parcel.deliveryWindow}|${parcel.deliveryDate}`) {
          await this.homey.flow.getTriggerCard('package_status_changed').trigger(device, { ...tokens, old_status: old?.status || '' }).catch(this.error);
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
      letters: (this.snapshot.letters || []).slice(0, 20),
      // Keep recent delivered parcels available to the widget as well;
      // capabilities still count only active/in-transit parcels.
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
