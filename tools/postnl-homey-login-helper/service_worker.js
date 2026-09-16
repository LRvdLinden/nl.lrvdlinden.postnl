'use strict';

function isCallback(url) {
  return typeof url === 'string' && url.startsWith('postnl://login') && /[?&]code=/.test(url);
}

async function captureCallback(url, tabId = -1) {
  if (!isCallback(url)) return false;

  await chrome.storage.local.set({
    lastCallback: url,
    capturedAt: Date.now(),
  });

  const helperUrl = `${chrome.runtime.getURL('callback.html')}#${encodeURIComponent(url)}`;
  try {
    if (tabId >= 0) await chrome.tabs.update(tabId, { url: helperUrl });
    else await chrome.tabs.create({ url: helperUrl });
  } catch (_) {
    await chrome.tabs.create({ url: helperUrl });
  }
  return true;
}

// Primary path: standard HTTP redirect from PostNL to the custom postnl:// scheme.
chrome.webRequest.onBeforeRedirect.addListener(
  details => { captureCallback(details.redirectUrl, details.tabId).catch(() => {}); },
  { urls: ['*://*.postnl.nl/*'] },
);

// Fallback: inspect the Location header before Chrome tries to navigate to the
// custom scheme. This also catches redirect variants that do not reach
// onBeforeRedirect consistently.
chrome.webRequest.onHeadersReceived.addListener(
  details => {
    const location = (details.responseHeaders || []).find(header => String(header.name || '').toLowerCase() === 'location');
    if (location?.value) captureCallback(location.value, details.tabId).catch(() => {});
  },
  { urls: ['*://*.postnl.nl/*'] },
  ['responseHeaders'],
);

// Additional navigation fallbacks. Depending on Chrome/platform the custom
// protocol may surface as a failed or pending navigation instead of a redirect.
chrome.webNavigation.onBeforeNavigate.addListener(details => {
  captureCallback(details.url, details.tabId).catch(() => {});
});

chrome.webNavigation.onErrorOccurred.addListener(details => {
  captureCallback(details.url, details.tabId).catch(() => {});
});
