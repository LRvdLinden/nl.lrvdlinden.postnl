'use strict';

chrome.webRequest.onBeforeRedirect.addListener(
  async details => {
    if (!details.redirectUrl.includes('postnl://login')) return;

    await chrome.storage.local.set({
      lastCallback: details.redirectUrl,
      capturedAt: Date.now(),
    });
    const helperUrl = `${chrome.runtime.getURL('callback.html')}#${encodeURIComponent(details.redirectUrl)}`;
    if (details.tabId >= 0) {
      await chrome.tabs.update(details.tabId, { url: helperUrl });
    } else {
      await chrome.tabs.create({ url: helperUrl });
    }
  },
  { urls: ['<all_urls>'] },
);
