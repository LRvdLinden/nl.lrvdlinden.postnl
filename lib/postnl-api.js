'use strict';

const crypto = require('crypto');

const CLIENT_ID = 'deb0a372-6d72-4e09-83fe-997beacbd137';
const TENANT = '101112a0-4a0f-4bbb-8176-2f1b2d370d7c';
const AUTH_URL = `https://login.postnl.nl/${TENANT}/login/authorize`;
const TOKEN_URL = `https://login.postnl.nl/${TENANT}/login/token`;
const REDIRECT_URI = 'postnl://login';
const SCOPE = 'profile openid email address phone poa-profiles-api';
const GRAPHQL_URL = 'https://jouw.postnl.nl/account/api/graphql';
const MYMAIL_URL = 'https://jouw.postnl.nl/services/serverdrivenui/api/MyMail/letter';

class PostNLApi {
  constructor({ homey, log, storage = null }) {
    this.homey = homey;
    this.log = log;
    this.storage = storage || homey.settings;
    this.auth = this.storage.get('auth') || null;
    this.mailApiStatus = 'unknown';
    this.mailApiError = null;
    // PostNL rotates/invalidates refresh tokens. Never allow concurrent refreshes.
    this._refreshPromise = null;
    this._safeAuthLog('initialized', this.getAuthDiagnostics());
  }

  hasCredentials() {
    return Boolean(this.auth?.accessToken || this.auth?.refreshToken);
  }

  getAuthDiagnostics() {
    const pending = this.storage.get('oauth_pending');
    const expiresAt = Number(this.auth?.expiresAt || 0);
    return {
      accessTokenPresent: Boolean(this.auth?.accessToken),
      refreshTokenPresent: Boolean(this.auth?.refreshToken),
      tokenTypePresent: Boolean(this.auth?.tokenType),
      expiresAtPresent: Boolean(expiresAt),
      accessTokenUsable: Boolean(this.auth?.accessToken && expiresAt && Date.now() < expiresAt),
      oauthPendingPresent: Boolean(pending),
      refreshInProgress: Boolean(this._refreshPromise),
    };
  }

  safeErrorInfo(error) {
    const raw = String(error?.message || error || 'Onbekende fout');
    const message = raw
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [REDACTED]')
      .replace(/postnl:\/\/login\?[^\s]+/gi, 'postnl://login?[REDACTED]')
      .replace(/((?:access|refresh|id)[_-]?token|authorization[_-]?code|code_verifier|state|callback)=([^&\s]+)/gi, '$1=[REDACTED]');
    return {
      name: error?.name || 'Error',
      code: error?.code || null,
      statusCode: Number.isFinite(Number(error?.statusCode)) ? Number(error.statusCode) : null,
      message,
    };
  }

  _safeAuthLog(event, details = {}) {
    const safe = {};
    for (const [key, value] of Object.entries(details || {})) {
      const sensitiveKey = /(accessToken|refreshToken|idToken|authorizationCode|state|verifier|callback)/i.test(key);
      if (sensitiveKey && typeof value !== 'boolean') {
        safe[`${key}Present`] = Boolean(value);
      } else {
        safe[key] = value;
      }
    }
    this.log('[PostNLAuth]', event, JSON.stringify(safe));
  }

  async createAuthorization() {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(20).toString('hex');
    await this.storage.set('oauth_pending', { verifier, state, createdAt: Date.now() });
    this._safeAuthLog('authorization_started', { oauthPendingPresent: true, ...this.getAuthDiagnostics() });
    const params = new URLSearchParams({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
      scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state,
    });
    return { url: `${AUTH_URL}?${params}`, state };
  }

  async completeAuthorization(value) {
    const pending = this.storage.get('oauth_pending');
    this._safeAuthLog('callback_received', { callbackPresent: Boolean(String(value || '').trim()), oauthPendingPresent: Boolean(pending) });
    if (!pending || Date.now() - pending.createdAt > 15 * 60 * 1000) throw new Error('De aanmeldpoging is verlopen. Start opnieuw.');
    let code = String(value || '').trim();
    let state = pending.state;
    try {
      const parsed = new URL(code);
      code = parsed.searchParams.get('code') || code;
      state = parsed.searchParams.get('state') || state;
    } catch (_) {
      const match = code.match(/[?&]code=([^&]+)/);
      if (match) code = decodeURIComponent(match[1]);
    }
    this._safeAuthLog('callback_validated', { authorizationCodePresent: Boolean(code), statePresent: Boolean(state), stateMatches: state === pending.state });
    if (!code) throw new Error('Geen geldige autorisatiecode gevonden.');
    if (state !== pending.state) throw new Error('De beveiligingscode van de aanmelding klopt niet.');
    const token = await this._tokenRequest({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: pending.verifier, client_id: CLIENT_ID,
    });
    await this._saveToken(token);
    this.storage.unset('oauth_pending');
    await this.fetchProfile();
    this._safeAuthLog('authorization_completed', this.getAuthDiagnostics());
    return true;
  }

  async setTokens({ accessToken, refreshToken, expiresIn = 3600 }) {
    this._safeAuthLog('external_credentials_received', { accessTokenPresent: Boolean(accessToken), refreshTokenPresent: Boolean(refreshToken) });
    await this._saveToken({ access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn });
    await this.fetchProfile();
  }

  async _saveToken(token) {
    const previousRefreshToken = this.auth?.refreshToken || null;
    const expiresInSeconds = Math.max(60, Number(token.expires_in || 3600) - 60);
    this.auth = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || this.auth?.refreshToken || null,
      expiresAt: Date.now() + expiresInSeconds * 1000,
      tokenType: token.token_type || 'Bearer',
    };
    await this.storage.set('auth', this.auth);
    this._safeAuthLog('credentials_saved', {
      accessTokenPresent: Boolean(this.auth.accessToken),
      refreshTokenPresent: Boolean(this.auth.refreshToken),
      refreshTokenRotated: Boolean(previousRefreshToken && token.refresh_token && previousRefreshToken !== token.refresh_token),
      expiresAtPresent: Boolean(this.auth.expiresAt),
      expiresInSeconds,
    });
  }

  async _tokenRequest(payload) {
    const grantType = String(payload?.grant_type || 'unknown');
    this._safeAuthLog('token_request_started', {
      grantType,
      authorizationCodePresent: Boolean(payload?.code),
      refreshTokenPresent: Boolean(payload?.refresh_token),
      verifierPresent: Boolean(payload?.code_verifier),
    });
    const response = await fetch(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(payload),
    });
    const data = await this._json(response);
    this._safeAuthLog('token_request_finished', {
      grantType,
      httpStatus: response.status,
      success: Boolean(response.ok && !data.error),
      accessTokenPresent: Boolean(data.access_token),
      refreshTokenPresent: Boolean(data.refresh_token),
      expiresInPresent: data.expires_in !== undefined && data.expires_in !== null,
    });
    if (!response.ok || data.error) throw this._error(response.status, data.error_description || data.error || 'Aanmelden bij PostNL is mislukt');
    return data;
  }

  async token(forceRefresh = false) {
    if (!this.auth) {
      this._safeAuthLog('token_unavailable', this.getAuthDiagnostics());
      throw this._error(401, 'PostNL is niet aangemeld', 'AUTH_EXPIRED');
    }
    if (!forceRefresh && this.auth.accessToken && Date.now() < Number(this.auth.expiresAt || 0)) return this.auth.accessToken;
    if (!this.auth.refreshToken) {
      this._safeAuthLog('refresh_unavailable', this.getAuthDiagnostics());
      throw this._error(401, 'PostNL-aanmelding is verlopen', 'AUTH_EXPIRED');
    }

    // IMPORTANT: PostNL can rotate/invalidate a refresh token after use. fetchAll()
    // performs several requests in parallel, so every caller must share one refresh.
    if (!this._refreshPromise) {
      const refreshToken = this.auth.refreshToken;
      this._safeAuthLog('refresh_started', this.getAuthDiagnostics());
      this._refreshPromise = (async () => {
        try {
          const token = await this._tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: CLIENT_ID,
          });
          await this._saveToken(token);
          this._safeAuthLog('refresh_succeeded', this.getAuthDiagnostics());
          return this.auth.accessToken;
        } catch (error) {
          const message = String(error?.message || '').toLowerCase();
          const invalidRefresh = error?.statusCode === 400 && (
            message.includes('refresh_token is invalid') ||
            message.includes('invalid_grant') ||
            message.includes('refresh token')
          );
          error.code = invalidRefresh ? 'AUTH_REAUTH_REQUIRED' : 'AUTH_EXPIRED';
          this._safeAuthLog('refresh_failed', { ...this.safeErrorInfo(error), ...this.getAuthDiagnostics() });
          throw error;
        } finally {
          this._refreshPromise = null;
        }
      })();
    }

    return this._refreshPromise;
  }

  exportAuth() {
    return this.auth ? { ...this.auth } : null;
  }

  async replaceAuth(auth) {
    this.auth = auth ? { ...auth } : null;
    if (this.auth) await this.storage.set('auth', this.auth);
    else await this.storage.unset('auth');
    this._safeAuthLog('credentials_replaced', this.getAuthDiagnostics());
  }

  headers(extra = {}) {
    return { Accept: 'application/json', ...extra };
  }

  async request(url, options = {}, retry = true, exactHeaders = false) {
    const token = await this.token();
    const headers = exactHeaders
      ? { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
      : this.headers({ Authorization: `Bearer ${token}`, ...(options.headers || {}) });
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401 && retry && this.auth?.refreshToken) {
      this._safeAuthLog('api_unauthorized_retry', { httpStatus: response.status, retry: Boolean(retry), refreshTokenPresent: Boolean(this.auth?.refreshToken) });
      if (this.auth.accessToken === token) await this.token(true);
      return this.request(url, options, false, exactHeaders);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw this._error(response.status, `PostNL API ${response.status}${text ? `: ${text.slice(0, 180)}` : ''}`);
    }
    return response;
  }

  async fetchProfile() {
    const query = 'query { profile { username __typename } }';
    const data = await this.graphql(query);
    return data.profile || null;
  }

  async graphql(query) {
    const response = await this.request(GRAPHQL_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    });
    const body = await this._json(response);
    if (body.errors?.length) throw this._error(400, body.errors[0].message || 'PostNL GraphQL-fout');
    return body.data || {};
  }

  async fetchAll() {
    const [account, letters, packages] = await Promise.all([
      this.fetchProfile().catch(() => null), this.fetchLetters(), this.fetchPackages(),
    ]);
    return { account, letters, packages, mailApiStatus: this.mailApiStatus, mailApiError: this.mailApiError };
  }


  myMailHeaders(extra = {}) {
    // Current PostNL MyMail service requires the same Android app-identification
    // headers used by the official app / current Home Assistant integration.
    return {
      'api-version': '1.37.0',
      'os-version': '35',
      'app-platform': 'Android',
      'app-version': '11.0.1',
      'content-type': 'application/json',
      'device-token': '00000000-0000-0000-0000-000000000000',
      ...extra,
    };
  }

  _parseLetterDate(title) {
    if (!title) return new Date().toISOString();
    const months = {
      januari: 0, februari: 1, maart: 2, april: 3, mei: 4, juni: 5,
      juli: 6, augustus: 7, september: 8, oktober: 9, november: 10, december: 11,
    };
    const parts = String(title).trim().toLowerCase().split(/\s+/);
    if (parts.length !== 2) return new Date().toISOString();
    const day = Number(parts[0]);
    const month = months[parts[1]];
    if (!Number.isInteger(day) || month === undefined) return new Date().toISOString();
    const now = new Date();
    let year = now.getFullYear();
    let candidate = new Date(Date.UTC(year, month, day, 12, 0, 0));
    if ((candidate.getTime() - now.getTime()) > 31 * 86400000) {
      year -= 1;
      candidate = new Date(Date.UTC(year, month, day, 12, 0, 0));
    }
    return candidate.toISOString();
  }

  async fetchLetters() {
    try {
      const response = await this.request(MYMAIL_URL, {
        method: 'GET',
        headers: this.myMailHeaders(),
      }, true, true);
      const payload = await this._json(response);
      const sections = payload?.screen?.sections || [];
      const letters = [];

      for (const section of sections) {
        for (const item of section?.items || []) {
          if (item?.type !== 'Letter') continue;
          const imageUrl = item?.image?.url || null;
          // The current MyMail payload does not normally expose a sender name.
          // Keep support for explicit sender fields in case PostNL adds them,
          // but never infer the sender from the scanned envelope image.
          const sender = [
            item?.senderName,
            item?.fromName,
            typeof item?.sender === 'string' ? item.sender : item?.sender?.name,
            typeof item?.from === 'string' ? item.from : item?.from?.name,
          ].find(value => typeof value === 'string' && value.trim()) || '';
          letters.push({
            id: item.editId || imageUrl || `${item.title || 'letter'}-${letters.length}`,
            barcode: item.editId || null,
            deliveryDate: this._parseLetterDate(item.title),
            status: item.isUnread ? 'Nieuw' : '',
            title: item.title || '',
            sender: sender.trim(),
            unread: Boolean(item.isUnread),
            imageUrl,
          });
        }
      }

      this.mailApiStatus = 'available';
      this.mailApiError = null;
      this.log(`PostNL Mijn PostNL: ${letters.length} poststuk(ken) ontvangen van server-driven UI`);
      return letters;
    } catch (error) {
      this.mailApiStatus = 'temporarily_unavailable';
      this.mailApiError = `HTTP ${error.statusCode || 'onbekend'}: ${error.message}`;
      this.log('PostNL Mijn PostNL request failed', this.mailApiError);
      // MyMail must not prevent parcel data from refreshing. The precise reason
      // is retained for device/widget diagnostics.
      return [];
    }
  }

  async archiveLetters(liveLetters, archivedLetters) {
    const merged = new Map((archivedLetters || []).map(item => [item.id, item]));
    for (const item of liveLetters) {
      const previous = merged.get(item.id) || {};
      const next = { ...previous, ...item, archivedAt: previous.archivedAt || new Date().toISOString() };
      if (item.imageUrl && !previous.imageData) {
        try { next.imageData = await this.fetchImage(item.imageUrl); } catch (error) { this.log('Image archive failed', item.id, error.message); }
      }
      merged.set(item.id, next);
    }
    const cutoff = Date.now() - 21 * 86400000;
    return [...merged.values()]
      .filter(item => new Date(item.deliveryDate || item.archivedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.deliveryDate) - new Date(a.deliveryDate))
      .slice(0, 60);
  }

  async fetchImage(url) {
    const response = await this.request(url, { headers: this.myMailHeaders() }, true, true);
    const type = response.headers.get('content-type') || 'image/png';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 750000) throw new Error('Afbeelding is te groot');
    return `data:${type};base64,${bytes.toString('base64')}`;
  }

  async fetchPackages() {
    const query = `query { trackedShipments { receiverShipments { key creationDateTime title barcode delivered deliveredTimeStamp deliveryWindowFrom deliveryWindowTo deliveryWindowType detailsUrl shipmentType receiverTitle deliveryAddressType sourceAccountId sourceDisplayName __typename } senderShipments { key creationDateTime title barcode delivered deliveredTimeStamp deliveryWindowFrom deliveryWindowTo deliveryWindowType detailsUrl shipmentType receiverTitle deliveryAddressType sourceAccountId sourceDisplayName __typename } __typename } }`;
    const data = await this.graphql(query);
    const incoming = (data.trackedShipments?.receiverShipments || []).map(item => this._mapPackage(item, 'incoming'));
    const outgoing = (data.trackedShipments?.senderShipments || []).map(item => this._mapPackage(item, 'outgoing'));
    return [...incoming, ...outgoing];
  }

  _mapPackage(item, direction) {
    const sender = String(item.title || item.sourceDisplayName || '').trim();
    const receiver = String(item.receiverTitle || '').trim();
    return {
      id: item.key || item.barcode,
      barcode: item.barcode || '',
      // The current PostNL GraphQL payload uses title for the webshop/sender.
      // sourceDisplayName is only a fallback and can represent a shared account.
      sender,
      receiver,
      title: sender || item.barcode || 'PostNL',
      delivered: Boolean(item.delivered),
      status: item.delivered
        ? 'Pakket is bezorgd'
        : (item.deliveryWindowFrom || item.deliveryWindowTo ? 'Pakket is onderweg' : 'Pakket is inkomend'),
      createdAt: item.creationDateTime || null,
      deliveryDate: item.deliveredTimeStamp || item.deliveryWindowFrom || null,
      deliveryWindowFrom: item.deliveryWindowFrom || null,
      deliveryWindowTo: item.deliveryWindowTo || null,
      deliveryWindow: this.formatWindow(item.deliveryWindowFrom, item.deliveryWindowTo),
      deliveryWindowType: item.deliveryWindowType || null,
      detailsUrl: item.detailsUrl || null,
      shipmentType: item.shipmentType || null,
      deliveryAddressType: item.deliveryAddressType || null,
      sourceAccountId: item.sourceAccountId || null,
      sourceDisplayName: item.sourceDisplayName || null,
      direction,
    };
  }

  formatDate(value) {
    if (!value) return '';
    const locale = this.homey.i18n.getLanguage() === 'nl' ? 'nl-NL' : 'en-GB';
    return new Intl.DateTimeFormat(locale, {
      timeZone: this.homey.clock.getTimezone(),
      day: 'numeric',
      month: 'long',
    }).format(new Date(value));
  }

  formatTime(value) {
    if (!value) return '';
    const locale = this.homey.i18n.getLanguage() === 'nl' ? 'nl-NL' : 'en-GB';
    return new Intl.DateTimeFormat(locale, {
      timeZone: this.homey.clock.getTimezone(),
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  }

  formatDateTime(value) {
    if (!value) return '';
    const locale = this.homey.i18n.getLanguage() === 'nl' ? 'nl-NL' : 'en-GB';
    return new Intl.DateTimeFormat(locale, {
      timeZone: this.homey.clock.getTimezone(),
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  }

  formatWindow(from, to) {
    if (!from) return '';
    const date = this.formatDate(from);
    if (!to) return date;
    return `${date}, ${this.formatTime(from)}–${this.formatTime(to)}`;
  }

  async logout() {
    this._safeAuthLog('logout_started', this.getAuthDiagnostics());
    this.auth = null;
    this.mailApiStatus = 'unknown';
    this.mailApiError = null;
    await this.storage.unset('auth');
    await this.storage.unset('oauth_pending');
    await this.storage.unset('api_version');
    await this.storage.unset('ios_version');
    await this.storage.unset('ios_version_checked_at');
    this._safeAuthLog('logout_completed', this.getAuthDiagnostics());
  }

  async _json(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch (_) { throw this._error(response.status, 'PostNL gaf geen geldige JSON terug'); }
  }

  _error(statusCode, message, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (code) error.code = code;
    return error;
  }
}

module.exports = PostNLApi;
