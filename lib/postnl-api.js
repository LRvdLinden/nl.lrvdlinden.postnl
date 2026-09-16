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
  constructor({ homey, log }) {
    this.homey = homey;
    this.log = log;
    this.auth = homey.settings.get('auth') || null;
    this.mailApiStatus = 'unknown';
    // PostNL rotates/invalidates refresh tokens. Never allow concurrent refreshes.
    this._refreshPromise = null;
  }

  hasCredentials() {
    return Boolean(this.auth?.accessToken || this.auth?.refreshToken);
  }

  createAuthorization() {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(20).toString('hex');
    this.homey.settings.set('oauth_pending', { verifier, state, createdAt: Date.now() });
    const params = new URLSearchParams({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
      scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state,
    });
    return { url: `${AUTH_URL}?${params}`, state };
  }

  async completeAuthorization(value) {
    const pending = this.homey.settings.get('oauth_pending');
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
    if (!code) throw new Error('Geen geldige autorisatiecode gevonden.');
    if (state !== pending.state) throw new Error('De beveiligingscode van de aanmelding klopt niet.');
    const token = await this._tokenRequest({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: pending.verifier, client_id: CLIENT_ID,
    });
    await this._saveToken(token);
    this.homey.settings.unset('oauth_pending');
    await this.fetchProfile();
    return true;
  }

  async setTokens({ accessToken, refreshToken, expiresIn = 3600 }) {
    await this._saveToken({ access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn });
    await this.fetchProfile();
  }

  async _saveToken(token) {
    this.auth = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || this.auth?.refreshToken || null,
      expiresAt: Date.now() + Math.max(60, Number(token.expires_in || 3600) - 60) * 1000,
      tokenType: token.token_type || 'Bearer',
    };
    await this.homey.settings.set('auth', this.auth);
  }

  async _tokenRequest(payload) {
    const response = await fetch(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(payload),
    });
    const data = await this._json(response);
    if (!response.ok || data.error) throw this._error(response.status, data.error_description || data.error || 'Aanmelden bij PostNL is mislukt');
    return data;
  }

  async token(forceRefresh = false) {
    if (!this.auth) throw this._error(401, 'PostNL is niet aangemeld', 'AUTH_EXPIRED');
    if (!forceRefresh && this.auth.accessToken && Date.now() < Number(this.auth.expiresAt || 0)) return this.auth.accessToken;
    if (!this.auth.refreshToken) throw this._error(401, 'PostNL-aanmelding is verlopen', 'AUTH_EXPIRED');

    if (!this._refreshPromise) {
      const refreshToken = this.auth.refreshToken;
      this._refreshPromise = (async () => {
        try {
          const token = await this._tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: CLIENT_ID,
          });
          await this._saveToken(token);
          return this.auth.accessToken;
        } catch (error) {
          const message = String(error?.message || '').toLowerCase();
          const invalidRefresh = error?.statusCode === 400 && (
            message.includes('refresh_token is invalid') ||
            message.includes('invalid_grant') ||
            message.includes('refresh token')
          );
          error.code = invalidRefresh ? 'AUTH_REAUTH_REQUIRED' : 'AUTH_EXPIRED';
          throw error;
        } finally {
          this._refreshPromise = null;
        }
      })();
    }

    return this._refreshPromise;
  }

  headers(extra = {}) {
    const apiVersion = this.homey.settings.get('api_version') || '4.18';
    const appVersion = this.homey.settings.get('ios_version') || '7.1.0';
    return { Accept: 'application/json', 'Api-Version': apiVersion, 'User-Agent': `PostNL/iOS/${appVersion}`, ...extra };
  }

  async request(url, options = {}, retry = true) {
    const token = await this.token();
    const response = await fetch(url, { ...options, headers: this.headers({ Authorization: `Bearer ${token}`, ...(options.headers || {}) }) });
    if (response.status === 401 && retry && this.auth?.refreshToken) {
      if (this.auth.accessToken === token) await this.token(true);
      return this.request(url, options, false);
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
    await this.refreshIosVersion().catch(error => this.log('iOS version check failed', error.message));
    const [account, letters, packages] = await Promise.all([
      this.fetchProfile().catch(() => null), this.fetchLetters(), this.fetchPackages(),
    ]);
    return { account, letters, packages, mailApiStatus: this.mailApiStatus };
  }

  async refreshIosVersion() {
    const checkedAt = Number(this.homey.settings.get('ios_version_checked_at') || 0);
    if (Date.now() - checkedAt < 24 * 60 * 60 * 1000) return this.homey.settings.get('ios_version');
    const response = await fetch('https://itunes.apple.com/lookup?id=513218878&country=nl');
    if (!response.ok) throw new Error(`App Store ${response.status}`);
    const data = await response.json();
    const version = data.results?.[0]?.version;
    if (!/^\d+(\.\d+){1,3}$/.test(version || '')) throw new Error('Ongeldige PostNL-appversie');
    await this.homey.settings.set('ios_version', version);
    await this.homey.settings.set('ios_version_checked_at', Date.now());
    return version;
  }

  myMailHeaders(extra = {}) {
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
      });
      const payload = await this._json(response);
      const sections = payload?.screen?.sections || [];
      const letters = [];

      for (const section of sections) {
        for (const item of section?.items || []) {
          if (item?.type !== 'Letter') continue;
          const imageUrl = item?.image?.url || null;
          letters.push({
            id: item.editId || imageUrl || `${item.title || 'letter'}-${letters.length}`,
            barcode: item.editId || null,
            deliveryDate: this._parseLetterDate(item.title),
            status: item.isUnread ? 'Nieuw' : '',
            title: item.title || '',
            unread: Boolean(item.isUnread),
            imageUrl,
          });
        }
      }

      this.mailApiStatus = 'available';
      this.log(`PostNL Mijn Post: ${letters.length} letter(s) received from server-driven UI`);
      return letters;
    } catch (error) {
      this.mailApiStatus = 'temporarily_unavailable';
      this.log('PostNL Mijn Post request failed', `HTTP ${error.statusCode || 'unknown'}`, error.message);
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
    const response = await this.request(url, { headers: this.myMailHeaders() });
    const type = response.headers.get('content-type') || 'image/png';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 750000) throw new Error('Afbeelding is te groot');
    return `data:${type};base64,${bytes.toString('base64')}`;
  }

  async fetchPackages() {
    const query = `query { trackedShipments { receiverShipments { key creationDateTime title barcode delivered deliveredTimeStamp deliveryWindowFrom deliveryWindowTo deliveryWindowType detailsUrl shipmentType deliveryAddressType sourceDisplayName __typename } senderShipments { key creationDateTime title barcode delivered deliveredTimeStamp deliveryWindowFrom deliveryWindowTo deliveryWindowType detailsUrl shipmentType deliveryAddressType sourceDisplayName __typename } __typename } }`;
    const data = await this.graphql(query);
    const shipments = [...(data.trackedShipments?.receiverShipments || []), ...(data.trackedShipments?.senderShipments || [])];
    return shipments.map(item => ({
      id: item.key || item.barcode,
      barcode: item.barcode,
      title: item.title || item.sourceDisplayName || item.barcode,
      delivered: Boolean(item.delivered),
      status: item.delivered ? 'Pakket is bezorgd' : 'Pakket is onderweg',
      deliveryDate: item.deliveredTimeStamp || item.deliveryWindowFrom || null,
      deliveryWindow: this.formatWindow(item.deliveryWindowFrom, item.deliveryWindowTo),
      detailsUrl: item.detailsUrl || null,
      shipmentType: item.shipmentType || null,
    }));
  }

  formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('nl-NL', { timeZone: this.homey.clock.getTimezone(), day: 'numeric', month: 'long' }).format(new Date(value));
  }

  formatWindow(from, to) {
    if (!from) return '';
    const date = this.formatDate(from);
    if (!to) return date;
    const time = value => new Intl.DateTimeFormat('nl-NL', { timeZone: this.homey.clock.getTimezone(), hour: '2-digit', minute: '2-digit' }).format(new Date(value));
    return `${date}, ${time(from)}–${time(to)}`;
  }

  async logout() {
    this.auth = null;
    await this.homey.settings.unset('auth');
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
