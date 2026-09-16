'use strict';

chrome.webRequest.onBeforeRedirect.addListener(
  details => {
    if (!details.redirectUrl.startsWith('postnl://login')) return;

    const helperUrl = `${chrome.runtime.getURL('callback.html')}#${encodeURIComponent(details.redirectUrl)}`;
    chrome.tabs.update(details.tabId, { url: helperUrl });
  },
  { urls: ['*://*.postnl.nl/*'] },
);
