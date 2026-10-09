'use strict';

const crypto = require('crypto');

const CLIENT_ID = 'deb0a372-6d72-4e09-83fe-997beacbd137';
const HA_CLIENT_ID = 'bd9f1610-b56d-4e05-a09b-f696f05ddade';
const CAPTURE_CLIENT_ID = 'dkyxkt9x888ye422mawmf769yfm9y44j';
const HA_REDIRECT_URI = 'https://www.postnl.nl/';
const HA_SCOPE = 'openid poa-profiles-api offline_access';
const CAPTURE_FLOW_VERSION = '20250910094830574377';
const LOGIN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const TENANT = '101112a0-4a0f-4bbb-8176-2f1b2d370d7c';
const AUTH_URL = `https://login.postnl.nl/${TENANT}/login/authorize`;
const TOKEN_URL = `https://login.postnl.nl/${TENANT}/login/token`;
const REDIRECT_URI = 'postnl://login';
const SCOPE = 'profile openid email address phone poa-profiles-api';
const GRAPHQL_URL = 'https://jouw.postnl.nl/account/api/graphql';
const MYMAIL_URL = 'https://jouw.postnl.nl/services/serverdrivenui/api/MyMail/letter';
const TRACK_API_URL = 'https://jouw.postnl.nl/track-and-trace/api/trackAndTrace';

// Memory limits (v1.2.9). PostNL's account feed keeps returning old delivered
// shipments; on long-lived accounts that list grows without bound and every
// entry was hydrated via Track & Trace, in parallel, on every sync.
const MAX_DELIVERED_PACKAGES = 15;      // most recent delivered shipments kept
const MAX_DELIVERED_ENRICHED = 5;       // delivered shipments hydrated via Track & Trace
const TRACKING_CONCURRENCY = 3;         // parallel Track & Trace requests
const MAX_STATUS_EVENTS = 30;           // timeline events kept per parcel

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
    await this.storage.unset('oauth_pending');
    await this.fetchProfile();
    this._safeAuthLog('authorization_completed', this.getAuthDiagnostics());
    return true;
  }

  _cookieHeader(jar = {}) {
    return Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  _captureCookies(response, jar = {}) {
    let setCookies = [];
    try {
      if (typeof response.headers.getSetCookie === 'function') setCookies = response.headers.getSetCookie();
    } catch (_) {}
    if (!setCookies.length) {
      const raw = response.headers.get('set-cookie');
      if (raw) setCookies = [raw];
    }
    for (const line of setCookies) {
      for (const match of String(line).matchAll(/(?:^|,\s*)([^=;,\s]+)=([^;,]*)/g)) {
        const name = match[1];
        if (!/^(?:expires|path|domain|max-age|samesite|secure|httponly)$/i.test(name)) jar[name] = match[2];
      }
    }
  }

  async _fetchCookieJar(url, options = {}, jar = {}, maxRedirects = 12) {
    let target = String(url);
    let method = options.method || 'GET';
    let body = options.body;
    let headers = { ...(options.headers || {}) };
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const cookie = this._cookieHeader(jar);
      const response = await fetch(target, { ...options, method, body, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual' });
      this._captureCookies(response, jar);
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      if (redirects >= maxRedirects) return response;
      const location = response.headers.get('location');
      if (!location) return response;
      target = new URL(location, target).toString();
      if ([301, 302, 303].includes(response.status) && method !== 'GET') {
        method = 'GET'; body = undefined;
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^content-/i.test(k)));
      }
    }
    throw new Error('Te veel redirects tijdens PostNL-login.');
  }

  _loginJsValue(body, key) {
    const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(body || '').match(new RegExp(`${escaped}\\s*[\\\"']([^\\\"']+)[\\\"']`));
    return match ? match[1] : '';
  }

  _loginJsonValue(body, key) {
    const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(body || '').match(new RegExp(`\\\"${escaped}\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"`));
    return match ? match[1] : '';
  }

  async loginWithPassword(username, password) {
    const email = String(username || '').trim();
    const secret = String(password || '');
    if (!email || !secret) throw this._error(400, 'Vul je PostNL e-mailadres en wachtwoord in.', 'AUTH_INVALID');
    const jar = {};
    const verifier = crypto.randomBytes(96).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(24).toString('base64url');
    // Use the PostNL mobile-app OAuth client for the password-driven login.
    // The Capture/Hosted Login steps are the same as the HA flow, but the
    // resulting token must carry the mobile scopes/client audience because
    // My Post (server-driven MyMail) rejects the web-only HA token.
    const authorize = new URL(AUTH_URL);
    authorize.search = new URLSearchParams({
      client_id: CLIENT_ID, response_type: 'code', scope: SCOPE,
      redirect_uri: REDIRECT_URI, state, nonce: state,
      code_challenge: challenge, code_challenge_method: 'S256',
    }).toString();

    let response = await this._fetchCookieJar(authorize, { headers: { 'User-Agent': LOGIN_USER_AGENT } }, jar);
    const loginUrl = response.url || authorize.toString();
    let body = await response.text();
    let csrf = jar._csrf_token || this._loginJsValue(body, 'aicCsrf:');
    if (!csrf) throw this._error(502, 'PostNL-login kon geen beveiligingstoken vinden.', 'AUTH_LOGIN_CHANGED');

    const transactionId = crypto.randomBytes(30).toString('base64url');
    response = await this._fetchCookieJar(`${new URL(AUTH_URL).origin}/widget/traditional_signin.jsonp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: new URL(AUTH_URL).origin, Referer: loginUrl, 'User-Agent': LOGIN_USER_AGENT },
      body: new URLSearchParams({
        utf8: '✓', signInEmailAddress: email, currentPassword: secret, capture_screen: 'signIn',
        js_version: 'd445bf4', capture_transactionId: transactionId, form: 'signInForm', flow: 'standard',
        client_id: CAPTURE_CLIENT_ID, redirect_uri: `${loginUrl}&socialRedirect=True`, response_type: 'token',
        flow_version: CAPTURE_FLOW_VERSION, settings_version: '', locale: 'en-US', recaptchaVersion: '2',
      }),
    }, jar);
    await response.text();

    response = await this._fetchCookieJar(`${new URL(AUTH_URL).origin}/widget/get_result.jsonp?${new URLSearchParams({ transactionId, cache: String(Date.now()) })}`, { headers: { 'User-Agent': LOGIN_USER_AGENT } }, jar);
    body = await response.text();
    const captureToken = this._loginJsonValue(body, 'accessToken');
    if (!captureToken) throw this._error(401, 'PostNL heeft de inloggegevens niet geaccepteerd.', 'AUTH_INVALID');

    const loginQuery = new URL(loginUrl).search;
    const tokenUrl = `${new URL(AUTH_URL).origin}/${TENANT}/auth-ui/v2/token-url${loginQuery}`;
    const postTokenUrl = async (referer, values) => {
      const r = await this._fetchCookieJar(tokenUrl, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: new URL(AUTH_URL).origin, Referer: referer, 'User-Agent': LOGIN_USER_AGENT },
        body: new URLSearchParams(values),
      }, jar, 0);
      return { location: r.headers.get('location') || '', body: await r.text() };
    };

    let stage = await postTokenUrl(loginUrl, { screen: 'signIn', authenticated: 'True', registering: 'False', accessToken: captureToken, _csrf_token: csrf });
    let authUrl = stage.location;
    if (!authUrl) {
      const existingToken = this._loginJsValue(stage.body, 'existingToken:');
      const screen = this._loginJsValue(stage.body, 'screenToRender:');
      csrf = this._loginJsValue(stage.body, 'aicCsrf:') || jar._csrf_token || csrf;
      if (screen !== 'loginSuccess' || !existingToken || !csrf) throw this._error(502, 'PostNL-login bereikte loginSuccess niet.', 'AUTH_LOGIN_CHANGED');
      stage = await postTokenUrl(tokenUrl, { screen: 'loginSuccess', accessToken: existingToken, _csrf_token: csrf });
      authUrl = stage.location;
    }
    if (!authUrl) throw this._error(502, 'PostNL-login gaf geen autorisatie-redirect terug.', 'AUTH_LOGIN_CHANGED');

    response = await this._fetchCookieJar(authUrl, { headers: { 'User-Agent': LOGIN_USER_AGENT } }, jar, 0);
    const finalLocation = response.headers.get('location') || '';
    const callback = new URL(finalLocation || authUrl, REDIRECT_URI);
    const code = callback.searchParams.get('code');
    const returnedState = callback.searchParams.get('state');
    if (!code) throw this._error(502, 'PostNL-login gaf geen autorisatiecode terug.', 'AUTH_LOGIN_CHANGED');
    if (returnedState !== state) throw this._error(400, 'PostNL-login beveiligingscode komt niet overeen.', 'AUTH_STATE_MISMATCH');

    const token = await this._tokenRequest({ grant_type: 'authorization_code', client_id: CLIENT_ID, code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
    token._client_id = CLIENT_ID;
    token._redirect_uri = REDIRECT_URI;
    await this._saveToken(token);
    await this.storage.set('username', email);
    await this.fetchProfile();
    this._safeAuthLog('password_login_completed', { usernamePresent: true, ...this.getAuthDiagnostics() });
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
      clientId: token._client_id || this.auth?.clientId || CLIENT_ID,
      redirectUri: token._redirect_uri || this.auth?.redirectUri || REDIRECT_URI,
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
            client_id: this.auth?.clientId || CLIENT_ID,
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

  _localDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: this.homey.clock.getTimezone(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
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
    const recency = parcel => Date.parse(parcel.deliveredTimeStamp || parcel.deliveryDate || parcel.createdAt || '') || 0;
    const active = [...incoming, ...outgoing].filter(parcel => !parcel.delivered);
    const delivered = [...incoming, ...outgoing]
      .filter(parcel => parcel.delivered)
      .sort((a, b) => recency(b) - recency(a))
      .slice(0, MAX_DELIVERED_PACKAGES);
    const packages = [...active, ...delivered];

    // The account GraphQL list only exposes coarse shipment state. Hydrate active
    // shipments (and only the most recent delivered ones) from PostNL's own Track
    // & Trace endpoint, a few at a time, so Flow cards receive the exact status
    // text/timeline without holding dozens of large JSON responses at once.
    const enrichIds = new Set([...active, ...delivered.slice(0, MAX_DELIVERED_ENRICHED)]);
    const enriched = new Array(packages.length);
    let next = 0;
    const worker = async () => {
      while (next < packages.length) {
        const index = next++;
        const parcel = packages[index];
        if (!enrichIds.has(parcel)) { enriched[index] = parcel; continue; }
        try { enriched[index] = await this._enrichPackageTracking(parcel); }
        catch (error) {
          this.log('PostNL Track & Trace enrichment failed', parcel.barcode || parcel.id, error.message);
          enriched[index] = parcel;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(TRACKING_CONCURRENCY, packages.length) }, worker));
    return enriched;
  }

  _trackingKeyFromDetailsUrl(detailsUrl) {
    if (!detailsUrl) return '';
    try {
      const url = new URL(detailsUrl);
      const marker = '/track-and-trace/';
      const pos = url.pathname.indexOf(marker);
      if (pos < 0) return '';
      const slug = decodeURIComponent(url.pathname.slice(pos + marker.length).replace(/^\/+|\/+$/g, ''));
      if (!slug) return '';
      const parts = slug.split('/').filter(Boolean);
      if (parts.length >= 3) {
        const [barcode, postalCode, country] = parts;
        return `${barcode}-${String(country).toUpperCase()}-${postalCode}`;
      }
      return parts[0] || '';
    } catch (_) { return ''; }
  }

  _extractTrackingColli(data, barcode = '') {
    let colli = data && typeof data === 'object' ? data : {};
    if (Object.prototype.hasOwnProperty.call(colli, 'colli')) colli = colli.colli;
    if (Array.isArray(colli)) return colli[0] || {};
    if (colli && typeof colli === 'object' && !colli.statusPhase) {
      if (barcode && colli[barcode] && typeof colli[barcode] === 'object') return colli[barcode];
      return Object.values(colli).find(value => value && typeof value === 'object') || {};
    }
    return colli && typeof colli === 'object' ? colli : {};
  }

  _trackingEventTime(event = {}) {
    return event.observationDate || event.dateTime || event.timestamp || event.timeStamp || '';
  }

  _trackingEventDescription(event = {}) {
    return String(event.description || event.message || event.status || event.eventDescription || '').trim();
  }

  _trackingPhysicalProperties(colli = {}) {
    // PostNL exposes physical properties in more than one shape. Keep the
    // broad parser used by the earlier Homey build, while also normalising
    // weight to kg and dimensions to cm like the HA PostNL integration.
    const entries = [];
    const seen = new Set();
    const walk = (value, path = '') => {
      if (value == null || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        const nextPath = path ? `${path}.${key}` : key;
        if (child == null || typeof child !== 'object') {
          entries.push({ key: String(key).toLowerCase(), path: nextPath.toLowerCase(), value: child });
        }
        walk(child, nextPath);
      }
    };
    walk(colli);

    const number = value => {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      const m = String(value ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
      return m ? Number(m[0]) : null;
    };
    const fmt = (value, decimals = 1) => {
      const n = number(value);
      if (n == null) return '';
      const rounded = Math.round(n * (10 ** decimals)) / (10 ** decimals);
      return String(rounded).replace('.', ',');
    };
    const findEntry = patterns => {
      for (const pattern of patterns) {
        const match = entries.find(entry => pattern.test(entry.key) || pattern.test(entry.path));
        if (match && match.value !== '' && match.value != null) return match;
      }
      return null;
    };

    const findNativeDimensions = value => {
      if (!value || typeof value !== 'object') return null;
      if (!Array.isArray(value)
        && ['depth', 'width', 'height'].every(key => number(value[key]) != null)) return value;
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') {
          const found = findNativeDimensions(child);
          if (found) return found;
        }
      }
      return null;
    };
    // PostNL Track & Trace uses depth/width/height in millimetres. The object
    // can move between response wrappers, so do not assume it is top-level.
    const native = findNativeDimensions(colli);

    const weightEntry = findEntry([
      /^(weightingrams|weightingram|weightgram|weightgrams|parcelweight|weight|mass|gewicht)$/i,
      /(?:physicalproperties|parcelcharacteristics|characteristics|measurements|dimensions|shipment).*\.(?:weight|mass|gewicht)/i,
    ]);
    const rawWeight = weightEntry?.value;
    let weightG = null;
    if (rawWeight != null) {
      const raw = String(rawWeight).trim();
      const n = number(rawWeight);
      if (n != null) {
        if (/\bkg\b/i.test(raw)) weightG = n * 1000;
        else if (/\b(?:g|gram|grams)\b/i.test(raw)) weightG = n;
        else if (/weightkg|kilogram/i.test(weightEntry?.path || '')) weightG = n * 1000;
        else weightG = n; // PostNL native weight is grams.
      }
    }
    if (weightG == null && native && number(native.weight) != null) weightG = number(native.weight);
    const weightKg = weightG == null ? null : weightG / 1000;
    const weightText = weightG == null ? '' : `${fmt(weightG, 1)} gram`;

    const lengthEntry = findEntry([/^(length|lengte|depth|longside)$/i, /(?:dimensions?|measurements?|physicalproperties).*\.(?:length|lengte|depth|longside)/i]);
    const widthEntry  = findEntry([/^(width|breedte|shortside)$/i, /(?:dimensions?|measurements?|physicalproperties).*\.(?:width|breedte|shortside)/i]);
    const heightEntry = findEntry([/^(height|hoogte)$/i, /(?:dimensions?|measurements?|physicalproperties).*\.(?:height|hoogte)/i]);
    const unitEntry   = findEntry([/^(dimensionunit|dimensionsunit|unitofmeasure|unit)$/i]);

    let length = number(lengthEntry?.value);
    let width = number(widthEntry?.value);
    let height = number(heightEntry?.value);
    let unit = String(unitEntry?.value || '').trim().toLowerCase();
    unit = unit.replace(/centimeters?|centimetres?/i,'cm').replace(/millimeters?|millimetres?/i,'mm');

    // The native Track & Trace dimensions object is grams + millimetres,
    // matching the HA PostNL implementation (depth/width/height -> L/W/H cm).
    const nativeShape = Boolean(native && ['depth','width','height'].every(k => number(native[k]) != null));
    if (nativeShape) {
      length = number(native.depth);
      width = number(native.width);
      height = number(native.height);
      unit = 'mm';
    } else if (!unit && [length, width, height].every(Number.isFinite)) {
      // Undocumented PostNL wrappers sometimes flatten the same native values
      // without a unit. Values in this payload are still millimetres. Only use
      // the heuristic for obviously millimetre-scaled parcel dimensions.
      if (Math.max(length, width, height) >= 100) unit = 'mm';
    }

    const toCm = value => {
      if (value == null) return null;
      if (unit === 'mm') return value / 10;
      if (unit === 'm') return value * 100;
      return value; // cm/default: earlier Homey payloads already used cm.
    };
    const lengthCm = toCm(length);
    const widthCm = toCm(width);
    const heightCm = toCm(height);

    let dimensionsText = '';
    if ([lengthCm,widthCm,heightCm].every(Number.isFinite)) {
      dimensionsText = `${fmt(lengthCm, 1)} x ${fmt(widthCm, 1)} x ${fmt(heightCm, 1)} cm`;
    } else {
      const direct = findEntry([/^(dimensions?|afmetingen)$/i, /(?:physicalproperties|parcelcharacteristics|characteristics|measurements).*\.dimensions?$/i]);
      if (direct && direct.value != null && typeof direct.value !== 'object') dimensionsText = String(direct.value).trim();
    }

    return { weightKg, weight: weightText, dimensions: dimensionsText, lengthCm, widthCm, heightCm };
  }

  _observationStatus(code) {
    const map = {
      A01:'registered', A03:'registered', M02:'registered',
      B01:'in_transit', C02:'in_transit', F01:'in_transit', J01:'in_transit', R01:'in_transit', J04:'in_transit', J21:'in_transit', J31:'in_transit', J32:'in_transit', J30:'in_transit', J39:'in_transit', J40:'in_transit', J46:'in_transit', J44:'in_transit', J55:'in_transit', X01:'in_transit', X02:'in_transit', X03:'in_transit', X04:'in_transit', X08:'in_transit', X19:'in_transit', A21:'in_transit', I07:'in_transit', G01:'in_transit', G05:'in_transit', K01:'in_transit', K70:'in_transit', T04:'in_transit',
      J05:'out_for_delivery', I08:'at_pickup_point', J02:'at_pickup_point', J12:'at_pickup_point', J23:'at_pickup_point',
      A80:'delivered', I01:'delivered', I02:'delivered', I05:'delivered', I11:'delivered', I12:'delivered', Z01:'delivered',
    };
    return map[String(code || '').trim().toUpperCase()] || '';
  }

  _canonicalStatus(parcel = {}, observations = []) {
    if (parcel.delivered) return 'delivered';
    let last = '';
    for (const observation of observations) {
      const mapped = this._observationStatus(observation.observationCode || observation.code);
      if (mapped) last = mapped;
    }
    if (last) return last;
    const raw = String(parcel.statusRaw || parcel.status || '').toLowerCase().replace(/-/g, ' ');
    const patterns = [
      [['ligt klaar bij postnl punt','afgeleverd op postnl punt','klaar bij postnl punt'],'at_pickup_point'],
      [['teruggestuurd','retour'],'returning'],
      [['wordt vandaag bezorgd','onderweg naar het bezorgadres','onderweg naar de bezorger','bezorger is onderweg'],'out_for_delivery'],
      [['aangemeld','verwacht'],'registered'],
      [['bezorgmoment is bijgewerkt','lukt vandaag niet','duurt de bezorging wat langer','ontvangen','gesorteerd','onderweg','klaar voor verzending','de grens over','aangekomen in het land van bestemming'],'in_transit'],
      [['bezorgd bij de ontvanger','bezorgd','afgehaald'],'delivered'],
    ];
    for (const [needles, status] of patterns) if (needles.some(n => raw.includes(n))) return status;
    return 'unknown';
  }

  _trackingObservations(colli = {}) {
    const analytics = colli.analyticsInfo && typeof colli.analyticsInfo === 'object' ? colli.analyticsInfo : {};
    const list = Array.isArray(analytics.allObservations) && analytics.allObservations.length
      ? analytics.allObservations
      : (Array.isArray(colli.observations) ? colli.observations : []);
    return [...list].sort((a,b)=>(Date.parse(this._trackingEventTime(a)||'')||0)-(Date.parse(this._trackingEventTime(b)||'')||0));
  }

  _buildStatusHistory(observations = [], maxEvents = 20) {
    let stage = 'registered';
    const meta = new Set(['A04','A18','A19','A24','A25','A65','A94','A95','A96','A98','A20','B03','J09','K33','K50','P21']);
    return observations.map(obs => {
      const code = String(obs.observationCode || obs.code || '').trim();
      const mapped = this._observationStatus(code);
      if (mapped) stage = mapped;
      const canonical = mapped || (meta.has(code) ? stage : null);
      return { timestamp: this._trackingEventTime(obs), status: canonical, raw_status: this._trackingEventDescription(obs), observation_code: code };
    }).filter(x => x.timestamp || x.raw_status || x.observation_code).slice(-maxEvents);
  }

  async _fetchTrackingDetail(parcel) {
    const key = this._trackingKeyFromDetailsUrl(parcel.detailsUrl);
    if (!key) return null;
    const url = `${TRACK_API_URL}/${encodeURIComponent(key)}?language=nl`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'nl-NL,nl;q=0.9',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (!response.ok) throw this._error(response.status, `PostNL Track & Trace ${response.status}`);
    return this._json(response);
  }

  async refreshPackageTracking(parcel) {
    return this._enrichPackageTracking({ ...(parcel || {}) });
  }

  async _enrichPackageTracking(parcel) {
    const detail = await this._fetchTrackingDetail(parcel);
    if (!detail) return parcel;
    const colli = this._extractTrackingColli(detail, parcel.barcode);
    if (!colli || !Object.keys(colli).length) return parcel;

    const phase = colli.statusPhase && typeof colli.statusPhase === 'object' ? colli.statusPhase : {};
    const observations = this._trackingObservations(colli);
    const events = [...(Array.isArray(colli.events) ? colli.events : []), ...observations]
      .map(event => ({
        description: this._trackingEventDescription(event),
        timestamp: this._trackingEventTime(event),
        observationCode: String(event?.observationCode || event?.code || ''),
        location: typeof event?.location === 'object' ? String(event.location?.name || '') : String(event?.location || ''),
      }))
      .filter(event => event.description || event.timestamp)
      .sort((a, b) => (Date.parse(a.timestamp || '') || 0) - (Date.parse(b.timestamp || '') || 0))
      .slice(-MAX_STATUS_EVENTS);
    const latestEvent = events[events.length - 1] || null;
    const officialStatus = String(phase.message || latestEvent?.description || parcel.status || '').trim();
    const statusCode = String(phase.code || phase.status || phase.phase || phase.id || '').trim();
    const statusChangedAt = String(colli.lastObservation || latestEvent?.timestamp || '').trim();
    const latestEventDescription = String(latestEvent?.description || officialStatus || '').trim();
    const fingerprint = [officialStatus, statusCode, statusChangedAt, latestEventDescription, latestEvent?.timestamp || '', events.length].join('|');

    const eta = colli.eta && typeof colli.eta === 'object' ? colli.eta : {};
    const etaFrom = eta.start || colli.expectedDeliveryDate || parcel.deliveryWindowFrom || null;
    const etaTo = eta.end || parcel.deliveryWindowTo || null;
    // "Je pakket wordt vandaag bezorgd" / "kon niet bezorgd worden" also contain
    // the word "bezorgd"; only a completed delivery/pickup counts as delivered.
    const deliveredByStatus = /\b(bezorgd|afgehaald|delivered|picked up)\b/i.test(officialStatus)
      && !/\b(wordt|worden|word|niet|verwacht|will be|expected|not)\b/i.test(officialStatus);
    const physical = this._trackingPhysicalProperties(colli);
    const statusHistory = this._buildStatusHistory(observations);
    const observationCode = String((observations[observations.length - 1] || {}).observationCode || '');
    const pickup = String(parcel.deliveryAddressType || '').toLowerCase() === 'servicepoint';
    const pickupPoint = String(colli.pickupPoint?.name || colli.servicePoint?.name || colli.deliveryLocation?.name || '');
    const canonicalStatus = this._canonicalStatus({ ...parcel, delivered: Boolean(parcel.delivered || deliveredByStatus), statusRaw: officialStatus }, observations);

    return {
      ...parcel,
      status: officialStatus || parcel.status,
      statusRaw: officialStatus || parcel.status,
      statusCode,
      statusChangedAt,
      latestStatusEvent: latestEventDescription,
      statusEvents: events,
      statusFingerprint: fingerprint,
      delivered: Boolean(parcel.delivered || deliveredByStatus),
      deliveryDate: parcel.deliveredTimeStamp || etaFrom || parcel.deliveryDate || null,
      deliveryWindowFrom: etaFrom || parcel.deliveryWindowFrom || null,
      deliveryWindowTo: etaTo || parcel.deliveryWindowTo || null,
      deliveryWindow: this.formatWindow(etaFrom, etaTo) || parcel.deliveryWindow || '',
      weight: physical.weight || parcel.weight || '',
      weightKg: physical.weightKg,
      dimensions: physical.dimensions || parcel.dimensions || '',
      dimensionLengthCm: physical.lengthCm, dimensionWidthCm: physical.widthCm, dimensionHeightCm: physical.heightCm,
      statusHistory, observationCode, canonicalStatus, pickup, pickupPoint,
    };
  }

  _mapPackage(item, direction) {
    const sender = String(item.title || item.sourceDisplayName || '').trim();
    const receiver = String(item.receiverTitle || '').trim();
    const fallbackStatus = item.delivered
      ? (this.homey.i18n.getLanguage() === 'nl' ? 'Bezorgd' : 'Delivered')
      : (item.deliveryWindowFrom || item.deliveryWindowTo
        ? (this.homey.i18n.getLanguage() === 'nl' ? 'Onderweg' : 'In transit')
        : (this.homey.i18n.getLanguage() === 'nl' ? 'Aangemeld' : 'Announced'));
    return {
      id: item.key || item.barcode,
      barcode: item.barcode || '',
      sender,
      receiver,
      title: sender || item.barcode || 'PostNL',
      delivered: Boolean(item.delivered),
      status: fallbackStatus,
      statusRaw: fallbackStatus,
      statusCode: '',
      statusChangedAt: item.deliveredTimeStamp || item.creationDateTime || '',
      latestStatusEvent: fallbackStatus,
      statusEvents: [],
      statusFingerprint: [fallbackStatus, item.deliveredTimeStamp || item.creationDateTime || ''].join('|'),
      weight: '', weightKg: null,
      dimensions: '', dimensionLengthCm: null, dimensionWidthCm: null, dimensionHeightCm: null,
      statusHistory: [], observationCode: '', canonicalStatus: item.delivered ? 'delivered' : 'registered',
      pickup: String(item.deliveryAddressType || '').toLowerCase() === 'servicepoint', pickupPoint: '',
      deliveredTimeStamp: item.deliveredTimeStamp || null,
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

  _hasExplicitTimezone(value) {
    return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value || '').trim());
  }

  _literalParts(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?/);
    if (!match) return null;
    return { year: match[1], month: match[2], day: match[3], hour: match[4] || '', minute: match[5] || '' };
  }

  formatDate(value) {
    if (!value) return '';
    const locale = this.homey.i18n.getLanguage() === 'nl' ? 'nl-NL' : 'en-GB';
    const parts = this._literalParts(value);
    if (parts && !this._hasExplicitTimezone(value)) {
      const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12));
      return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(date);
    }
    return new Intl.DateTimeFormat(locale, { timeZone: this.homey.clock.getTimezone(), day: 'numeric', month: 'long' }).format(new Date(value));
  }

  formatDateDMY(value) {
    if (!value) return '';
    const parts = this._literalParts(value);
    if (parts && !this._hasExplicitTimezone(value)) return `${parts.day}-${parts.month}-${parts.year}`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const formatted = new Intl.DateTimeFormat('en-GB', { timeZone: this.homey.clock.getTimezone(), day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(date);
    const get = type => formatted.find(part => part.type === type)?.value || '';
    return `${get('day')}-${get('month')}-${get('year')}`;
  }

  formatTime(value) {
    if (!value) return '';
    const parts = this._literalParts(value);
    if (parts?.hour && !this._hasExplicitTimezone(value)) return `${parts.hour}:${parts.minute}`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', { timeZone: this.homey.clock.getTimezone(), hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  formatDateTime(value) {
    if (!value) return '';
    const parts = this._literalParts(value);
    if (parts && !this._hasExplicitTimezone(value)) {
      return `${parts.day}-${parts.month}-${parts.year}${parts.hour ? ` ${parts.hour}:${parts.minute}` : ''}`;
    }
    const locale = this.homey.i18n.getLanguage() === 'nl' ? 'nl-NL' : 'en-GB';
    return new Intl.DateTimeFormat(locale, { timeZone: this.homey.clock.getTimezone(), day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  }

  formatWindow(from, to) {
    if (!from && !to) return '';
    const start = from ? this.formatTime(from) : '';
    const end = to ? this.formatTime(to) : '';
    if (start && end) return `${start} - ${end}`;
    return start || end;
  }

  async logout() {
    this._safeAuthLog('logout_started', this.getAuthDiagnostics());
    this.auth = null;
    this.mailApiStatus = 'unknown';
    this.mailApiError = null;
    await this.storage.unset('auth');
    await await this.storage.unset('oauth_pending');
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
