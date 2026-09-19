'use strict';

const Homey = require('homey');

class PostNLDevice extends Homey.Device {
  async onInit() {
    this._latestMailImageId = null;
    this._flowTriggerNewMail = this.homey.flow.getDeviceTriggerCard('new_mail');
    this._flowTriggerNewPackage = this.homey.flow.getDeviceTriggerCard('new_package');
    this._flowTriggerPackageStatusChanged = this.homey.flow.getDeviceTriggerCard('package_status_changed');
    this._flowTriggerSyncFailed = this.homey.flow.getDeviceTriggerCard('sync_failed');
    this._flowTriggerLoginExpired = this.homey.flow.getDeviceTriggerCard('login_expired');
    await this.applySnapshot(this.homey.app.snapshot, null);
  }

  async onAdded() {
    this.homey.app.sync({ reason: 'device-added', force: true }).catch(this.error);
  }

  async triggerNewMail(tokens = {}) {
    this.log('[Flow] new_mail', JSON.stringify({ count: Number(tokens.count || 0), imageAvailable: Boolean(tokens.image_available) }));
    return this._flowTriggerNewMail.trigger(this, tokens, {});
  }

  async triggerNewPackage(tokens = {}) {
    this.log('[Flow] new_package', JSON.stringify({ shipmentPresent: Boolean(tokens.id), senderPresent: Boolean(tokens.sender), statusPresent: Boolean(tokens.status) }));
    return this._flowTriggerNewPackage.trigger(this, tokens, {});
  }

  async triggerPackageStatusChanged(tokens = {}) {
    this.log('[Flow] package_status_changed', JSON.stringify({ shipmentPresent: Boolean(tokens.id), oldStatusPresent: Boolean(tokens.old_status), statusPresent: Boolean(tokens.status) }));
    return this._flowTriggerPackageStatusChanged.trigger(this, tokens, {});
  }

  async triggerSyncFailed(message = '') {
    this.log('[Flow] sync_failed');
    return this._flowTriggerSyncFailed.trigger(this, { error: String(message || '') }, {});
  }

  async triggerLoginExpired() {
    this.log('[Flow] login_expired');
    return this._flowTriggerLoginExpired.trigger(this, {}, {});
  }

  _packageTokens(parcel = {}) {
    return {
      id: parcel.id || '',
      sender: parcel.sender || '',
      receiver: parcel.receiver || '',
      title: parcel.title || parcel.sender || parcel.barcode || 'PostNL',
      barcode: parcel.barcode || '',
      status: parcel.status || '',
      delivery_date: parcel.deliveryDate ? this.homey.app.api.formatDate(parcel.deliveryDate) : '',
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

  async _mailTokens(letter = {}, count = 1) {
    const image = await this.homey.app.getLetterImage(letter).catch(error => {
      this.error('[Flow] image_token_failed', JSON.stringify(this.homey.app.api.safeErrorInfo(error)));
      return null;
    });
    const tokens = {
      count: Number(count || 0),
      id: letter.id || '',
      title: letter.title || '',
      sender: letter.sender || '',
      date: letter.deliveryDate ? this.homey.app.api.formatDate(letter.deliveryDate) : '',
      unread: Boolean(letter.unread),
      image_available: Boolean(image),
    };
    if (image) tokens.image = image;
    return tokens;
  }

  async handleSnapshotChanges(previous = {}, current = {}) {
    const oldLetterIds = new Set((previous.letters || []).map(item => item.id));
    const newLetters = (current.letters || []).filter(item => !oldLetterIds.has(item.id));
    const oldPackages = new Map((previous.packages || []).map(item => [item.id, item]));

    if (newLetters.length) {
      const tokens = await this._mailTokens(newLetters[0], newLetters.length);
      await this.triggerNewMail(tokens);
    }

    for (const parcel of current.packages || []) {
      const old = oldPackages.get(parcel.id);
      const tokens = this._packageTokens(parcel);
      if (!old) {
        await this.triggerNewPackage(tokens);
      } else if (`${old.status}|${old.deliveryWindow}|${old.deliveryDate}` !== `${parcel.status}|${parcel.deliveryWindow}|${parcel.deliveryDate}`) {
        await this.triggerPackageStatusChanged({ ...tokens, old_status: old.status || '' });
      }
    }
  }

  async applySnapshot(snapshot = {}, error = null) {
    const letters = snapshot.letters || [];
    const packages = (snapshot.packages || []).filter(item => !item.delivered);
    const dates = [...letters.map(item => item.deliveryDate), ...packages.map(item => item.deliveryDate)].filter(Boolean).sort();
    const nextDelivery = dates[0] ? this.homey.app.api.formatDate(dates[0]) : '—';
    const updated = snapshot.updatedAt
      ? new Intl.DateTimeFormat('nl-NL', { timeZone: this.homey.clock.getTimezone(), dateStyle: 'short', timeStyle: 'short' }).format(new Date(snapshot.updatedAt))
      : '—';
    const connected = this.homey.app.api.hasCredentials();
    const values = {
      postnl_mail_expected: letters.length > 0,
      postnl_mail_count: letters.length,
      postnl_package_count: packages.length,
      postnl_next_delivery: nextDelivery,
      postnl_status: !connected ? 'Niet verbonden' : error ? `Fout: ${error.message}` : snapshot.mailApiStatus === 'temporarily_unavailable'
        ? 'Verbonden • Mijn PostNL niet beschikbaar' : snapshot.mailApiStatus === 'available'
          ? 'Verbonden • Mijn PostNL actief' : (snapshot.updatedAt ? 'Verbonden' : 'Wachten op synchronisatie'),
      postnl_last_update: updated,
    };
    for (const [capability, value] of Object.entries(values)) {
      if (this.hasCapability(capability)) await this.setCapabilityValue(capability, value).catch(this.error);
    }

    const latestWithImage = letters.find(item => item?.imageData);
    if (latestWithImage && latestWithImage.id !== this._latestMailImageId) {
      try {
        const image = await this.homey.app.getLetterImage(latestWithImage);
        if (image) {
          const title = this.homey.i18n.getLanguage() === 'nl' ? 'Laatste poststuk' : 'Latest mail item';
          await this.setCameraImage('latest_mail_item', title, image);
          this._latestMailImageId = latestWithImage.id;
        }
      } catch (imageError) {
        this.error('Could not set latest My PostNL image', imageError);
      }
    }

    if (error) await this.setUnavailable(error.message).catch(this.error);
    else await this.setAvailable().catch(this.error);
  }
}

module.exports = PostNLDevice;
