'use strict';

const Homey = require('homey');

class PostNLDevice extends Homey.Device {
  async onInit() {
    await this.applySnapshot(this.homey.app.snapshot, null);
  }

  async onAdded() {
    this.homey.app.sync({ reason: 'device-added', force: true }).catch(this.error);
  }

  async applySnapshot(snapshot = {}, error = null) {
    const letters = snapshot.letters || [];
    const packages = (snapshot.packages || []).filter(item => !item.delivered);
    const dates = [
      ...letters.map(item => item.deliveryDate),
      ...packages.map(item => item.deliveryDate),
    ].filter(Boolean).sort();
    const nextDelivery = dates[0] ? this.homey.app.api.formatDate(dates[0]) : '—';
    const updated = snapshot.updatedAt
      ? new Intl.DateTimeFormat('nl-NL', { timeZone: this.homey.clock.getTimezone(), dateStyle: 'short', timeStyle: 'short' }).format(new Date(snapshot.updatedAt))
      : '—';
    const values = {
      postnl_mail_expected: letters.length > 0,
      postnl_mail_count: letters.length,
      postnl_package_count: packages.length,
      postnl_next_delivery: nextDelivery,
      postnl_status: error
        ? `Fout: ${error.message}`
        : snapshot.mailApiStatus === 'temporarily_unavailable'
          ? 'Verbonden • Mijn Post tijdelijk niet beschikbaar'
          : (snapshot.updatedAt ? 'Verbonden' : 'Wachten op synchronisatie'),
      postnl_last_update: updated,
    };
    for (const [capability, value] of Object.entries(values)) {
      if (this.hasCapability(capability)) await this.setCapabilityValue(capability, value).catch(this.error);
    }
    if (error) await this.setUnavailable(error.message).catch(this.error);
    else await this.setAvailable().catch(this.error);
  }
}

module.exports = PostNLDevice;
