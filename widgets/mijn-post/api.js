'use strict';

function timestamp(item) {
  const value = item?.deliveryDate || item?.deliveryWindowFrom || item?.createdAt || item?.archivedAt || 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

module.exports = {
  async getData({ homey, query }) {
    const data = homey.app.getWidgetData();
    const maximumItems = Math.max(1, Math.min(5, Number(query?.maximumItems || 5)));
    return {
      ...data,
      letters: [...(data.letters || [])]
        .sort((a, b) => timestamp(b) - timestamp(a))
        .slice(0, maximumItems),
      packages: [...(data.packages || [])]
        .sort((a, b) => timestamp(b) - timestamp(a))
        .slice(0, maximumItems),
      locale: homey.i18n.getLanguage(),
      timeZone: homey.clock.getTimezone(),
    };
  },
  async sync({ homey }) {
    await homey.app.sync({ reason: 'widget', force: true });
    return homey.app.getWidgetData();
  },
};
