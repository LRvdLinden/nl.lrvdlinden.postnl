'use strict';

function timestamp(item) {
  const value = item?.deliveryDate || item?.deliveryWindowFrom || item?.createdAt || 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

module.exports = {
  async getData({ homey }) {
    const data = homey.app.getWidgetData();
    return {
      authenticated: data.authenticated,
      packages: [...(data.packages || [])]
        .sort((a, b) => timestamp(b) - timestamp(a))
        .slice(0, 5),
      locale: homey.i18n.getLanguage(),
      timeZone: homey.clock.getTimezone(),
    };
  },
  async sync({ homey }) {
    await homey.app.sync({ reason: 'widget', force: true });
    return { ok: true };
  },
};
