'use strict';

const message = document.getElementById('message');
const callback = document.getElementById('callback');
const copy = document.getElementById('copy');

chrome.storage.local.get(['lastCallback', 'capturedAt']).then(result => {
  const valid = typeof result.lastCallback === 'string'
    && result.lastCallback.startsWith('postnl://login')
    && new URL(result.lastCallback).searchParams.has('code');
  if (!valid) {
    message.textContent = 'Nog geen callback ontvangen. Start de aanmelding via de PostNL App Settings in Homey.';
    callback.disabled = true;
    copy.disabled = true;
    return;
  }
  callback.value = result.lastCallback;
  message.textContent = `Callback ontvangen om ${new Date(result.capturedAt).toLocaleTimeString()}.`;
});

copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(callback.value);
  message.textContent = 'Gekopieerd. Plak de callback nu in Homey.';
});
