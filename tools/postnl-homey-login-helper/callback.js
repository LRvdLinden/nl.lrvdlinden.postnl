'use strict';

const callback = document.getElementById('callback');
const copyButton = document.getElementById('copy');
const status = document.getElementById('status');

let value = '';
try {
  value = decodeURIComponent(location.hash.slice(1));
} catch (_) {
  value = '';
}

if (!value.startsWith('postnl://login') || !new URL(value).searchParams.get('code')) {
  callback.value = '';
  copyButton.disabled = true;
  status.textContent = 'Geen geldige PostNL-callback ontvangen. Start de aanmelding opnieuw vanuit Homey.';
} else {
  callback.value = value;
  callback.focus();
  callback.select();
}

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(callback.value);
    status.textContent = 'Gekopieerd. Plak de callback nu in Homey.';
  } catch (_) {
    callback.focus();
    callback.select();
    document.execCommand('copy');
    status.textContent = 'Gekopieerd. Plak de callback nu in Homey.';
  }
});
