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
    this.snapshot = this.getStoreValue('snapshot') || { letters: [], liveLetters: [], packages: [], updatedAt: null };

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

    const previous = this.snapshot || { letters: [], liveLetters: [], packages: [] };
    try {
      const live = await this.api.fetchAll();
      const letters = await this.api.archiveLetters(live.letters, previous.letters || []);
      const archivedById = new Map(letters.map(item => [item.id, item]));
      // Keep a hydrated copy of only the items currently returned by PostNL.
      // Capabilities, device image and mail Flow tokens must never use archive-only items.
      const liveLetters = (live.letters || []).map(item => archivedById.get(item.id) || item);
      const current = {
        letters,
        liveLetters,
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
    // For upgrades from <=1.1.2, fall back to the old archive list once. This avoids
    // firing false "new mail" triggers for items that were already known before liveLetters existed.
    const previousLiveLetters = Array.isArray(previous.liveLetters) ? previous.liveLetters : (previous.letters || []);
    const todayKey = this._localDateKey();
    const currentLiveLetters = (current.liveLetters || []).filter(item => {
      const key = this._localDateKey(item.deliveryDate);
      return key && key >= todayKey;
    });
    const previousCurrentLetters = previousLiveLetters.filter(item => {
      const key = this._localDateKey(item.deliveryDate);
      return key && key >= todayKey;
    });
    const oldLetterIds = new Set(previousCurrentLetters.map(item => item.id));
    const newLetters = currentLiveLetters.filter(item => !oldLetterIds.has(item.id));
    const oldPackages = new Map((previous.packages || []).map(item => [item.id, item]));

    if (newLetters.length) {
      const newest = [...newLetters].sort((a, b) => new Date(b.deliveryDate || 0) - new Date(a.deliveryDate || 0))[0];
      await this.triggerNewMail(await this._mailTokens(newest, newLetters.length));
    }
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

  _localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.homey.clock.getTimezone(), year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  async applySnapshot(snapshot = {}, error = null) {
    // Only current PostNL mail drives device capabilities. The archive is widget-only.
    // Old snapshots do not have liveLetters; in that case wait for the first fresh sync
    // instead of exposing archived mail as current mail again.
    const letters = Array.isArray(snapshot.liveLetters) ? snapshot.liveLetters : [];
    const packages = (snapshot.packages || []).filter(item => !item.delivered);
    const todayKey = this._localDateKey();
    const currentMail = letters.filter(item => {
      const key = this._localDateKey(item.deliveryDate);
      return key && key >= todayKey;
    });
    const mailDates = currentMail.map(item => item.deliveryDate).filter(Boolean);
    const packageDates = packages.map(item => item.deliveryDate).filter(Boolean).filter(value => this._localDateKey(value) >= todayKey);
    const dates = [...mailDates, ...packageDates].sort((a, b) => new Date(a) - new Date(b));
    const nextDelivery = dates[0] ? this.api.formatDate(dates[0]) : '—';
    const updated = snapshot.updatedAt
      ? new Intl.DateTimeFormat(this.homey.i18n.getLanguage() === 'nl' ? 'nl-NL' : 'en-GB', { timeZone: this.homey.clock.getTimezone(), dateStyle: 'short', timeStyle: 'short' }).format(new Date(snapshot.updatedAt))
      : '—';
    const connected = this.api.hasCredentials();
    const lang = this.homey.i18n.getLanguage();
    const values = {
      postnl_mail_expected: currentMail.length > 0,
      postnl_mail_count: currentMail.length,
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

    const latestWithImage = [...currentMail]
      .sort((a, b) => new Date(b.deliveryDate || 0) - new Date(a.deliveryDate || 0))
      .find(item => item?.imageData);
    if (!latestWithImage) this._latestMailImageId = null;
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
      authenticated: this.api.hasCredentials(),
      // Widget deliberately receives the 21-day archive. Its API sorts newest first.
      letters: (this.snapshot.letters || []).slice(0, 60),
      packages: (this.snapshot.packages || []).slice(0, 40),
      updatedAt: this.snapshot.updatedAt || null, mailApiStatus: this.snapshot.mailApiStatus || 'unknown', mailApiError: this.snapshot.mailApiError || null,
    };
  }
}

module.exports = PostNLDevice;
