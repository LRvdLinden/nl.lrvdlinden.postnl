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

function maskCallback(raw) {
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const code = parsed.searchParams.get('code') || '';
    return code ? `postnl://login?code=${'•'.repeat(12)}&state=${'•'.repeat(8)}` : 'Beveiligde callback ontvangen';
  } catch (_) {
    return 'Beveiligde callback ontvangen';
  }
}

async function initialise() {
  if (!value) {
    const stored = await chrome.storage.local.get(['lastCallback']);
    value = stored.lastCallback || '';
  }

  if (!value.startsWith('postnl://login') || !new URL(value).searchParams.get('code')) {
    callback.value = '';
    copyButton.disabled = true;
    status.textContent = 'Geen geldige PostNL-callback ontvangen. Start de aanmelding opnieuw vanuit Homey.';
    return;
  }

  callback.value = maskCallback(value);
  status.textContent = 'Callback veilig ontvangen. De inhoud is verborgen.';
}

initialise().catch(() => {
  callback.value = '';
  copyButton.disabled = true;
  status.textContent = 'De opgeslagen callback kon niet worden gelezen.';
});

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(value);
    status.textContent = 'Gekopieerd. Plak de callback nu in Homey.';
  } catch (_) {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
    status.textContent = 'Gekopieerd. Plak de callback nu in Homey.';
  }
});
