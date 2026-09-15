'use strict';

module.exports = {
  async sync({ homey }) {
    return homey.app.sync({ reason: 'settings', force: true });
  },
  async status({ homey }) {
    return homey.app.getWidgetData();
  },
};
