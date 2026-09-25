'use strict';
const localizePackageStatus = require('../../lib/status-i18n');

function timestamp(item) {
  const value = item?.deliveryDate || item?.deliveryWindowFrom || item?.updatedAt || item?.createdAt || 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}
function selectedIds(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map(item => item.trim()).filter(Boolean);
}
function str(...values) {
  for (const value of values) {
    if (value === 0) return '0';
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}
function getSelectedDevice(homey, rawIds) {
  const ids = selectedIds(rawIds);
  const devices = homey.drivers.getDriver('account').getDevices();
  const id = ids[0] || String(rawIds || '').trim();
  const device = devices.find(item => item.getId() === id);
  if (!device) throw new Error('Select a PostNL device for this widget.');
  return device;
}

module.exports = {
  async getData({ homey, query }) {
    const device = getSelectedDevice(homey, query?.deviceIds || query?.deviceId);
    const data = device.getWidgetData();
    const packages = (data.packages || []).map(parcel => ({
      carrier: 'PostNL',
      carrierLogo: 'icon.svg',
      account: device.getName(),
      tracking: str(parcel.barcode, parcel.id),
      status: localizePackageStatus(homey, parcel.status || ''),
      sender: str(parcel.sender, parcel.title, parcel.sourceDisplayName),
      receiver: str(parcel.receiver),
      deliveryDate: str(parcel.deliveryDate, parcel.deliveryWindowFrom),
      deliveryWindow: str(parcel.deliveryWindow),
      deliveryWindowFrom: str(parcel.deliveryWindowFrom),
      deliveryWindowTo: str(parcel.deliveryWindowTo),
      updatedAt: str(parcel.updatedAt, parcel.createdAt),
      createdAt: str(parcel.createdAt),
      eventAt: str(parcel.lastEventAt, parcel.eventAt, parcel.delivered ? parcel.deliveryDate : '', parcel.updatedAt, parcel.createdAt),
      lastEventAt: str(parcel.lastEventAt, parcel.eventAt, parcel.delivered ? parcel.deliveryDate : '', parcel.updatedAt, parcel.createdAt),
      lastEvent: localizePackageStatus(homey, str(parcel.lastEvent, parcel.status)),
      shipmentType: str(parcel.shipmentType),
      deliveryAddressType: str(parcel.deliveryAddressType),
      direction: str(parcel.direction),
      sharedFrom: str(parcel.sourceDisplayName),
      sourceAccountId: str(parcel.sourceAccountId),
      title: str(parcel.title),
      detailsUrl: str(parcel.detailsUrl),
      delivered: Boolean(parcel.delivered),
    })).sort((a, b) => timestamp(b) - timestamp(a)).slice(0, 5);

    return {
      authenticated: data.authenticated,
      packages,
      selectedDeviceCount: 1,
      locale: homey.i18n.getLanguage(),
      timeZone: homey.clock.getTimezone(),
    };
  },

  async sync({ homey, body }) {
    const device = getSelectedDevice(homey, body?.deviceIds || body?.deviceId);
    await device.sync({ reason: 'widget', force: true });
    return { ok: true };
  },
};
