'use strict';

const Homey = require('homey');
const PostNLApi = require('../../lib/postnl-api');

class PostNLDevice extends Homey.Device {
  async onInit() {
    this._latestMailImageId = null;
    this._letterImageCache = new Map();
    this._syncing = null;
    this._storage = {
      get: key => this.getStoreValue(key),
      set: (key, value) => this.setStoreValue(key, value),
      unset: key => this.unsetStoreValue(key),
    };
    this.api = new PostNLApi({ homey: this.homey, log: (...args) => this.log(...args), storage: this._storage });
    this.snapshot = this.getStoreValue('snapshot') || { letters: [], packages: [], updatedAt: null };

    this._flowTriggerNewMail = this.homey.flow.getDeviceTriggerCard('new_mail');
    this._flowTriggerNewPackage = this.homey.flow.getDeviceTriggerCard('new_package');
    this._flowTriggerPackageStatusChanged = this.homey.flow.getDeviceTriggerCard('package_status_changed');
    this._flowTriggerSyncFailed = this.homey.flow.getDeviceTriggerCard('sync_failed');
    this._flowTriggerLoginExpired = this.homey.flow.getDeviceTriggerCard('login_expired');

    await this.applySnapshot(this.snapshot, null);
    if (this.api.hasCredentials()) this.homey.setTimeout(() => this.sync({ reason: 'device-init' }).catch(this.error), 5000);
  }

  hasAccountCredentials() { return this.api?.hasCredentials() || Boolean(this.getStoreValue('auth')); }

  async importLegacyAccount(auth, snapshot) {
    await this.api.replaceAuth(auth);
    if (snapshot) {
      this.snapshot = snapshot;
      await this.setStoreValue('snapshot', snapshot);
    }
    await this.setStoreValue('authExpiredNotified', false);
    await this.applySnapshot(this.snapshot, null);
  }

  async updateCredentials(auth, profile = null) {
    await this.api.replaceAuth(auth);
    if (profile?.username) await this.setStoreValue('username', profile.username);
    await this.setStoreValue('authExpiredNotified', false);
    await this.setAvailable().catch(this.error);
    return this.sync({ reason: 'repair-login', force: true });
  }

  async sync({ reason = 'manual', force = false } = {}) {
    if (this._syncing) return this._syncing;
    this._syncing = this._sync({ reason, force }).finally(() => { this._syncing = null; });
    return this._syncing;
  }

  async _sync({ reason }) {
    if (!this.api.hasCredentials()) {
      const error = new Error(this.homey.__('errors.not_authenticated'));
      error.code = 'AUTH_REAUTH_REQUIRED';
      if (!['interval', 'startup', 'device-init', 'midnight'].includes(reason)) throw error;
      return this.snapshot;
    }

    const previous = this.snapshot || { letters: [], packages: [] };
    try {
      const live = await this.api.fetchAll();
      const letters = await this.api.archiveLetters(live.letters, previous.letters || []);
      const current = {
        letters,
        packages: live.packages,
        updatedAt: new Date().toISOString(),
        account: live.account || null,
        mailApiStatus: live.mailApiStatus || 'unknown',
        mailApiError: live.mailApiError || null,
        reason,
      };
      this.snapshot = current;
      await this.setStoreValue('snapshot', current);
      await this.handleSnapshotChanges(previous, current);
      await this.applySnapshot(current, null);
      await this.setStoreValue('authExpiredNotified', false);
      return current;
    } catch (error) {
      const authExpired = error?.code === 'AUTH_REAUTH_REQUIRED' || error?.code === 'AUTH_EXPIRED' || error?.statusCode === 401;
      this.error('[PostNLDevice] sync_failed', JSON.stringify({ reason, ...this.api.safeErrorInfo(error), ...this.api.getAuthDiagnostics() }));
      if (authExpired) {
        const alreadyNotified = this.getStoreValue('authExpiredNotified') === true;
        if (!alreadyNotified) {
          await this.triggerLoginExpired().catch(this.error);
          await this._notifyAuthExpiredOnce().catch(this.error);
        }
      }
      await this.triggerSyncFailed(error.message).catch(this.error);
      await this.applySnapshot(previous, error);
      throw error;
    }
  }

  async _notifyAuthExpiredOnce() {
    if (this.getStoreValue('authExpiredNotified') === true) return;
    const language = this.homey.i18n.getLanguage();
    const excerpt = language === 'nl'
      ? `PostNL opnieuw koppelen – De inloggegevens van ${this.getName()} zijn verlopen. Open het betreffende apparaat en koppel je PostNL-account opnieuw.`
      : `Reconnect PostNL – The credentials for ${this.getName()} have expired. Open the affected device and reconnect your PostNL account.`;
    await this.homey.notifications.createNotification({ excerpt });
    await this.setStoreValue('authExpiredNotified', true);
  }

  async triggerNewMail(tokens = {}) { return this._flowTriggerNewMail.trigger(this, tokens, {}); }
  async triggerNewPackage(tokens = {}) { return this._flowTriggerNewPackage.trigger(this, tokens, {}); }
  async triggerPackageStatusChanged(tokens = {}) { return this._flowTriggerPackageStatusChanged.trigger(this, tokens, {}); }
  async triggerSyncFailed(message = '') { return this._flowTriggerSyncFailed.trigger(this, { error: String(message || '') }, {}); }
  async triggerLoginExpired() { return this._flowTriggerLoginExpired.trigger(this, {}, {}); }

  _packageTokens(parcel = {}) {
    return {
      id: parcel.id || '', sender: parcel.sender || '', receiver: parcel.receiver || '',
      title: parcel.title || parcel.sender || parcel.barcode || 'PostNL', barcode: parcel.barcode || '', status: parcel.status || '',
      delivery_date: parcel.deliveryDate ? this.api.formatDate(parcel.deliveryDate) : '', delivery_window: parcel.deliveryWindow || '',
      delivery_window_from: parcel.deliveryWindowFrom ? this.api.formatTime(parcel.deliveryWindowFrom) : '',
      delivery_window_to: parcel.deliveryWindowTo ? this.api.formatTime(parcel.deliveryWindowTo) : '',
      delivery_window_type: parcel.deliveryWindowType || '', details_url: parcel.detailsUrl || '', shipment_type: parcel.shipmentType || '',
      delivery_address_type: parcel.deliveryAddressType || '', direction: parcel.direction || '',
      created_at: parcel.createdAt ? this.api.formatDateTime(parcel.createdAt) : '',
      delivered: Boolean(parcel.delivered), shared_from: parcel.sourceDisplayName || '', source_account_id: parcel.sourceAccountId || '',
    };
  }

  async _mailTokens(letter = {}, count = 1) {
    const image = await this.getLetterImage(letter).catch(() => null);
    const tokens = {
      count: Number(count || 0), id: letter.id || '', title: letter.title || '', sender: letter.sender || '',
      date: letter.deliveryDate ? this.api.formatDate(letter.deliveryDate) : '', unread: Boolean(letter.unread), image_available: Boolean(image),
    };
    if (image) tokens.image = image;
    return tokens;
  }

  async handleSnapshotChanges(previous = {}, current = {}) {
    const oldLetterIds = new Set((previous.letters || []).map(item => item.id));
    const newLetters = (current.letters || []).filter(item => !oldLetterIds.has(item.id));
    const oldPackages = new Map((previous.packages || []).map(item => [item.id, item]));

    if (newLetters.length) await this.triggerNewMail(await this._mailTokens(newLetters[0], newLetters.length));
    for (const parcel of current.packages || []) {
      const old = oldPackages.get(parcel.id);
      const tokens = this._packageTokens(parcel);
      if (!old) await this.triggerNewPackage(tokens);
      else if (`${old.status}|${old.deliveryWindow}|${old.deliveryDate}` !== `${parcel.status}|${parcel.deliveryWindow}|${parcel.deliveryDate}`) {
        await this.triggerPackageStatusChanged({ ...tokens, old_status: old.status || '' });
      }
    }
  }

  async getLetterImage(letter) {
    if (!letter?.imageData || !String(letter.imageData).startsWith('data:')) return null;
    const cacheKey = `${letter.id || 'mail'}:${letter.imageData.length}`;
    if (this._letterImageCache.has(cacheKey)) return this._letterImageCache.get(cacheKey);
    const match = String(letter.imageData).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return null;
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) return null;
    const image = await this.homey.images.createImage();
    image.setStream(async stream => {
      stream.contentType = match[1] || 'image/jpeg';
      stream.filename = `postnl-${String(letter.id || 'mail').replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
      stream.end(buffer);
      return stream;
    });
    this._letterImageCache.set(cacheKey, image);
    if (this._letterImageCache.size > 25) this._letterImageCache.delete(this._letterImageCache.keys().next().value);
    return image;
  }

  async applySnapshot(snapshot = {}, error = null) {
    const letters = snapshot.letters || [];
    const packages = (snapshot.packages || []).filter(item => !item.delivered);
    const dates = [...letters.map(item => item.deliveryDate), ...packages.map(item => item.deliveryDate)].filter(Boolean).sort();
    const nextDelivery = dates[0] ? this.api.formatDate(dates[0]) : '—';
    const updated = snapshot.updatedAt
      ? new Intl.DateTimeFormat(this.homey.i18n.getLanguage() === 'nl' ? 'nl-NL' : 'en-GB', { timeZone: this.homey.clock.getTimezone(), dateStyle: 'short', timeStyle: 'short' }).format(new Date(snapshot.updatedAt))
      : '—';
    const connected = this.api.hasCredentials();
    const lang = this.homey.i18n.getLanguage();
    const values = {
      postnl_mail_expected: letters.length > 0,
      postnl_mail_count: letters.length,
      postnl_package_count: packages.length,
      postnl_next_delivery: nextDelivery,
      postnl_status: !connected ? (lang === 'nl' ? 'Niet verbonden' : 'Not connected')
        : error ? `${lang === 'nl' ? 'Fout' : 'Error'}: ${error.message}`
          : snapshot.mailApiStatus === 'temporarily_unavailable' ? (lang === 'nl' ? 'Verbonden • Mijn PostNL niet beschikbaar' : 'Connected • My PostNL unavailable')
            : snapshot.mailApiStatus === 'available' ? (lang === 'nl' ? 'Verbonden • Mijn PostNL actief' : 'Connected • My PostNL active')
              : (snapshot.updatedAt ? (lang === 'nl' ? 'Verbonden' : 'Connected') : (lang === 'nl' ? 'Wachten op synchronisatie' : 'Waiting for sync')),
      postnl_last_update: updated,
    };
    for (const [capability, value] of Object.entries(values)) if (this.hasCapability(capability)) await this.setCapabilityValue(capability, value).catch(this.error);

    const latestWithImage = letters.find(item => item?.imageData);
    if (latestWithImage && latestWithImage.id !== this._latestMailImageId) {
      const image = await this.getLetterImage(latestWithImage).catch(() => null);
      if (image) {
        await this.setCameraImage('latest_mail_item', lang === 'nl' ? 'Laatste poststuk' : 'Latest mail item', image);
        this._latestMailImageId = latestWithImage.id;
      }
    }
    if (error) await this.setUnavailable(error.message).catch(this.error);
    else await this.setAvailable().catch(this.error);
  }

  isMailExpected() { return Boolean(this.getCapabilityValue('postnl_mail_expected')); }
  hasPackagesUnderway() { return Number(this.getCapabilityValue('postnl_package_count') || 0) > 0; }

  getWidgetData() {
    return {
      authenticated: this.api.hasCredentials(), letters: (this.snapshot.letters || []).slice(0, 20), packages: (this.snapshot.packages || []).slice(0, 40),
      updatedAt: this.snapshot.updatedAt || null, mailApiStatus: this.snapshot.mailApiStatus || 'unknown', mailApiError: this.snapshot.mailApiError || null,
    };
  }
}

module.exports = PostNLDevice;
