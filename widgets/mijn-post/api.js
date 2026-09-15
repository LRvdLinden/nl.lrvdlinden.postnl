'use strict';

module.exports = {
  async getData({ homey, query }) {
    const data = homey.app.getWidgetData();
    const maximumItems = Math.max(1, Math.min(6, Number(query?.maximumItems || 3)));
    const historyDays = Math.max(1, Math.min(14, Number(query?.historyDays || 1)));
    const cutoff = Date.now() - historyDays * 86400000;
    return {
      ...data,
      letters: data.letters
        .filter(item => new Date(item.deliveryDate || item.archivedAt || 0).getTime() >= cutoff)
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
