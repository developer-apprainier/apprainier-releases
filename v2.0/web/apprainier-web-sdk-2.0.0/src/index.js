const DEFAULT_ENDPOINT = 'https://sfo.cloud.appwrite.io/v1';
const CENTRAL_PROJECT_ID = '6938acd8000eed383ed2';
const RUNTIME_GATEWAY_FUNCTION_ID = '6a077bec000f1c3f1a7c';
const SDK_VERSION = '2.0.0';
const STORAGE_PREFIX = 'apprainier.web';
const FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  cache: {
    featureFlagsTtlMs: 5 * 60_000,
    surveysTtlMs: 15 * 60_000,
    announcementsTtlMs: 15 * 60_000,
    liveCardsTtlMs: 15 * 60_000,
    messageCenterSettingsTtlMs: 5 * 60_000,
  },
  events: {
    enabled: true,
    aggregateOnlyImpressions: false,
    flushIntervalMs: 2 * 60_000,
    batchSize: 50,
    maxQueueSize: 500,
    maxEventsPerMinute: 120,
    sampling: {
      defaultPercent: 100,
      sdkPercent: 100,
      sessionPercent: 100,
      surveyPercent: 100,
      announcementPercent: 100,
      liveCardPercent: 100,
      featureFlagPercent: 25,
      warningPercent: 100,
      errorPercent: 100,
    },
  },
  messageCenter: {
    passivePollingEnabled: false,
    listPollingIntervalMs: 60_000,
    chatPollingIntervalMs: 10_000,
    foregroundRefreshTtlMs: 60_000,
  },
  killSwitches: {
    disableEventLogs: false,
    disableSurveyImpressions: false,
    disableAnnouncementImpressions: false,
    disableLiveCardImpressions: false,
    disableFeatureFlagExposureLogs: false,
    disablePassiveMessagePolling: true,
  },
});

export const AppRainierEvents = Object.freeze({
  surveySubmitted: 'AppRainierSurveySubmitted',
  surveyCancelled: 'AppRainierSurveyCancelled',
  surveyDismissed: 'AppRainierSurveyDismissed',
  announcementSubmitted: 'AppRainierAnnouncementSubmitted',
  announcementCancelled: 'AppRainierAnnouncementCancelled',
  announcementDismissed: 'AppRainierAnnouncementDismissed',
  liveCardClicked: 'AppRainierLiveCardClicked',
  deepLink: 'AppRainierDeepLink',
});

const state = {
  apiKey: null,
  environment: 'production',
  endpoint: DEFAULT_ENDPOINT,
  projectId: CENTRAL_PROJECT_ID,
  gatewayFunctionId: RUNTIME_GATEWAY_FUNCTION_ID,
  sessionToken: null,
  config: null,
  runtimeConfig: DEFAULT_RUNTIME_CONFIG,
  initialized: false,
  anonymousId: null,
  identifiedUserId: null,
  profileId: null,
  deviceId: null,
  sessionId: null,
  sessionStartedAt: 0,
  userType: 'guest',
  userProperties: {},
  appProperties: {},
  deviceProperties: {},
  customProperties: {},
  surveys: [],
  announcements: [],
  liveCards: [],
  featureFlags: [],
  runtimeBundleVersions: null,
  runtimeBundleLoadedAt: 0,
  messageThreads: [],
  messageAnnouncements: [],
  messageCenterSettings: null,
  activeChat: null,
  activeChatTimer: null,
  eventQueue: [],
  runtimeTelemetryQueue: [],
  runtimeTelemetryTimer: null,
  eventFlushPausedAfterFailure: false,
  eventRateLimitWindow: 0,
  eventRateLimitCount: 0,
  lastRefreshAt: {},
  announcementShownAt: new Map(),
  listeners: new Map(),
  timers: new Set(),
};

function assertBrowser() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('AppRainier Web SDK requires a browser environment.');
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`AppRainier.${label} must be a non-empty string.`);
  }
  return value.trim();
}

function objectValue(value) {
  const parsed = typeof value === 'string' ? parseJson(value, {}) : value;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.randomUUID) {
    return `${prefix}_${cryptoObject.randomUUID().replaceAll('-', '').slice(0, 24)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function storageKey(key) {
  return `${STORAGE_PREFIX}.${key}`;
}

function readStorage(key) {
  try {
    return localStorage.getItem(storageKey(key));
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(storageKey(key), value);
  } catch {
    // Storage can be blocked in privacy modes. The SDK still works in-memory.
  }
}

function readJsonStorage(key, fallback) {
  const raw = readStorage(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  writeStorage(key, JSON.stringify(value));
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      output[key] = deepMerge(base[key], value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function runtimeConfigValue(path, fallback) {
  let current = state.runtimeConfig;
  for (const key of path) {
    current = current?.[key];
    if (current === undefined || current === null) return fallback;
  }
  return current;
}

function shouldRefresh(key, ttlMs, force = false) {
  if (force) {
    state.lastRefreshAt[key] = Date.now();
    return true;
  }
  const ttl = Number(ttlMs);
  const previous = state.lastRefreshAt[key] || 0;
  if (ttl > 0 && Date.now() - previous < ttl) return false;
  state.lastRefreshAt[key] = Date.now();
  return true;
}

function samplingPercentFor(eventName, eventType) {
  const sampling = runtimeConfigValue(['events', 'sampling'], DEFAULT_RUNTIME_CONFIG.events.sampling);
  const type = String(eventType || '').toLowerCase();
  const name = String(eventName || '').toLowerCase();
  if (type === 'sdk') return sampling.sdkPercent;
  if (type === 'session') return sampling.sessionPercent;
  if (type === 'survey') return sampling.surveyPercent;
  if (type === 'announcement') return sampling.announcementPercent;
  if (type === 'live_card' || type === 'livecard') return sampling.liveCardPercent;
  if (type === 'feature_flag' || type === 'featureflag' || name.includes('feature_flag') || name.includes('experiment_')) return sampling.featureFlagPercent;
  if (type === 'warning' || name.includes('warning')) return sampling.warningPercent;
  if (type === 'error' || name.includes('error') || name.includes('exception')) return sampling.errorPercent;
  return sampling.defaultPercent;
}

function isWithinEventRateLimit() {
  const maxEventsPerMinute = Number(runtimeConfigValue(['events', 'maxEventsPerMinute'], 120));
  if (maxEventsPerMinute <= 0) return false;
  const windowId = Math.floor(Date.now() / 60_000);
  if (windowId !== state.eventRateLimitWindow) {
    state.eventRateLimitWindow = windowId;
    state.eventRateLimitCount = 0;
  }
  state.eventRateLimitCount += 1;
  return state.eventRateLimitCount <= maxEventsPerMinute;
}

function shouldKeepEvent(eventName, eventType) {
  if (!runtimeConfigValue(['events', 'enabled'], true)) return false;
  if (runtimeConfigValue(['killSwitches', 'disableEventLogs'], false)) return false;
  if (!isWithinEventRateLimit()) return false;
  const percent = Math.max(0, Math.min(100, Number(samplingPercentFor(eventName, eventType))));
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const identity = [state.config?.appId, getEffectiveUserId(), state.deviceId, eventType, eventName].join('|');
  return hashBucket(identity) < percent;
}

function stringifySafe(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...(row.data && typeof row.data === 'object' ? row.data : row),
    $id: row.$id ?? row.id,
    $createdAt: row.$createdAt,
    $updatedAt: row.$updatedAt,
  };
}

function parseStructure(item) {
  return parseJson(item?.structure, {}) || {};
}

function parseConfig(item) {
  return parseJson(item?.config, {}) || {};
}

function parseTargeting(item) {
  const config = parseConfig(item);
  return {
    ...(parseJson(config?.targeting, {}) || {}),
    ...(parseJson(item?.targeting ?? item?.targetingRules, {}) || {}),
  };
}

function valueToString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return stringifySafe(value);
}

function eventTargetFor(item) {
  return item?.eventTriggerId || item?.triggerId || item?.eventName || item?.key || item?.name;
}

function eventTargetsFor(item) {
  const targeting = parseTargeting(item);
  const candidates = [
    item?.eventTriggerId,
    item?.triggerId,
    item?.eventName,
    item?.key,
    item?.templateId,
    item?.name,
    targeting?.behavioralTrigger?.eventName,
    ...(Array.isArray(targeting?.triggerEvents) ? targeting.triggerEvents : []),
  ];
  return candidates.filter((value) => typeof value === 'string' && value.trim());
}

function emit(eventName, payload = {}) {
  const listeners = state.listeners.get(eventName);
  if (listeners) {
    for (const listener of [...listeners]) {
      queueMicrotask(() => listener(payload));
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  }
}

function addListener(eventName, listener) {
  nonEmptyString(eventName, 'addListener(eventName)');
  if (typeof listener !== 'function') {
    throw new TypeError('AppRainier.addListener(listener) must be a function.');
  }
  const listeners = state.listeners.get(eventName) || new Set();
  listeners.add(listener);
  state.listeners.set(eventName, listeners);
  return {
    remove() {
      listeners.delete(listener);
      if (listeners.size === 0) state.listeners.delete(eventName);
    },
  };
}

function combineSubscriptions(subscriptions) {
  return {
    remove() {
      subscriptions.forEach((subscription) => subscription.remove());
    },
  };
}

async function executeGateway(action, payload = {}, { includeSessionToken = true } = {}) {
  const body = {
    action,
    payload,
  };
  if (includeSessionToken && state.sessionToken) {
    body.sessionToken = state.sessionToken;
  }

  let response;
  try {
    response = await fetch(`${state.endpoint}/functions/${state.gatewayFunctionId}/executions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': state.projectId,
      },
      body: JSON.stringify({
        body: JSON.stringify(body),
        async: false,
        path: '/',
        method: 'POST',
      }),
    });
  } catch (error) {
    throw new Error(
      'Unable to reach the AppRainier runtime gateway from this web origin. ' +
        'Add this website origin to the Appwrite Web/CORS platform settings, or route SDK calls through an allowed gateway proxy. ' +
        (error?.message || '')
    );
  }

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(raw.message || `AppRainier gateway request failed with HTTP ${response.status}.`);
  }
  const envelope = typeof raw.responseBody === 'string' ? JSON.parse(raw.responseBody || '{}') : raw;
  if (!envelope.ok) {
    throw new Error(envelope.error || `AppRainier gateway action failed: ${action}`);
  }
  return envelope.data || {};
}

async function executeGatewayKeepalive(action, payload = {}, { includeSessionToken = true } = {}) {
  const body = { action, payload };
  if (includeSessionToken && state.sessionToken) {
    body.sessionToken = state.sessionToken;
  }
  return fetch(`${state.endpoint}/functions/${state.gatewayFunctionId}/executions`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': state.projectId,
    },
    body: JSON.stringify({
      body: JSON.stringify(body),
      async: false,
      path: '/',
      method: 'POST',
    }),
  }).catch(() => null);
}

function requireInitialized() {
  if (!state.initialized) {
    throw new Error('AppRainier SDK is not initialized. Call AppRainier.initialize(..) first.');
  }
}

function getEffectiveUserId() {
  return state.identifiedUserId || state.anonymousId;
}

function getUserEmail() {
  return (
    state.userProperties.email ||
    state.userProperties.userEmail ||
    state.customProperties.email ||
    null
  );
}

function getUserName() {
  return (
    state.userProperties.name ||
    state.userProperties.displayName ||
    state.userProperties.fullName ||
    state.customProperties.name ||
    'Web User'
  );
}

function buildDeviceProperties() {
  return {
    platform: 'web',
    runtime: 'browser',
    user_agent: navigator.userAgent,
    language: navigator.language,
    screen_size: `${window.screen.width}x${window.screen.height}`,
    viewport_size: `${window.innerWidth}x${window.innerHeight}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    device_model: navigator.userAgentData?.platform || navigator.platform || 'web',
  };
}

function buildAppProperties() {
  return {
    app_version: '1.0',
    version: '1',
    version_name: '1',
    url: location.href,
    hostname: location.hostname,
    sdk_version: SDK_VERSION,
  };
}

function buildSnapshot() {
  const config = state.config || {};
  return {
    profileId: state.profileId,
    anonymousId: state.anonymousId,
    effectiveUserId: getEffectiveUserId(),
    identifiedUserId: state.identifiedUserId,
    teamId: config.teamId || '',
    environment: state.environment,
    organizationId: config.organizationId || null,
    projectId: config.projectId || null,
    appId: config.appId || '',
    bundleOrPackageId: location.hostname || 'web',
    deviceId: state.deviceId,
    userType: state.userType,
    userProperties: state.userProperties,
    appProperties: state.appProperties,
    deviceProperties: state.deviceProperties,
    customProperties: state.customProperties,
    sessionId: state.sessionId,
    isRegistered: Boolean(state.identifiedUserId),
    registrationDate: state.identifiedUserId ? nowIso() : null,
    lastLogin: nowIso(),
  };
}

async function syncUserState(incrementSessionCount = false) {
  requireInitialized();
  await executeGateway('sync_user_state', {
    snapshot: buildSnapshot(),
    incrementSessionCount,
  });
  return true;
}

function scheduleTimer(callback, intervalMs) {
  const timer = window.setInterval(callback, intervalMs);
  state.timers.add(timer);
  return timer;
}

function clearActiveChatTimer() {
  if (state.activeChatTimer) {
    window.clearInterval(state.activeChatTimer);
    state.timers.delete(state.activeChatTimer);
    state.activeChatTimer = null;
  }
  state.activeChat = null;
}

function seedIdentity() {
  state.anonymousId = readStorage('anonymousId') || randomId('anonymous');
  state.deviceId = readStorage('deviceId') || randomId('dev');
  state.identifiedUserId = readStorage('identifiedUserId') || null;
  state.profileId = readStorage('profileId') || `prf_${state.anonymousId.replace(/^anonymous_/, '').slice(0, 32)}`;
  state.userProperties = readJsonStorage('userProperties', {});
  state.appProperties = { ...buildAppProperties(), ...readJsonStorage('appProperties', {}) };
  state.deviceProperties = { ...buildDeviceProperties(), ...readJsonStorage('deviceProperties', {}) };
  state.customProperties = readJsonStorage('customProperties', {});
  state.userType = readStorage('userType') || 'guest';
  writeStorage('anonymousId', state.anonymousId);
  writeStorage('deviceId', state.deviceId);
  writeStorage('profileId', state.profileId);
}

function persistIdentity() {
  writeStorage('anonymousId', state.anonymousId);
  writeStorage('deviceId', state.deviceId);
  writeStorage('profileId', state.profileId);
  if (state.identifiedUserId) writeStorage('identifiedUserId', state.identifiedUserId);
  writeStorage('userType', state.userType);
  writeJsonStorage('userProperties', state.userProperties);
  writeJsonStorage('appProperties', state.appProperties);
  writeJsonStorage('deviceProperties', state.deviceProperties);
  writeJsonStorage('customProperties', state.customProperties);
}

function runtimeBundleStorageKey() {
  const appId = state.config?.appId || 'unknown_app';
  return `runtimeBundle.${appId}.${state.environment}`;
}

function applyRuntimeBundleItems(items = {}) {
  const loadedAt = Date.now();
  if (Array.isArray(items.surveys)) {
    state.surveys = items.surveys.map(normalizeRow);
    state.lastRefreshAt.surveys = loadedAt;
  }
  if (Array.isArray(items.announcements)) {
    state.announcements = items.announcements.map(normalizeRow);
    state.lastRefreshAt.announcements = loadedAt;
  }
  if (Array.isArray(items.liveCards)) {
    state.liveCards = items.liveCards.map(normalizeRow);
    state.lastRefreshAt.liveCards = loadedAt;
  }
  if (Array.isArray(items.featureFlags)) {
    state.featureFlags = items.featureFlags.map(normalizeRow);
    state.lastRefreshAt.featureFlags = loadedAt;
  }
  if (items.messageCenterSettings !== undefined) {
    state.messageCenterSettings = items.messageCenterSettings ? normalizeRow(items.messageCenterSettings) : null;
  }
}

function loadRuntimeBundleCache() {
  const cached = readJsonStorage(runtimeBundleStorageKey(), null);
  if (!cached || typeof cached !== 'object') return false;
  applyRuntimeBundleItems(cached.items || {});
  state.runtimeBundleVersions = cached.versions || null;
  state.runtimeBundleLoadedAt = Number(cached.loadedAt || 0);
  if (cached.runtimeConfig) {
    state.runtimeConfig = deepMerge(state.runtimeConfig, cached.runtimeConfig);
  }
  return true;
}

function saveRuntimeBundleCache(items, versions) {
  state.runtimeBundleVersions = versions || state.runtimeBundleVersions;
  state.runtimeBundleLoadedAt = Date.now();
  writeJsonStorage(runtimeBundleStorageKey(), {
    versions: state.runtimeBundleVersions,
    loadedAt: state.runtimeBundleLoadedAt,
    runtimeConfig: state.runtimeConfig,
    items: {
      surveys: state.surveys,
      announcements: state.announcements,
      liveCards: state.liveCards,
      featureFlags: state.featureFlags,
      messageCenterSettings: state.messageCenterSettings,
      ...items,
    },
  });
}

function runtimeBundleTtlMs() {
  return Math.max(
    Number(runtimeConfigValue(['cache', 'surveysTtlMs'], 15 * 60_000)),
    Number(runtimeConfigValue(['cache', 'announcementsTtlMs'], 15 * 60_000)),
    Number(runtimeConfigValue(['cache', 'liveCardsTtlMs'], 15 * 60_000)),
    Number(runtimeConfigValue(['cache', 'featureFlagsTtlMs'], 5 * 60_000)),
  );
}

async function refreshRuntimeBundle(force = false) {
  requireInitialized();
  const hasBundleData =
    state.surveys.length > 0 ||
    state.announcements.length > 0 ||
    state.liveCards.length > 0 ||
    state.featureFlags.length > 0;
  if (!force && hasBundleData && Date.now() - state.runtimeBundleLoadedAt < runtimeBundleTtlMs()) {
    return true;
  }
  const data = await executeGateway('get_runtime_bundle', {
    knownVersions: force ? {} : state.runtimeBundleVersions || {},
  });
  if (data.notModified) {
    state.runtimeBundleVersions = data.versions || state.runtimeBundleVersions;
    state.runtimeBundleLoadedAt = Date.now();
    saveRuntimeBundleCache({}, state.runtimeBundleVersions);
    return true;
  }
  const items = data.items || {};
  applyRuntimeBundleItems(items);
  saveRuntimeBundleCache(items, data.versions || null);
  return true;
}

async function initialize(apiKey, environment = 'production', options = {}) {
  assertBrowser();
  state.apiKey = nonEmptyString(apiKey, 'initialize(apiKey)');
  state.environment = nonEmptyString(environment, 'initialize(environment)');
  state.endpoint = options.endpoint || DEFAULT_ENDPOINT;
  state.projectId = options.projectId || CENTRAL_PROJECT_ID;
  state.gatewayFunctionId = options.gatewayFunctionId || RUNTIME_GATEWAY_FUNCTION_ID;
  seedIdentity();
  state.sessionId = randomId('session');
  state.sessionStartedAt = Date.now();

  const data = await executeGateway(
    'bootstrap',
    { apiKey: state.apiKey, environment: state.environment },
    { includeSessionToken: false },
  );
  state.config = {
    ...objectValue(options.workspaceConfig),
    ...objectValue(data.config),
  };
  state.runtimeConfig = deepMerge(
    deepMerge(DEFAULT_RUNTIME_CONFIG, objectValue(options.runtimeConfig)),
    data.runtimeConfig || {},
  );
  state.sessionToken = data.sessionToken || null;
  state.initialized = true;
  loadRuntimeBundleCache();
  restoreDurableQueues();

  await executeGateway('start_session', { snapshot: buildSnapshot() });
  await refreshRuntimeBundle(false).catch(() => Promise.allSettled([
    refreshFeatureFlags(true),
    refreshSurveys(true),
    refreshAnnouncements(true),
    refreshLiveCards(true),
  ]));
  await trackEvent('web_sdk_initialized', { sdk_version: SDK_VERSION, url: location.href }, 'system');

  if (state.timers.size === 0) {
    scheduleTimer(
      () => void flush(),
      Number(runtimeConfigValue(['events', 'flushIntervalMs'], FLUSH_INTERVAL_MS)) || FLUSH_INTERVAL_MS,
    );
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flush({ force: true });
        void flushRuntimeTelemetry({ force: true, silent: true });
      }
    });
    window.addEventListener('beforeunload', () => {
      void flush({ force: true, useBeacon: true });
      void flushRuntimeTelemetry({ force: true, silent: true, useBeacon: true });
    });
  }

  return 'ready';
}

function normalizeSdkConfig(config) {
  const value = objectValue(config);
  const appwrite = objectValue(value.appwrite || {});
  return {
    apiKey: nonEmptyString(value.apiKey, 'initializeWithConfig(config.apiKey)'),
    environment: value.environment || 'production',
    endpoint: appwrite.endpoint || value.endpoint || DEFAULT_ENDPOINT,
    projectId: appwrite.projectId || value.projectId || CENTRAL_PROJECT_ID,
    gatewayFunctionId:
      appwrite.gatewayFunctionId || value.gatewayFunctionId || RUNTIME_GATEWAY_FUNCTION_ID,
  };
}

async function initializeWithConfig(config, overrides = {}) {
  const normalized = normalizeSdkConfig({
    ...objectValue(config),
    ...objectValue(overrides),
    appwrite: {
      ...objectValue(objectValue(config).appwrite || {}),
      ...objectValue(objectValue(overrides).appwrite || {}),
    },
  });
  return initialize(normalized.apiKey, normalized.environment, {
    endpoint: normalized.endpoint,
    projectId: normalized.projectId,
    gatewayFunctionId: normalized.gatewayFunctionId,
    runtimeConfig: objectValue(config).runtime,
    workspaceConfig: objectValue(config).workspace,
  });
}

async function initializeFromConfigUrl(url, overrides = {}) {
  assertBrowser();
  const response = await fetch(nonEmptyString(url, 'initializeFromConfigUrl(url)'), {
    credentials: 'same-origin',
    cache: 'no-cache',
  });
  if (!response.ok) {
    throw new Error(`Unable to load AppRainier config from ${url}: HTTP ${response.status}`);
  }
  return initializeWithConfig(await response.json(), overrides);
}

async function identify(userId, traits = {}) {
  requireInitialized();
  state.identifiedUserId = nonEmptyString(userId, 'identify(userId)');
  state.userType = 'registered';
  state.userProperties = { ...state.userProperties, ...objectValue(traits) };
  persistIdentity();
  const result = await executeGateway('identify_user', {
    snapshot: buildSnapshot(),
    identifiedUserId: state.identifiedUserId,
    traits: objectValue(traits),
  });
  if (result.profileId) {
    state.profileId = result.profileId;
    persistIdentity();
  }
  return true;
}

async function resetUser(reason = 'manual_reset') {
  requireInitialized();
  await trackEvent('user_reset', { reason }, 'system');
  state.identifiedUserId = null;
  state.profileId = randomId('prf');
  state.anonymousId = randomId('anonymous');
  state.userType = 'guest';
  state.userProperties = {};
  state.customProperties = {};
  persistIdentity();
  await syncUserState(false);
  return true;
}

async function setUserProfile(profile) {
  requireInitialized();
  const value = objectValue(profile);
  const userId = nonEmptyString(value.userId, 'setUserProfile(userId)');
  state.identifiedUserId = userId;
  state.userType = value.userType || 'registered';
  state.userProperties = { ...state.userProperties, ...objectValue(value.userProperties) };
  state.appProperties = { ...state.appProperties, ...objectValue(value.appProperties) };
  state.deviceProperties = { ...state.deviceProperties, ...objectValue(value.deviceProperties) };
  state.customProperties = { ...state.customProperties, ...objectValue(value.customProperties) };
  persistIdentity();
  await syncUserState(false);
  return true;
}

async function setProperty(bucket, key, value) {
  requireInitialized();
  bucket[nonEmptyString(key, 'setProperty(key)')] = value;
  persistIdentity();
  await syncUserState(false).catch(() => false);
  return true;
}

async function setUserType(userType) {
  requireInitialized();
  state.userType = nonEmptyString(userType, 'setUserType(userType)');
  persistIdentity();
  await syncUserState(false).catch(() => false);
  return true;
}

async function trackEvent(eventName, properties = {}, eventType = 'custom') {
  requireInitialized();
  const normalizedEventName = nonEmptyString(eventName, 'trackEvent(eventName)');
  const normalizedEventType = eventType || 'custom';
  if (!shouldKeepEvent(normalizedEventName, normalizedEventType)) return false;
  const eventId = randomId('evt');
  const eventProperties = {
    ...objectValue(properties),
    anonymous_id: state.anonymousId,
    platform: 'web',
    runtime: 'browser',
    url: location.href,
  };
  state.eventQueue.push({
    id: eventId,
    event_id: eventId,
    event_name: normalizedEventName,
    event_type: normalizedEventType,
    user_id: getEffectiveUserId(),
    session_id: state.sessionId,
    device_id: state.deviceId,
    bundle_or_package_id: location.hostname || 'web',
    properties: stringifySafe(eventProperties),
    user_properties: stringifySafe(state.userProperties),
    app_properties: stringifySafe(state.appProperties),
    device_properties: stringifySafe(state.deviceProperties),
    timestamp: nowIso(),
  });
  const maxQueueSize = Number(runtimeConfigValue(['events', 'maxQueueSize'], 500));
  if (state.eventQueue.length > maxQueueSize) {
    state.eventQueue.splice(0, state.eventQueue.length - maxQueueSize);
  }
  persistDurableQueues();
  state.eventFlushPausedAfterFailure = false;
  if (state.eventQueue.length >= Number(runtimeConfigValue(['events', 'batchSize'], 50))) {
    await flush();
  }
  return true;
}

async function flush(options = {}) {
  if (!state.initialized || state.eventQueue.length === 0) return true;
  if (!options.force && state.eventFlushPausedAfterFailure) return false;
  const batchSize = options.force
    ? state.eventQueue.length
    : Math.min(Number(runtimeConfigValue(['events', 'batchSize'], 50)), state.eventQueue.length);
  const items = state.eventQueue.splice(0, batchSize);
  persistDurableQueues();
  if (options.useBeacon) {
    void executeGatewayKeepalive('track_event_batch', { items });
    return true;
  }
  try {
    await executeGateway('track_event_batch', { items });
    state.eventFlushPausedAfterFailure = false;
    persistDurableQueues();
    return true;
  } catch (error) {
    state.eventQueue.unshift(...items.slice(-50));
    persistDurableQueues();
    if (!options.force) state.eventFlushPausedAfterFailure = true;
    if (!options.silent) console.warn('[AppRainier] Failed to flush events', error);
    return false;
  }
}

function enqueueRuntimeTelemetry(action, payload = {}) {
  if (!state.initialized) return false;
  state.runtimeTelemetryQueue.push({ action, payload });
  if (state.runtimeTelemetryQueue.length > 40) {
    state.runtimeTelemetryQueue.splice(0, state.runtimeTelemetryQueue.length - 40);
  }
  persistDurableQueues();
  if (state.runtimeTelemetryQueue.length >= 40) {
    void flushRuntimeTelemetry({ force: true });
    return true;
  }
  if (!state.runtimeTelemetryTimer) {
    state.runtimeTelemetryTimer = window.setTimeout(() => {
      state.runtimeTelemetryTimer = null;
      void flushRuntimeTelemetry();
    }, Number(runtimeConfigValue(['events', 'flushIntervalMs'], 120_000)) || 120_000);
  }
  return true;
}

async function flushRuntimeTelemetry(options = {}) {
  if (!state.initialized || state.runtimeTelemetryQueue.length === 0) return true;
  if (state.runtimeTelemetryTimer) {
    window.clearTimeout(state.runtimeTelemetryTimer);
    state.runtimeTelemetryTimer = null;
  }
  const batchSize = options.force
    ? state.runtimeTelemetryQueue.length
    : Math.min(40, state.runtimeTelemetryQueue.length);
  const items = state.runtimeTelemetryQueue.splice(0, batchSize);
  persistDurableQueues();
  if (options.useBeacon) {
    void executeGatewayKeepalive('track_runtime_telemetry_batch', { items });
    return true;
  }
  try {
    await executeGateway('track_runtime_telemetry_batch', { items });
    persistDurableQueues();
    return true;
  } catch (error) {
    state.runtimeTelemetryQueue.unshift(...items.slice(-40));
    persistDurableQueues();
    if (!options.silent) console.warn('[AppRainier] Failed to flush runtime telemetry', error);
    return false;
  }
}

function restoreDurableQueues() {
  const eventQueue = readJsonStorage('eventQueue.v1', []);
  const telemetryQueue = readJsonStorage('runtimeTelemetryQueue.v1', []);
  if (Array.isArray(eventQueue) && eventQueue.length > 0) {
    state.eventQueue = eventQueue.slice(-Number(runtimeConfigValue(['events', 'maxQueueSize'], 500)));
  }
  if (Array.isArray(telemetryQueue) && telemetryQueue.length > 0) {
    state.runtimeTelemetryQueue = telemetryQueue.slice(-40);
  }
}

function persistDurableQueues() {
  writeJsonStorage(
    'eventQueue.v1',
    state.eventQueue.slice(-Number(runtimeConfigValue(['events', 'maxQueueSize'], 500))),
  );
  writeJsonStorage('runtimeTelemetryQueue.v1', state.runtimeTelemetryQueue.slice(-40));
}

function normalizedTrackingEventName(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parsedObject(value) {
  return objectValue(parseJson(value, value));
}

function announcementAnalytics(announcement) {
  const structure = parseStructure(announcement);
  const config = parseConfig(announcement);
  return {
    ...parsedObject(config.analytics),
    ...parsedObject(structure.analytics),
    ...parsedObject(announcement?.analytics),
  };
}

function announcementIdValue(announcement) {
  return valueToString(
    announcement?.$id ||
      announcement?.id ||
      announcement?.announcementId ||
      announcement?.bannerId ||
      eventTargetFor(announcement) ||
      '',
  );
}

function announcementNameValue(announcement) {
  return valueToString(
    announcement?.name ||
      announcement?.title ||
      parseStructure(announcement).title ||
      'Announcement',
  );
}

function announcementTemplateId(announcement) {
  return valueToString(announcement?.templateId || parseStructure(announcement).templateId || '');
}

function announcementEventProperties(announcement, properties = {}) {
  const id = announcementIdValue(announcement);
  const name = announcementNameValue(announcement);
  return {
    ...objectValue(properties),
    banner_id: id,
    banner_name: name,
    announcement_id: id,
    announcement_name: name,
    bannerId: id,
    bannerName: name,
    announcementId: id,
    announcementName: name,
    template_id: announcementTemplateId(announcement),
    event_trigger_id: valueToString(eventTargetFor(announcement) || ''),
    organization_id: valueToString(announcement?.organizationId || ''),
    project_id: valueToString(announcement?.projectId || ''),
    app_id: valueToString(announcement?.appId || ''),
    platform: 'web',
  };
}

async function trackAnnouncementEvent(eventName, announcement, properties = {}) {
  const normalizedName = normalizedTrackingEventName(eventName);
  if (!normalizedName) return false;
  try {
    await trackEvent(normalizedName, announcementEventProperties(announcement, properties), 'announcement');
    return true;
  } catch (error) {
    console.warn('[AppRainier] Failed to track announcement event', error);
    return false;
  }
}

async function trackAnnouncementImpression(announcement, eventName) {
  const analytics = announcementAnalytics(announcement);
  const customImpression = normalizedTrackingEventName(analytics.impressionEvent);
  if (customImpression) {
    await trackAnnouncementEvent(customImpression, announcement, { event_name: eventName, eventName });
  }
  await trackAnnouncementEvent('announcement_impression', announcement, {
    event_name: eventName,
    eventName,
    interaction_outcome: 'viewed',
  });
}

function announcementCompletionTime(announcement) {
  const shownAt = state.announcementShownAt.get(announcementIdValue(announcement));
  if (!Number.isFinite(shownAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - shownAt) / 1000));
}

async function trackAnnouncementResponseEvents(announcement, eventName, responses, completed, responseId = '') {
  const interactionProps = {
    response_id: responseId,
    responses_count: Object.keys(objectValue(responses)).length,
    score: 0,
    event_name: eventName,
    eventName,
    completion_time: announcementCompletionTime(announcement),
  };
  if (responses.action != null) interactionProps.button_role = responses.action;
  if (responses.button_clicked != null) interactionProps.button_clicked = responses.button_clicked;
  if (responses.page_index != null) interactionProps.page_index = responses.page_index;
  if (responses.page_title != null) interactionProps.page_title = responses.page_title;
  if (responses.deep_link != null) interactionProps.deep_link = responses.deep_link;

  if (completed) {
    await trackAnnouncementEvent('announcement_submitted', announcement, {
      ...interactionProps,
      interaction_outcome: 'positive',
    });
    const analytics = announcementAnalytics(announcement);
    for (const analyticsEvent of [analytics.submitEvent, analytics.responseEvent]) {
      const customEvent = normalizedTrackingEventName(analyticsEvent);
      if (customEvent) await trackAnnouncementEvent(customEvent, announcement, responses);
    }
  } else {
    await trackAnnouncementEvent('announcement_cancelled', announcement, {
      ...interactionProps,
      interaction_outcome: interactionProps.button_clicked === 'dismissed' ? 'dismissed' : 'negative',
    });
  }
}

function isCurrentlyScheduled(item) {
  const start = item.scheduleStart || item.startTime;
  const end = item.scheduleEnd || item.endTime;
  const now = Date.now();
  if (start && new Date(start).getTime() > now) return false;
  if (end && new Date(end).getTime() < now) return false;
  return true;
}

function passBasicTargeting(item) {
  const targeting = parseTargeting(item);
  const platforms = targeting.platforms || targeting.userPlatforms;
  if (Array.isArray(platforms) && platforms.length > 0) {
    const normalized = platforms.map((value) => String(value).toLowerCase());
    const isLegacyNativeAll =
      normalized.includes('ios') &&
      normalized.includes('android') &&
      normalized.every((value) => ['ios', 'android', 'mobile'].includes(value));
    if (!normalized.includes('web') && !normalized.includes('browser') && !normalized.includes('all') && !isLegacyNativeAll) {
      return false;
    }
  }
  const audience = String(targeting.audience || '').toLowerCase();
  if (audience === 'registered' && !state.identifiedUserId) return false;
  if (audience === 'anonymous' && state.identifiedUserId) return false;
  return true;
}

function matchesTrigger(item, triggerId) {
  return triggerMatchScore(item, triggerId) > 0;
}

function triggerMatchScore(item, triggerId) {
  const requestedRaw = normalizeTriggerExact(triggerId);
  const requested = normalizeTriggerAlias(triggerId);
  let bestScore = 0;
  for (const candidate of eventTargetsFor(item)) {
    const candidateRaw = normalizeTriggerExact(candidate);
    const normalizedCandidate = normalizeTriggerAlias(candidate);
    if (candidateRaw === requestedRaw) bestScore = Math.max(bestScore, candidate === item?.eventTriggerId ? 120 : 100);
    if (normalizedCandidate === requested) bestScore = Math.max(bestScore, 50);
    if (normalizedCandidate.includes(requested) || requested.includes(normalizedCandidate)) bestScore = Math.max(bestScore, 10);
  }
  return bestScore;
}

function normalizeTriggerExact(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
}

function normalizeTriggerAlias(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_\-\s]+/g, '')
    .replace(/announcements?/g, '')
    .replace(/banners?/g, '')
    .replace(/prompts?/g, '')
    .replace(/screens?/g, '')
    .trim();
}

async function refreshSurveys(force = false) {
  requireInitialized();
  if (!shouldRefresh('surveys', runtimeConfigValue(['cache', 'surveysTtlMs'], 15 * 60_000), force) && state.surveys.length > 0) return true;
  if (await refreshRuntimeBundle(force).catch(() => false)) return true;
  const data = await executeGateway('get_surveys');
  state.surveys = (data.items || []).map(normalizeRow);
  return true;
}

async function canShowSurvey(eventName) {
  requireInitialized();
  await refreshSurveys(false);
  return Boolean(findSurvey(eventName));
}

function findSurvey(eventName) {
  return state.surveys
    .map((survey) => ({ survey, score: triggerMatchScore(survey, eventName) }))
    .filter(
      ({ survey, score }) =>
        score > 0 &&
        survey.status === 'published' &&
        isCurrentlyScheduled(survey) &&
        passBasicTargeting(survey),
    )
    .sort((a, b) => b.score - a.score)[0]?.survey || null;
}

async function showSurvey(eventName) {
  requireInitialized();
  await refreshSurveys(false);
  const survey = findSurvey(nonEmptyString(eventName, 'showSurvey(eventName)'));
  if (!survey) return false;
  renderSurveyDialog(survey, eventName);
  await trackEvent('survey_displayed', { survey_id: survey.$id, event_name: eventName }, 'survey');
  return true;
}

async function refreshAnnouncements(force = false) {
  requireInitialized();
  if (!shouldRefresh('announcements', runtimeConfigValue(['cache', 'announcementsTtlMs'], 15 * 60_000), force) && state.announcements.length > 0) return true;
  if (await refreshRuntimeBundle(force).catch(() => false)) return true;
  const data = await executeGateway('get_announcements_banners');
  state.announcements = (data.items || []).map(normalizeRow);
  return true;
}

async function canShowAnnouncement(eventName) {
  requireInitialized();
  await refreshAnnouncements(false);
  return Boolean(findAnnouncement(eventName));
}

function findAnnouncement(eventName) {
  return state.announcements
    .map((announcement) => ({ announcement, score: triggerMatchScore(announcement, eventName) }))
    .filter(
      ({ announcement, score }) =>
        score > 0 &&
        announcement.status === 'published' &&
        isCurrentlyScheduled(announcement) &&
        passBasicTargeting(announcement),
    )
    .sort((a, b) => b.score - a.score)[0]?.announcement || null;
}

async function showAnnouncement(eventName) {
  requireInitialized();
  await refreshAnnouncements(false);
  const trigger = nonEmptyString(eventName, 'showAnnouncement(eventName)');
  let announcement = findAnnouncement(trigger);
  if (!announcement) {
    await refreshAnnouncements(true);
    announcement = findAnnouncement(trigger);
  }
  if (!announcement) return false;
  state.announcementShownAt.set(announcementIdValue(announcement), Date.now());
  renderAnnouncementDialog(announcement, trigger);
  await trackAnnouncementImpression(announcement, trigger);
  return true;
}

async function refreshLiveCards(force = true) {
  requireInitialized();
  if (!shouldRefresh('liveCards', runtimeConfigValue(['cache', 'liveCardsTtlMs'], 15 * 60_000), force) && state.liveCards.length > 0) return true;
  if (await refreshRuntimeBundle(force).catch(() => false)) return true;
  const data = await executeGateway('get_live_cards');
  state.liveCards = (data.items || []).map(normalizeRow);
  return true;
}

async function getLiveCard(triggerId) {
  requireInitialized();
  await refreshLiveCards(false);
  const card = findLiveCard(nonEmptyString(triggerId, 'getLiveCard(triggerId)'));
  return card || null;
}

function findLiveCard(triggerId) {
  return state.liveCards.find(
    (card) =>
      matchesTrigger(card, triggerId) &&
      (card.status === 'live' || card.status === 'published') &&
      isCurrentlyScheduled(card) &&
      passBasicTargeting(card),
  );
}

async function hasLiveCard(triggerId) {
  return Boolean(await getLiveCard(triggerId));
}

async function createLiveCard(triggerId, options = {}) {
  requireInitialized();
  const card = await getLiveCard(triggerId);
  if (!card) {
    const empty = document.createElement('div');
    empty.className = 'apprainier-live-card-empty';
    empty.textContent = `No eligible card for ${triggerId}`;
    return empty;
  }
  const element = renderLiveCard(card, triggerId, options);
  await trackLiveCardImpression(card);
  return element;
}

async function mountLiveCard(target, triggerId, options = {}) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error('AppRainier.mountLiveCard target was not found.');
  const element = await createLiveCard(triggerId, options);
  host.replaceChildren(element);
  return element;
}

async function refreshFeatureFlags(force = false) {
  requireInitialized();
  if (!shouldRefresh('featureFlags', runtimeConfigValue(['cache', 'featureFlagsTtlMs'], 5 * 60_000), force) && state.featureFlags.length > 0) return true;
  if (await refreshRuntimeBundle(force).catch(() => false)) return true;
  const data = await executeGateway('get_feature_flags');
  state.featureFlags = (data.items || []).map(normalizeRow);
  return true;
}

function findFeatureFlag(flagKey) {
  return state.featureFlags.find((flag) => flag.key === flagKey || flag.name === flagKey);
}

function parseFlagJson(flag, key, fallback) {
  return parseJson(flag?.[key], fallback) ?? fallback;
}

function hashBucket(source) {
  let hash = 2166136261;
  for (const char of source) {
    hash ^= char.charCodeAt(0);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0) % 100;
}

function parseDefaultValue(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw !== 'string') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (!Number.isNaN(Number(raw)) && raw.trim() !== '') return Number(raw);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function evaluateRules(rules = []) {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  return rules.every((rule) => {
    const field = rule.field || rule.property || rule.key;
    if (!field) return true;
    const expected = rule.value;
    const actual =
      state.userProperties[field] ??
      state.appProperties[field] ??
      state.deviceProperties[field] ??
      state.customProperties[field];
    const op = rule.operator || rule.op || 'equals';
    if (op === 'not_equals') return actual !== expected;
    if (op === 'contains') return String(actual ?? '').includes(String(expected ?? ''));
    if (op === 'exists') return actual != null;
    return String(actual) === String(expected);
  });
}

function chooseVariation(flag) {
  const variations = parseFlagJson(flag, 'variations', []);
  if (!Array.isArray(variations) || variations.length === 0) return null;
  const bucket = hashBucket(`${flag.key}:${getEffectiveUserId()}:${state.deviceId}`);
  let cursor = 0;
  for (const variation of variations) {
    cursor += Number(variation.weight ?? 100 / variations.length);
    if (bucket < cursor) return variation;
  }
  return variations[0];
}

async function getFeatureFlag(flagKey, defaultValue = null) {
  requireInitialized();
  await refreshFeatureFlags(false);
  const flag = findFeatureFlag(nonEmptyString(flagKey, 'getFeatureFlag(flagKey)'));
  if (!flag) return defaultValue;

  const metadata = parseFlagJson(flag, 'metadata', {});
  const audienceVariants = Array.isArray(metadata.audienceVariants)
    ? [...metadata.audienceVariants].sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0))
    : [];
  for (const group of audienceVariants) {
    if (evaluateRules(group.rules || [])) {
      await trackFeatureEvaluation(flag, group.value, group.id, group.name, 'audience_variant');
      return group.value;
    }
  }

  const targetingRules = parseFlagJson(flag, 'targetingRules', []);
  if (!evaluateRules(targetingRules)) {
    await trackFeatureEvaluation(flag, defaultValue, null, null, 'targeting_miss');
    return defaultValue;
  }

  const rollout = parseFlagJson(flag, 'rolloutConfig', {});
  if (Number.isFinite(rollout.percentage) && hashBucket(`${flag.key}:${getEffectiveUserId()}`) >= Number(rollout.percentage)) {
    await trackFeatureEvaluation(flag, defaultValue, null, null, 'rollout_miss');
    return defaultValue;
  }

  if (flag.type === 'experiment' || flag.experimentStatus) {
    const variation = chooseVariation(flag);
    const value = variation?.value ?? parseDefaultValue(flag.defaultValue, defaultValue);
    await trackFeatureEvaluation(flag, value, variation?.id, variation?.name, 'experiment');
    return value;
  }

  const value = parseDefaultValue(flag.defaultValue, defaultValue);
  await trackFeatureEvaluation(flag, value, null, null, 'default');
  return value;
}

async function getExperimentVariation(flagKey) {
  requireInitialized();
  await refreshFeatureFlags(false);
  const flag = findFeatureFlag(nonEmptyString(flagKey, 'getExperimentVariation(flagKey)'));
  return flag ? chooseVariation(flag) : null;
}

async function getExperimentConfig(flagKey) {
  requireInitialized();
  await refreshFeatureFlags(false);
  const flag = findFeatureFlag(nonEmptyString(flagKey, 'getExperimentConfig(flagKey)'));
  return flag ? parseFlagJson(flag, 'experimentConfig', null) : null;
}

async function trackFeatureEvaluation(flag, value, variationId, variationName, reason) {
  enqueueRuntimeTelemetry('track_feature_flag_evaluation', {
    flagId: flag.$id,
    flagKey: flag.key,
    userId: getEffectiveUserId(),
    deviceId: state.deviceId,
    sessionId: state.sessionId,
    value: valueToString(value),
    variationId: variationId || null,
    variationName: variationName || null,
    reason,
    context: {
      platform: 'web',
      url: location.href,
    },
    latency: 0,
    evaluatedAt: nowIso(),
  });
}

async function trackExperimentExposure(flagKey, context = {}) {
  requireInitialized();
  const variation = await getExperimentVariation(flagKey);
  const flag = findFeatureFlag(flagKey);
  if (!flag) return false;
  enqueueRuntimeTelemetry('track_feature_flag_exposure', {
    flagId: flag.$id,
    variationId: variation?.id || null,
    variationName: variation?.name || null,
    userId: getEffectiveUserId(),
    deviceId: state.deviceId,
    sessionId: state.sessionId,
    context: objectValue(context),
    exposedAt: nowIso(),
  });
  return true;
}

async function trackExperimentConversion(flagKey, options = {}) {
  return trackEvent('experiment_conversion', {
    flag_key: flagKey,
    goal_id: options.goalId || null,
    value: options.value || null,
    ...(objectValue(options.context)),
  }, 'conversion');
}

async function trackLiveCardImpression(card) {
  enqueueRuntimeTelemetry('track_live_card_impression', {
    liveCardId: card.$id,
    userId: getEffectiveUserId(),
    sessionId: state.sessionId,
    deviceId: state.deviceId,
    appVersion: valueToString(state.appProperties.app_version || '1'),
    timestamp: nowIso(),
    metadata: stringifySafe({ runtime: 'web' }),
    language: navigator.language,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
    deviceModel: valueToString(state.deviceProperties.device_model || 'web'),
    osVersion: valueToString(state.deviceProperties.os_version || navigator.platform),
    platform: 'web',
  });
}

async function trackLiveCardClick(card, payload) {
  await executeGateway('track_live_card_click', {
    liveCardId: card.$id,
    userId: getEffectiveUserId(),
    sessionId: state.sessionId,
    deviceId: state.deviceId,
    buttonType: payload.buttonType || 'primary',
    actionType: 'deeplink',
    actionTarget: payload.actionTarget || null,
    carouselItemIndex: payload.carouselItemIndex ?? null,
    position: payload.position || 'web',
    timestamp: nowIso(),
    timeToAction: 0,
    appVersion: valueToString(state.appProperties.app_version || '1'),
    platform: 'web',
    metadata: stringifySafe({ runtime: 'web' }),
  }).catch(() => false);
}

async function refreshMessageCenter() {
  requireInitialized();
  if (!shouldRefresh('messageCenter', runtimeConfigValue(['messageCenter', 'foregroundRefreshTtlMs'], 60_000), false) && state.messageCenterSettings) return true;
  const userId = getEffectiveUserId();
  const settings = await executeGateway('get_message_center_settings')
    .then((value) => ({ status: 'fulfilled', value }))
    .catch((reason) => ({ status: 'rejected', reason }));
  if (settings.status === 'fulfilled') state.messageCenterSettings = normalizeRow(settings.value.item || {});

  if (!isMessageCenterAvailable()) {
    state.messageThreads = [];
    state.messageAnnouncements = [];
    return true;
  }

  const requests = [];
  if (isMessageCenterChatEnabled()) {
    requests.push(
      executeGateway('get_message_threads', { userId, anonymousId: state.anonymousId, limit: 50 })
        .then((value) => { state.messageThreads = (value.items || []).map(normalizeRow); })
        .catch(() => { state.messageThreads = []; })
    );
  } else {
    state.messageThreads = [];
  }

  if (isMessageCenterAnnouncementsEnabled()) {
    requests.push(
      executeGateway('get_message_announcements', { userId, anonymousId: state.anonymousId, limit: 50 })
        .then((value) => { state.messageAnnouncements = (value.items || []).map(normalizeRow); })
        .catch(() => { state.messageAnnouncements = []; })
    );
  } else {
    state.messageAnnouncements = [];
  }

  await Promise.allSettled(requests);
  return true;
}

async function getUnreadMessageCount() {
  requireInitialized();
  await refreshMessageCenter();
  return isMessageCenterChatEnabled() ? getUnreadMessageCountSync() : 0;
}

async function openMessageCenter(options = {}) {
  requireInitialized();
  await refreshMessageCenter();
  if (!isMessageCenterAvailable()) {
    console.warn('AppRainier Message Center is disabled for this workspace/environment.');
    return false;
  }
  renderMessageCenter(options);
  return true;
}

function injectStyles() {
  if (document.getElementById('apprainier-web-sdk-styles')) return;
  const style = document.createElement('style');
  style.id = 'apprainier-web-sdk-styles';
  style.textContent = `
    .apprainier-overlay{position:fixed;inset:0;z-index:2147483640;background:rgba(15,23,42,.48);display:flex;align-items:center;justify-content:center;padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .apprainier-dialog{position:relative;width:min(92vw,520px);max-height:88vh;overflow:auto;background:#fff;border-radius:28px;box-shadow:0 24px 90px rgba(15,23,42,.28);padding:28px;color:#111827}
    .apprainier-fullscreen{align-items:stretch;justify-content:stretch;padding:0;background:#fff}.apprainier-fullscreen .apprainier-dialog{width:100vw;max-width:none;min-height:100vh;border-radius:0;box-shadow:none;display:flex;flex-direction:column}
    .apprainier-title{margin:0 0 8px;font-size:28px;line-height:1.1;font-weight:850}.apprainier-subtitle{margin:0 0 18px;color:#64748b;font-size:17px;line-height:1.45}.apprainier-description{margin:0 0 18px;color:#334155;font-size:16px;line-height:1.5}
    .apprainier-close{position:absolute;top:18px;right:18px;width:38px;height:38px;border:0;border-radius:999px;background:rgba(148,163,184,.18);font-size:24px;cursor:pointer;color:#1f2937}
    .apprainier-buttons{display:flex;gap:14px;margin-top:22px}.apprainier-button{flex:1;border:0;border-radius:18px;padding:14px 18px;font-weight:800;font-size:16px;cursor:pointer}.apprainier-primary{background:var(--ar-button,var(--ar-ann-primary,#0f8f7f));color:var(--ar-button-text,#fff)}.apprainier-secondary{background:var(--ar-secondary,#f1f5f9);color:var(--ar-secondary-text,#334155)}
    .apprainier-ann-dialog{width:min(92vw,430px);padding:34px 28px 28px;border-radius:30px;background:var(--ar-ann-bg,#eaf8f6);border:1px solid rgba(15,23,42,.10);box-shadow:0 28px 86px rgba(15,23,42,.34);text-align:center}.apprainier-ann-dialog .apprainier-close{top:22px;right:22px;background:transparent;font-size:36px;line-height:1;color:rgba(15,23,42,.68)}.apprainier-ann-icon{width:86px;height:86px;margin:22px auto 24px;border-radius:28px;display:grid;place-items:center;color:var(--ar-ann-icon,#0f8f7f);background:color-mix(in srgb,var(--ar-ann-icon,#0f8f7f) 13%,white);border:2px solid color-mix(in srgb,var(--ar-ann-icon,#0f8f7f) 22%,transparent);box-shadow:inset 0 1px 0 rgba(255,255,255,.85),0 12px 26px rgba(15,23,42,.08)}.apprainier-ann-icon svg{width:42px;height:42px;display:block;fill:currentColor}.apprainier-ann-icon span{font-size:38px;line-height:1}.apprainier-ann-title{margin:0;color:var(--ar-ann-title,#151922);font-size:30px;line-height:1.14;font-weight:900;letter-spacing:-.035em}.apprainier-ann-subtitle{margin:14px 0 0;color:var(--ar-ann-subtitle,#5f6875);font-size:20px;line-height:1.35;font-weight:550}.apprainier-ann-panel{margin:26px 0 0;text-align:left;border:1px solid rgba(15,23,42,.13);border-radius:24px;background:rgba(255,255,255,.42);padding:20px 22px;box-shadow:inset 0 1px 0 rgba(255,255,255,.65)}.apprainier-ann-description{margin:0;color:var(--ar-ann-description,#20242b);font-size:18px;line-height:1.55}.apprainier-ann-list{margin:18px 0 0;padding:0;display:grid;gap:14px;list-style:none;color:var(--ar-ann-bullet-text,#20242b);font-size:18px;line-height:1.45}.apprainier-ann-list li{position:relative;padding-left:34px}.apprainier-ann-list li::before{content:"";position:absolute;left:2px;top:.58em;width:8px;height:8px;border-radius:999px;background:var(--ar-ann-bullet,#0f8f7f);box-shadow:0 0 0 3px color-mix(in srgb,var(--ar-ann-bullet,#0f8f7f) 10%,transparent)}.apprainier-ann-dialog .apprainier-buttons{margin-top:28px}.apprainier-ann-dialog .apprainier-button{min-height:58px;border-radius:20px;font-size:18px}.apprainier-ann-dialog .apprainier-primary{box-shadow:0 10px 24px color-mix(in srgb,var(--ar-ann-primary,#0f8f7f) 24%,transparent)}.apprainier-fullscreen .apprainier-ann-dialog{padding:clamp(32px,7vh,72px) clamp(24px,7vw,80px);border-radius:0;width:100vw;max-height:none;text-align:center}.apprainier-fullscreen .apprainier-ann-icon{width:clamp(104px,14vw,170px);height:clamp(104px,14vw,170px);border-radius:999px;margin-top:clamp(26px,5vh,64px)}.apprainier-fullscreen .apprainier-ann-title{font-size:clamp(34px,5vw,56px)}.apprainier-fullscreen .apprainier-ann-subtitle{font-size:clamp(20px,2.8vw,30px)}.apprainier-fullscreen .apprainier-ann-panel{max-width:760px;margin-left:auto;margin-right:auto}.apprainier-fullscreen .apprainier-buttons{max-width:760px;margin-left:auto;margin-right:auto;width:100%}
    .apprainier-field{margin:14px 0;color:var(--ar-text,#151922)}.apprainier-field label{display:block;font-weight:750;margin-bottom:8px;color:var(--ar-title,#151922)}.apprainier-textarea{width:100%;min-height:110px;border:1px solid var(--ar-input-border,#cbd5e1);border-radius:18px;background:var(--ar-input-bg,#fff);color:var(--ar-input-text,var(--ar-text,#151922));padding:14px;font:inherit;resize:vertical;box-sizing:border-box}.apprainier-textarea::placeholder{color:var(--ar-input-placeholder,var(--ar-muted,#64748b))}
    .apprainier-options{display:grid;gap:10px}.apprainier-option{border:1px solid var(--ar-choice-border,#cbd5e1);border-radius:16px;background:var(--ar-choice-bg,#fff);color:var(--ar-choice-text,var(--ar-text,#151922));padding:12px 14px;text-align:left;font:inherit;cursor:pointer}.apprainier-option[aria-pressed=true]{border-color:var(--ar-primary,#0f8f7f);background:var(--ar-choice-selected-bg,color-mix(in srgb,var(--ar-primary,#0f8f7f) 14%,white));color:var(--ar-choice-selected-text,var(--ar-primary,#047064));font-weight:800}
    .apprainier-rating{display:flex;gap:8px;flex-wrap:wrap}.apprainier-rating button{border:1px solid var(--ar-scale-unselected-border,#cbd5e1);background:var(--ar-scale-unselected-bg,#fff);color:var(--ar-scale-unselected-text,var(--ar-title,#151922));border-radius:999px;min-width:42px;height:42px;cursor:pointer;font:inherit}.apprainier-rating button[aria-pressed=true]{background:var(--ar-scale-selected-bg,var(--ar-primary,#0f8f7f));color:var(--ar-scale-selected-text,var(--ar-button-text,#fff));border-color:var(--ar-scale-selected-bg,var(--ar-primary,#0f8f7f))}
    .apprainier-survey-card{width:min(92vw,460px);box-sizing:border-box;background:var(--ar-card-bg,#eaf8f6);border-radius:24px;padding:24px;box-shadow:0 22px 70px rgba(15,23,42,.24);border:1px solid rgba(15,23,42,.08);color:var(--ar-text,#151922)}
    .apprainier-survey-card.compact{width:min(92vw,420px)}.apprainier-survey-card.wide{width:min(92vw,500px)}.apprainier-survey-card.multi-step{width:min(92vw,374px);padding:22px}.apprainier-survey-card.post-support{width:min(92vw,310px);padding:22px 20px;background:var(--ar-card-bg,#eaf8f6)}
    .apprainier-survey-header{text-align:center;margin:4px 0 24px}.apprainier-survey-header.start{text-align:left}.apprainier-survey-eyebrow{margin:0 0 12px;color:var(--ar-primary,#0f8f7f);font-size:13px;font-weight:800;letter-spacing:.01em}.apprainier-survey-title{margin:0 0 10px;color:var(--ar-title,#151922);font-size:25px;line-height:1.15;font-weight:900;letter-spacing:-.02em}.apprainier-survey-subtitle{margin:0;color:var(--ar-muted,#5f6875);font-size:17px;line-height:1.35;font-weight:500}.apprainier-survey-question-title{margin:8px 0 12px;color:var(--ar-title,#151922);font-size:17px;font-weight:850}.apprainier-survey-helper{margin:8px 0 0;color:var(--ar-muted,#5f6875);font-size:13px;font-weight:600}.apprainier-survey-count{justify-self:end;display:inline-flex;border-radius:999px;background:rgba(15,23,42,.06);padding:7px 12px;color:var(--ar-muted,#5f6875);font-size:13px;font-weight:800}
    .apprainier-survey-close{position:absolute;top:14px;right:14px;width:34px;height:34px;border:0;border-radius:999px;background:rgba(15,23,42,.06);color:#334155;font-size:18px;font-weight:900;cursor:pointer}.apprainier-survey-close:hover{background:rgba(15,23,42,.12)}
    .apprainier-survey-actions{display:flex;gap:14px;margin-top:24px;padding-bottom:10px}.apprainier-survey-btn{flex:1;min-height:52px;border:0;border-radius:17px;padding:12px 16px;font:inherit;font-size:16px;font-weight:850;cursor:pointer;transition:transform .16s ease,opacity .16s ease,background .16s ease}.apprainier-survey-btn:active{transform:scale(.985)}.apprainier-survey-primary{background:var(--ar-button,#0f8f7f);color:var(--ar-button-text,#fff)}.apprainier-survey-secondary{background:var(--ar-secondary,#f2f2f3);color:var(--ar-secondary-text,#343a40)}.apprainier-survey-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
    .apprainier-survey-textarea-wrap{position:relative}.apprainier-survey-textarea{width:100%;box-sizing:border-box;min-height:96px;max-height:160px;border:1px solid var(--ar-input-border,rgba(15,23,42,.18));border-radius:18px;background:var(--ar-input-bg,rgba(255,255,255,.56));padding:15px 16px;font:inherit;font-size:16px;line-height:1.35;color:var(--ar-input-text,var(--ar-text,#151922));resize:vertical;outline:none}.apprainier-survey-textarea::placeholder{color:var(--ar-input-placeholder,var(--ar-muted,#5f6875))}.apprainier-survey-textarea:focus{border-color:var(--ar-primary,#0f8f7f);box-shadow:0 0 0 3px color-mix(in srgb,var(--ar-primary,#0f8f7f) 18%,transparent)}.apprainier-char-count{display:inline-flex;margin-top:10px;float:right;border-radius:999px;background:rgba(15,23,42,.06);padding:7px 12px;color:var(--ar-muted,#5f6875);font-size:13px;font-weight:800}
    .apprainier-star-row{display:flex;justify-content:center;gap:8px;margin:20px 0 22px}.apprainier-star-btn{width:46px;height:46px;border:0;background:transparent;color:var(--ar-star-empty,#c9d1d1);font-size:40px;line-height:1;cursor:pointer;filter:drop-shadow(0 2px 2px rgba(15,23,42,.08))}.apprainier-star-btn.selected{color:var(--ar-star,#f6c945)}
    .apprainier-thumb-row{display:flex;gap:18px;justify-content:center;margin:18px 0 8px}.apprainier-thumb-card{flex:1;min-height:112px;border:1px solid rgba(15,23,42,.1);border-radius:22px;background:rgba(255,255,255,.58);display:grid;place-items:center;gap:8px;padding:16px;cursor:pointer;color:var(--ar-title,#151922);font-weight:800}.apprainier-thumb-card .icon{font-size:34px}.apprainier-thumb-card.selected.good{border-color:var(--ar-positive,var(--ar-primary,#12a87c));background:color-mix(in srgb,var(--ar-positive,var(--ar-primary,#12a87c)) 14%,white);color:var(--ar-positive-text,var(--ar-positive,var(--ar-primary,#087a5c)))}.apprainier-thumb-card.selected.bad{border-color:var(--ar-negative,#ef4444);background:color-mix(in srgb,var(--ar-negative,#ef4444) 12%,white);color:var(--ar-negative-text,var(--ar-negative,#bd2b2b))}
    .apprainier-scale-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:18px 0}.apprainier-scale-grid.csat{grid-template-columns:repeat(5,minmax(0,1fr))}.apprainier-scale-btn{min-height:43px;border:0;border-radius:13px;background:var(--ar-scale-unselected-bg,rgba(15,23,42,.06));color:var(--ar-scale-unselected-text,var(--ar-title,#151922));font-weight:900;font-size:15px;cursor:pointer}.apprainier-scale-btn.selected{background:var(--ar-scale-selected-bg,var(--ar-primary,#0f8f7f));color:var(--ar-scale-selected-text,var(--ar-button-text,#fff))}.apprainier-scale-labels{display:flex;justify-content:space-between;gap:14px;color:var(--ar-muted,#5f6875);font-size:13px;font-weight:700}
    .apprainier-choice-list{display:grid;gap:12px;margin-top:16px}.apprainier-choice-row{width:100%;border:1px solid var(--ar-choice-border,rgba(15,23,42,.14));border-radius:20px;background:var(--ar-choice-bg,rgba(255,255,255,.64));padding:15px 16px;text-align:left;font:inherit;display:flex;align-items:center;gap:13px;cursor:pointer;color:var(--ar-choice-text,var(--ar-title,#151922))}.apprainier-choice-row.disabled{opacity:.45;cursor:not-allowed}.apprainier-choice-row.selected{border-color:var(--ar-primary,#0f8f7f);background:var(--ar-choice-selected-bg,color-mix(in srgb,var(--ar-primary,#0f8f7f) 16%,white));color:var(--ar-choice-selected-text,var(--ar-primary,#0f8f7f))}.apprainier-choice-mark{width:23px;height:23px;flex:0 0 auto;border-radius:999px;border:2px solid var(--ar-choice-mark-border,rgba(95,104,117,.55));display:grid;place-items:center;font-size:12px;font-weight:900}.apprainier-choice-row.multi .apprainier-choice-mark{border-radius:7px}.apprainier-choice-row.selected .apprainier-choice-mark{background:var(--ar-primary,#0f8f7f);border-color:var(--ar-primary,#0f8f7f);color:var(--ar-button-text,#fff)}.apprainier-choice-copy{flex:1;min-width:0}.apprainier-choice-label{display:block;font-size:16px;font-weight:850}.apprainier-choice-desc{display:block;margin-top:4px;color:var(--ar-muted,#5f6875);font-size:13px;line-height:1.25}.apprainier-choice-pill{border-radius:999px;background:var(--ar-primary,#0f8f7f);color:var(--ar-button-text,#fff);padding:7px 10px;font-size:12px;font-weight:850}
    .apprainier-emoji-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:20px}.apprainier-emoji-card{border:1px solid var(--ar-choice-border,rgba(15,23,42,.12));border-radius:24px;background:var(--ar-choice-bg,rgba(255,255,255,.6));min-height:154px;padding:14px 10px;cursor:pointer;text-align:center;font:inherit;color:var(--ar-choice-text,var(--ar-title,#151922))}.apprainier-emoji-card.selected{border-color:var(--ar-primary,#0f8f7f);background:var(--ar-choice-selected-bg,color-mix(in srgb,var(--ar-primary,#0f8f7f) 13%,white));color:var(--ar-choice-selected-text,var(--ar-primary,#0f8f7f))}.apprainier-emoji-symbol{display:grid;place-items:center;width:64px;height:64px;margin:8px auto 12px;border-radius:999px;background:var(--ar-choice-icon-bg,rgba(255,255,255,.9));font-size:32px}.apprainier-emoji-label{font-size:15px;font-weight:850}
    .apprainier-step-progress{height:4px;border-radius:999px;background:rgba(15,23,42,.10);overflow:hidden;margin-bottom:16px}.apprainier-step-progress span{display:block;height:100%;border-radius:inherit;background:var(--ar-primary,#0f8f7f);transition:width .2s ease}.apprainier-support-meta{display:flex;justify-content:flex-end;margin:26px 2px 4px}.apprainier-support-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:18px}.apprainier-support-card{border:1px solid rgba(15,23,42,.16);border-radius:15px;background:rgba(255,255,255,.34);padding:14px 8px;min-height:178px;cursor:pointer;text-align:center;font:inherit;color:var(--ar-support-text,var(--ar-title,#151922));display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:7px}.apprainier-support-card.selected{border-color:var(--ar-support-accent,var(--ar-primary,#0f8f7f));background:color-mix(in srgb,var(--ar-support-accent,var(--ar-primary,#0f8f7f)) 12%,white);color:var(--ar-support-selected-text,var(--ar-button-text,#fff))}.apprainier-support-card .icon{width:54px;height:54px;border-radius:999px;background:color-mix(in srgb,var(--ar-support-accent,var(--ar-primary,#0f8f7f)) 10%,white);border:1px solid color-mix(in srgb,var(--ar-support-accent,var(--ar-primary,#0f8f7f)) 42%,rgba(15,23,42,.28));display:grid;place-items:center;font-size:27px;margin-bottom:5px}.apprainier-support-card.selected .icon{border-color:var(--ar-support-accent,var(--ar-primary,#0f8f7f))}.apprainier-support-card strong{font-size:15px}.apprainier-support-card .apprainier-choice-desc{font-size:13px;line-height:1.28;color:var(--ar-support-desc,var(--ar-muted,#5f6875))}.apprainier-support-card.selected .apprainier-choice-desc{color:var(--ar-support-selected-desc,var(--ar-support-selected-text,var(--ar-button-text,#fff)))}
    .apprainier-live-card{box-sizing:border-box;overflow:hidden;cursor:pointer;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;border:1px solid rgba(15,23,42,.06);box-shadow:var(--ar-live-shadow,0 10px 28px rgba(15,23,42,.10));background:var(--ar-live-bg,#fff);color:var(--ar-live-text,#0f172a)}
    .apprainier-live-list{display:flex;align-items:center;gap:14px;padding:16px 18px}
    .apprainier-live-icon{display:grid;place-items:center;flex:0 0 auto;background:rgba(255,255,255,.96);border-radius:999px;box-shadow:0 8px 18px rgba(15,23,42,.14);overflow:hidden}.apprainier-live-icon img{object-fit:contain;display:block}.apprainier-live-icon svg{display:block;fill:currentColor}.apprainier-live-copy{flex:1;min-width:0}.apprainier-live-title{font-weight:850;font-size:var(--ar-live-title-size,16px);line-height:1.18;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.apprainier-live-subtitle{margin-top:4px;color:#475569;font-size:var(--ar-live-subtitle-size,14px);line-height:1.28;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.apprainier-live-chevron{font-size:26px;line-height:1;color:#64748b;font-weight:700}
    .apprainier-live-carousel{display:block;position:relative;touch-action:pan-y;user-select:none;-webkit-user-select:none;cursor:grab}.apprainier-live-carousel.dragging{cursor:grabbing}.apprainier-carousel-media{position:relative;width:100%;height:100%;overflow:hidden;border-radius:inherit;background:var(--ar-live-bg,#fff)}.apprainier-carousel-track{height:100%;display:flex;will-change:transform;transition:transform 360ms cubic-bezier(.22,1,.36,1)}.apprainier-carousel-slide{position:relative;height:100%;flex:0 0 100%;background-size:cover;background-position:center}.apprainier-carousel-slide::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,23,42,.04) 25%,rgba(15,23,42,.74) 100%);pointer-events:none}.apprainier-carousel-slide-content{position:absolute;left:20px;right:20px;bottom:34px;z-index:1;display:grid;gap:6px;text-shadow:0 2px 10px rgba(0,0,0,.42)}.apprainier-carousel-slide-content .apprainier-live-title,.apprainier-carousel-slide-content .apprainier-live-subtitle{display:block;color:#fff;-webkit-line-clamp:unset}.apprainier-carousel-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:3;width:42px;height:42px;border:0;border-radius:999px;background:rgba(15,23,42,.48);color:#fff;display:grid;place-items:center;font-size:30px;line-height:1;cursor:pointer;box-shadow:0 10px 24px rgba(15,23,42,.20);backdrop-filter:blur(10px);transition:transform .16s ease,background .16s ease,opacity .16s ease}.apprainier-carousel-arrow:hover{background:rgba(15,23,42,.68);transform:translateY(-50%) scale(1.04)}.apprainier-carousel-arrow:active{transform:translateY(-50%) scale(.96)}.apprainier-carousel-arrow.prev{left:14px}.apprainier-carousel-arrow.next{right:14px}.apprainier-carousel-dots{position:absolute;left:20px;bottom:14px;z-index:2;display:flex;gap:7px}.apprainier-carousel-dots span{width:9px;height:9px;border-radius:999px;background:rgba(255,255,255,.42);transition:width .18s ease,background .18s ease;cursor:pointer;box-shadow:0 1px 6px rgba(15,23,42,.28)}.apprainier-carousel-dots span.active{width:28px;background:#fff}
    .apprainier-message-shell{position:fixed;inset:0;z-index:2147483640;background:radial-gradient(circle at 12% 8%,rgba(15,143,127,.14),transparent 28%),linear-gradient(180deg,#f8fffd 0%,#f8fafc 44%,#eef4f3 100%);color:#111827;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;overflow:hidden}.apprainier-message-header{position:relative;display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center;padding:28px clamp(20px,4vw,42px) 18px;background:rgba(255,255,255,.72);border-bottom:1px solid rgba(15,23,42,.08);box-shadow:0 16px 42px rgba(15,23,42,.06);backdrop-filter:blur(18px)}.apprainier-message-mark{width:58px;height:58px;border-radius:20px;display:grid;place-items:center;background:linear-gradient(135deg,#d8f1ec,#f2fbf8);color:#0f8f7f;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 14px 30px rgba(15,143,127,.16);font-size:27px}.apprainier-message-header h2{margin:0;font-size:clamp(28px,4vw,44px);line-height:1;font-weight:950;letter-spacing:-.045em}.apprainier-message-header p{margin:8px 0 0;color:#64748b;font-size:clamp(15px,1.8vw,18px);font-weight:560}.apprainier-message-close{border:0;background:rgba(15,23,42,.06);border-radius:999px;width:46px;height:46px;font-size:25px;line-height:1;cursor:pointer;color:#1f2937;transition:transform .16s ease,background .16s ease}.apprainier-message-close:hover{background:rgba(15,23,42,.12);transform:scale(1.04)}.apprainier-tabs{display:flex;gap:14px;padding:20px clamp(20px,4vw,42px);background:rgba(255,255,255,.42)}.apprainier-tab{flex:1;border:0;border-radius:24px;padding:18px 18px;font-weight:900;font-size:17px;cursor:pointer;color:#475569;background:rgba(255,255,255,.72);box-shadow:inset 0 0 0 1px rgba(15,23,42,.05);transition:background .18s ease,color .18s ease,transform .18s ease,box-shadow .18s ease}.apprainier-tab:hover{transform:translateY(-1px);box-shadow:inset 0 0 0 1px rgba(15,143,127,.16),0 10px 24px rgba(15,23,42,.06)}.apprainier-tab.active{background:#0f8f7f;color:#fff;box-shadow:0 16px 28px rgba(15,143,127,.24)}.apprainier-message-content{overflow:auto;padding:0 clamp(20px,4vw,42px) 32px;display:grid;gap:16px;min-height:0;scroll-behavior:smooth}.apprainier-message-main{display:grid;gap:16px;max-width:980px;width:100%;margin:0 auto}.apprainier-message-hero-card{border:1px solid rgba(15,23,42,.06);border-radius:30px;padding:22px;background:linear-gradient(135deg,rgba(237,247,245,.94),rgba(250,245,255,.86));box-shadow:0 18px 46px rgba(15,23,42,.08);display:flex;align-items:center;gap:18px}.apprainier-message-hero-icon{width:68px;height:68px;border-radius:999px;display:grid;place-items:center;background:#cfece6;color:#0f8f7f;font-size:30px}.apprainier-message-hero-card h3{margin:0;font-size:26px;line-height:1.12;font-weight:930;letter-spacing:-.03em}.apprainier-message-hero-card p{margin:5px 0 0;color:#64748b;font-size:16px}.apprainier-message-action-row{display:flex;align-items:center;justify-content:space-between;gap:14px}.apprainier-message-action-row .apprainier-button{max-width:280px;box-shadow:0 14px 26px rgba(15,143,127,.18)}.apprainier-thread,.apprainier-announcement-row{position:relative;border:1px solid rgba(15,23,42,.09);border-radius:26px;padding:18px;background:rgba(255,255,255,.86);box-shadow:0 10px 28px rgba(15,23,42,.07);cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}.apprainier-thread:hover,.apprainier-announcement-row:hover{transform:translateY(-2px);box-shadow:0 18px 42px rgba(15,23,42,.11);border-color:rgba(15,143,127,.24)}.apprainier-thread.unread{background:linear-gradient(135deg,rgba(15,143,127,.14),rgba(255,255,255,.92));border-color:rgba(15,143,127,.34)}.apprainier-thread-row,.apprainier-announcement-row-inner{display:flex;gap:15px;align-items:flex-start}.apprainier-thread-avatar{width:52px;height:52px;border-radius:18px;display:grid;place-items:center;flex:0 0 auto;background:#e7f5f2;color:#0f8f7f;font-weight:950;font-size:20px;box-shadow:inset 0 1px 0 rgba(255,255,255,.9)}.apprainier-thread-copy,.apprainier-announcement-copy{flex:1;min-width:0}.apprainier-thread-top{display:flex;gap:10px;align-items:flex-start}.apprainier-thread h3,.apprainier-announcement-row h3{margin:0;flex:1;min-width:0;font-size:19px;line-height:1.2;font-weight:900;letter-spacing:-.02em;color:#111827}.apprainier-thread p,.apprainier-announcement-row p{margin:8px 0 0;color:#64748b;font-size:14px;line-height:1.38}.apprainier-message-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}.apprainier-message-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:rgba(15,23,42,.055);padding:7px 10px;color:#475569;font-size:12px;font-weight:820}.apprainier-message-pill.open{background:rgba(15,143,127,.12);color:#0f766e}.apprainier-message-pill.closed{background:rgba(100,116,139,.12);color:#475569}.apprainier-badge{display:inline-flex;align-items:center;justify-content:center;min-width:27px;height:27px;padding:0 8px;border-radius:999px;background:#0f8f7f;color:#fff;font-size:12px;font-weight:950;box-shadow:0 8px 18px rgba(15,143,127,.25)}.apprainier-empty-card{border:1px dashed rgba(15,23,42,.16);border-radius:28px;padding:34px 24px;text-align:center;background:rgba(255,255,255,.66);color:#64748b}.apprainier-empty-card strong{display:block;color:#111827;font-size:20px;margin-bottom:8px}.apprainier-message-back{align-self:start;border:0;border-radius:999px;background:rgba(255,255,255,.88);box-shadow:0 10px 24px rgba(15,23,42,.08);padding:11px 15px;color:#111827;font:inherit;font-size:14px;font-weight:850;cursor:pointer}.apprainier-message-detail{max-width:920px;width:100%;margin:0 auto;display:grid;gap:16px}.apprainier-message-detail-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:2px}.apprainier-message-detail-card{border:1px solid rgba(15,23,42,.08);border-radius:30px;background:rgba(255,255,255,.9);box-shadow:0 16px 42px rgba(15,23,42,.08);padding:24px}.apprainier-new-hero{text-align:center;padding:18px 0 8px}.apprainier-new-hero .icon{width:96px;height:96px;border-radius:999px;background:#cfece6;color:#0f8f7f;display:grid;place-items:center;font-size:38px;margin:0 auto 18px}.apprainier-new-hero h3{margin:0;font-size:32px;line-height:1.1;font-weight:950;letter-spacing:-.04em}.apprainier-new-hero p{margin:12px 0 0;color:#64748b;font-size:18px}.apprainier-new-hint{margin:14px 0 0;color:#0f8f7f;font-weight:800}.apprainier-message-form{display:grid;gap:16px}.apprainier-message-input-wrap{display:flex;align-items:center;gap:13px;border:1px solid rgba(15,23,42,.18);border-radius:18px;background:rgba(255,255,255,.82);padding:0 16px;color:#64748b}.apprainier-message-input-wrap input,.apprainier-message-input-wrap textarea{width:100%;border:0;background:transparent;outline:0;font:inherit;font-size:17px;color:#111827;padding:17px 0}.apprainier-message-input-wrap textarea{min-height:120px;resize:vertical;line-height:1.42}.apprainier-message-tips{border-radius:24px;background:rgba(15,143,127,.07);padding:18px 20px;color:#475569}.apprainier-message-tips strong{display:block;color:#0f8f7f;margin-bottom:8px}.apprainier-chat-frame{max-width:920px;width:100%;margin:0 auto;display:flex;flex-direction:column;min-height:0;gap:12px}.apprainier-chat-header{display:flex;align-items:center;gap:14px;border:1px solid rgba(15,23,42,.08);border-radius:28px;background:rgba(255,255,255,.9);padding:16px 18px;box-shadow:0 12px 34px rgba(15,23,42,.07)}.apprainier-chat-header .apprainier-thread-avatar{width:50px;height:50px}.apprainier-chat-title{flex:1;min-width:0}.apprainier-chat-title h3{margin:0;font-size:20px;font-weight:930;letter-spacing:-.02em}.apprainier-chat-title p{margin:4px 0 0;color:#64748b;font-size:13px}.apprainier-chat-list{display:flex;flex-direction:column;gap:10px;border:1px solid rgba(15,23,42,.06);border-radius:30px;background:linear-gradient(180deg,rgba(255,255,255,.68),rgba(240,249,247,.68));padding:18px;min-height:340px;max-height:min(58vh,680px);overflow:auto;box-shadow:inset 0 1px 0 rgba(255,255,255,.9)}.apprainier-date-separator{align-self:center;border-radius:999px;background:rgba(15,23,42,.07);color:#475569;padding:7px 12px;font-size:12px;font-weight:850;margin:7px 0}.apprainier-bubble-row{display:flex;align-items:flex-end;gap:8px}.apprainier-bubble-row.mine{justify-content:flex-end}.apprainier-bubble{max-width:min(72%,640px);border-radius:22px;padding:12px 14px;box-shadow:0 8px 22px rgba(15,23,42,.08);font-size:15px;line-height:1.42}.apprainier-bubble-row.mine .apprainier-bubble{background:#0f8f7f;color:#fff;border-bottom-right-radius:7px}.apprainier-bubble-row.agent .apprainier-bubble{background:#fff;color:#111827;border-bottom-left-radius:7px}.apprainier-bubble-author{display:block;font-size:11px;font-weight:900;opacity:.72;margin-bottom:4px}.apprainier-bubble-time{display:block;text-align:right;font-size:11px;font-weight:800;opacity:.72;margin-top:5px}.apprainier-composer{display:flex;align-items:flex-end;gap:10px;position:sticky;bottom:0;border:1px solid rgba(15,23,42,.08);border-radius:28px;background:rgba(255,255,255,.94);box-shadow:0 -8px 30px rgba(15,23,42,.08);padding:12px}.apprainier-composer textarea{flex:1;border:1px solid rgba(15,23,42,.12);border-radius:22px;background:#f8fafc;min-height:48px;max-height:128px;padding:13px 16px;font:inherit;font-size:15px;resize:vertical;outline:0;color:#111827}.apprainier-send-button{flex:0 0 52px;width:52px;height:52px;border:0;border-radius:999px;background:#0f8f7f;color:#fff;font-size:30px;line-height:1;cursor:pointer;box-shadow:0 12px 24px rgba(15,143,127,.25)}.apprainier-send-button:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}.apprainier-announcement-thumb{width:128px;height:96px;border-radius:22px;background:linear-gradient(135deg,#dbeafe,#e0f2fe);object-fit:cover;flex:0 0 auto;box-shadow:inset 0 1px 0 rgba(255,255,255,.85)}.apprainier-announcement-fallback{width:78px;height:78px;border-radius:999px;background:#cfece6;color:#0f8f7f;display:grid;place-items:center;font-size:30px;flex:0 0 auto}.apprainier-announcement-arrow{align-self:center;color:#64748b;font-size:34px;line-height:1}.apprainier-announcement-new{position:absolute;top:16px;right:16px;border-radius:14px;background:#0f8f7f;color:#fff;padding:8px 13px;font-size:13px;font-weight:930}.apprainier-announcement-photo{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:#fff;padding:7px 12px;color:#0f8f7f;font-size:13px;font-weight:850}.apprainier-announcement-hero{width:100%;height:min(40vh,360px);border-radius:30px;object-fit:cover;background:#e2e8f0;box-shadow:0 18px 46px rgba(15,23,42,.11)}.apprainier-announcement-summary{display:flex;align-items:center;gap:18px;border-radius:30px;background:linear-gradient(135deg,rgba(250,245,255,.95),rgba(237,247,245,.88));padding:22px}.apprainier-announcement-summary h3{margin:0;font-size:30px;line-height:1.08;font-weight:950;letter-spacing:-.04em}.apprainier-announcement-summary p{margin:8px 0 0;color:#64748b;font-size:17px}.apprainier-announcement-detail-body{border-radius:30px;background:#edf8f6;padding:24px;color:#1f2937;font-size:18px;line-height:1.55}.apprainier-announcement-detail-body strong{display:block;color:#0f8f7f;margin-bottom:12px}
    .apprainier-message-tips div{white-space:pre-line}.apprainier-tabs[hidden]{display:none!important}.apprainier-delete-chat{width:42px;height:42px;border:0;border-radius:999px;background:rgba(239,68,68,.10);color:#dc2626;display:grid;place-items:center;font-size:18px;cursor:pointer;transition:background .16s ease,transform .16s ease}.apprainier-delete-chat:hover{background:rgba(239,68,68,.18);transform:scale(1.04)}.apprainier-delete-chat:disabled{opacity:.45;cursor:not-allowed;transform:none}.apprainier-announcement-hero.clickable{cursor:zoom-in;transition:transform .18s ease,box-shadow .18s ease}.apprainier-announcement-hero.clickable:hover{transform:translateY(-2px);box-shadow:0 24px 58px rgba(15,23,42,.16)}.apprainier-image-viewer{position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.88);display:grid;grid-template-rows:auto 1fr;gap:12px;padding:18px;color:#fff;backdrop-filter:blur(14px)}.apprainier-image-viewer-bar{display:flex;align-items:center;justify-content:space-between;gap:12px}.apprainier-image-viewer-title{font-weight:900;font-size:15px;opacity:.88;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.apprainier-image-viewer-actions{display:flex;gap:8px;align-items:center}.apprainier-image-viewer button{border:0;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;min-width:42px;height:42px;padding:0 14px;font:inherit;font-weight:900;cursor:pointer}.apprainier-image-viewer button:hover{background:rgba(255,255,255,.22)}.apprainier-image-stage{overflow:auto;display:grid;place-items:center;border-radius:24px;background:rgba(255,255,255,.06);touch-action:pan-x pan-y}.apprainier-image-stage img{max-width:none;max-height:none;transform-origin:center center;transition:transform .12s ease;user-select:none;-webkit-user-drag:none}
    .apprainier-ann-carousel{display:grid;gap:16px}.apprainier-ann-indicators{display:flex;justify-content:center;align-items:center;gap:8px}.apprainier-ann-dot{width:8px;height:8px;border-radius:999px;border:0;background:#cbd5e1;cursor:pointer;transition:width .18s ease,background .18s ease}.apprainier-ann-dot.active{width:24px;background:var(--ar-ann-primary,#087ff5)}.apprainier-ann-count{justify-self:center;border-radius:999px;background:rgba(15,23,42,.06);padding:6px 12px;color:#64748b;font-size:12px;font-weight:800}.apprainier-ann-image{height:220px;border-radius:24px;overflow:hidden;background:#e2e8f0;border:1px solid rgba(15,23,42,.08);display:grid;place-items:center}.apprainier-ann-image img{width:100%;height:100%;object-fit:cover;display:block}.apprainier-ann-placeholder{color:#64748b;font-weight:800}.apprainier-ann-slide-copy{text-align:center}.apprainier-ann-slide-title{margin:0;color:var(--ar-ann-title,#0f172a);font-size:25px;line-height:1.15;font-weight:900;letter-spacing:-.02em}.apprainier-ann-slide-desc{margin:10px 0 0;color:var(--ar-ann-muted,#64748b);font-size:16px;line-height:1.42}.apprainier-ann-slide-index{margin:14px 0 0;color:var(--ar-ann-muted,#64748b);font-size:13px}
    @media(max-width:720px){.apprainier-message-header{grid-template-columns:1fr auto;padding:22px 18px 14px}.apprainier-message-mark{display:none}.apprainier-message-header h2{font-size:30px}.apprainier-message-header p{font-size:14px}.apprainier-tabs{padding:14px 16px;gap:10px}.apprainier-tab{font-size:14px;padding:13px 10px;border-radius:18px}.apprainier-message-content{padding:0 16px 24px}.apprainier-message-hero-card{padding:16px;border-radius:24px}.apprainier-message-hero-icon{width:52px;height:52px;font-size:24px}.apprainier-message-hero-card h3{font-size:22px}.apprainier-message-action-row{align-items:stretch;flex-direction:column}.apprainier-message-action-row .apprainier-button{max-width:none}.apprainier-thread-row,.apprainier-announcement-row-inner{gap:12px}.apprainier-announcement-thumb{width:92px;height:82px;border-radius:18px}.apprainier-announcement-fallback{width:58px;height:58px;font-size:24px}.apprainier-announcement-new{position:static;display:inline-flex;margin-top:12px}.apprainier-chat-list{max-height:52vh;min-height:300px;padding:12px;border-radius:24px}.apprainier-bubble{max-width:84%;font-size:14px}.apprainier-composer{border-radius:22px}.apprainier-new-hero h3{font-size:27px}.apprainier-announcement-summary{align-items:flex-start}.apprainier-announcement-summary h3{font-size:25px}.apprainier-announcement-hero{height:230px;border-radius:24px}}
    @media(max-width:640px){.apprainier-overlay{padding:14px}.apprainier-dialog{border-radius:24px;padding:22px}.apprainier-buttons,.apprainier-survey-actions{flex-direction:column}.apprainier-title{font-size:24px}.apprainier-ann-dialog{padding:28px 22px 22px}.apprainier-ann-icon{width:74px;height:74px;border-radius:24px;margin-top:18px}.apprainier-ann-title{font-size:25px}.apprainier-ann-subtitle{font-size:17px}.apprainier-ann-description,.apprainier-ann-list{font-size:16px}.apprainier-ann-dialog .apprainier-button{min-height:52px;font-size:16px}.apprainier-survey-card{padding:22px;border-radius:24px}.apprainier-survey-title{font-size:23px}.apprainier-scale-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.apprainier-scale-grid.csat{grid-template-columns:repeat(5,minmax(0,1fr))}.apprainier-emoji-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function closeOverlay(overlay) {
  overlay.remove();
}

function button(text, className, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function normalizeCssColor(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const argbMatch = /^#([0-9a-f]{2})(000000|ffffff)$/i.exec(trimmed);
  if (argbMatch && argbMatch[1].toLowerCase() !== 'ff') {
    const alpha = Math.round((parseInt(argbMatch[1], 16) / 255) * 100) / 100;
    const channel = argbMatch[2].toLowerCase() === 'ffffff' ? 255 : 0;
    return `rgba(${channel},${channel},${channel},${alpha})`;
  }
  return trimmed;
}

function resolveStyleColor(value, fallback) {
  const normalized = normalizeCssColor(value);
  return normalized || fallback;
}

function styleColor(style, keys, fallback) {
  const source = objectValue(style);
  const candidates = Array.isArray(keys) ? keys : [keys];
  for (const key of candidates) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return normalizeCssColor(value);
  }
  return fallback;
}

function primaryStyleColor(style, fallback = '#0f8f7f') {
  return styleColor(style, ['primaryColor', 'accentColor', 'buttonBackgroundColor', 'sendFeedbackButtonColor', 'primaryButtonColor', 'submitButtonColor'], fallback);
}

function buttonBackgroundStyleColor(style, fallback = '#0f8f7f') {
  const source = objectValue(style);
  const primary = primaryStyleColor(source, fallback);
  const buttonColor = styleColor(source, ['buttonBackgroundColor', 'sendFeedbackButtonColor', 'primaryButtonColor', 'submitButtonColor'], '');
  if (buttonColor.toLowerCase() === '#007aff' && primary.toLowerCase() !== '#007aff') return primary;
  return buttonColor || primary;
}

function secondaryStyleColor(style, fallback = '#f2f2f3') {
  return styleColor(style, ['secondaryButtonColor', 'maybeLaterButtonColor', 'cancelButtonColor', 'skipButtonColor', 'dismissButtonColor'], fallback);
}

function buttonTextStyleColor(style, fallback = '#ffffff') {
  return styleColor(style, ['buttonTextColor', 'sendFeedbackTextColor', 'primaryButtonTextColor', 'submitButtonTextColor'], fallback);
}

function secondaryButtonTextStyleColor(style, fallback = '#343a40') {
  return styleColor(style, ['secondaryButtonTextColor', 'maybeLaterTextColor', 'cancelButtonTextColor', 'skipButtonTextColor', 'dismissButtonTextColor', 'textColor'], fallback);
}

function mergedStyle(...sources) {
  return sources.reduce((merged, source) => ({ ...merged, ...objectValue(source) }), {});
}

function styleValue(style, keys) {
  const source = objectValue(style);
  const candidates = Array.isArray(keys) ? keys : [keys];
  for (const key of candidates) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isDefaultBlack(value) {
  return ['#000', '#000000', 'black', 'rgb(0,0,0)', 'rgb(0, 0, 0)'].includes(String(value || '').trim().toLowerCase());
}

function resolvedTextStyleColor(globalStyle, localStyle, fallback = '#000000') {
  const local = styleValue(localStyle, ['textColor', 'titleColor', 'primaryTextColor', 'questionTextColor']);
  const global = styleValue(globalStyle, ['textColor', 'bodyTextColor', 'primaryTextColor']);
  if (local && !isDefaultBlack(local)) return local;
  if (global && !isDefaultBlack(global)) return global;
  return local || global || fallback;
}

function applySurveyTheme(card, styleInput, options = {}) {
  const style = objectValue(styleInput);
  const defaultBackground = options.defaultBackground || '#eaf8f6';
  const primaryColor = primaryStyleColor(style);
  const buttonColor = buttonBackgroundStyleColor(style, primaryColor);
  const buttonTextColor = buttonTextStyleColor(style);
  const secondaryColor = secondaryStyleColor(style);
  const secondaryTextColor = secondaryButtonTextStyleColor(style);
  const textColor = styleColor(style, ['textColor', 'bodyTextColor', 'primaryTextColor'], '#151922');
  const titleColor = styleColor(style, ['titleColor', 'primaryTextColor', 'questionTextColor', 'textColor'], textColor);
  const mutedColor = styleColor(style, ['subtitleColor', 'descriptionColor', 'mutedTextColor', 'secondaryTextColor', 'textColor'], '#5f6875');
  const backgroundColor = styleColor(style, ['backgroundColor', 'dialogBackgroundColor', 'containerBackgroundColor', 'cardBackgroundColor'], defaultBackground);

  card.style.setProperty('--ar-card-bg', backgroundColor);
  card.style.setProperty('--ar-primary', primaryColor);
  card.style.setProperty('--ar-button', buttonColor);
  card.style.setProperty('--ar-button-text', buttonTextColor);
  card.style.setProperty('--ar-secondary', secondaryColor);
  card.style.setProperty('--ar-secondary-text', secondaryTextColor);
  card.style.setProperty('--ar-title', titleColor);
  card.style.setProperty('--ar-text', textColor);
  card.style.setProperty('--ar-muted', mutedColor);
  card.style.setProperty('--ar-star', styleColor(style, ['starFilledColor', 'ratingColor', 'primaryColor', 'buttonBackgroundColor'], primaryColor));
  card.style.setProperty('--ar-star-empty', styleColor(style, ['starEmptyColor', 'ratingEmptyColor', 'unselectedStarColor'], '#c9d1d1'));
  card.style.setProperty('--ar-scale-selected-bg', styleColor(style, ['selectedNumberBackgroundColor', 'selectedScoreBackgroundColor', 'selectedOptionBackgroundColor', 'selectedChoiceBackgroundColor', 'primaryColor', 'buttonBackgroundColor'], primaryColor));
  card.style.setProperty('--ar-scale-selected-text', styleColor(style, ['selectedNumberColor', 'selectedScoreColor', 'selectedOptionTextColor', 'selectedChoiceTextColor', 'buttonTextColor'], buttonTextColor));
  card.style.setProperty('--ar-scale-unselected-bg', styleColor(style, ['unselectedNumberBackgroundColor', 'unselectedScoreBackgroundColor', 'unselectedOptionBackgroundColor', 'unselectedChoiceBackgroundColor'], 'rgba(15,23,42,.06)'));
  card.style.setProperty('--ar-scale-unselected-text', styleColor(style, ['unselectedNumberColor', 'unselectedScoreColor', 'optionTextColor', 'unselectedChoiceTextColor', 'textColor'], textColor));
  card.style.setProperty('--ar-scale-unselected-border', styleColor(style, ['unselectedNumberBorderColor', 'unselectedScoreBorderColor', 'optionBorderColor', 'fieldBorderColor'], 'rgba(15,23,42,.12)'));
  card.style.setProperty('--ar-choice-bg', styleColor(style, ['optionBackgroundColor', 'choiceBackgroundColor', 'itemBackgroundColor', 'fieldBackgroundColor'], 'rgba(255,255,255,.64)'));
  card.style.setProperty('--ar-choice-text', styleColor(style, ['optionTextColor', 'choiceTextColor', 'textColor'], textColor));
  card.style.setProperty('--ar-choice-border', styleColor(style, ['optionBorderColor', 'choiceBorderColor', 'fieldBorderColor'], 'rgba(15,23,42,.14)'));
  card.style.setProperty('--ar-choice-mark-border', styleColor(style, ['optionMarkBorderColor', 'choiceMarkBorderColor', 'optionBorderColor'], 'rgba(95,104,117,.55)'));
  card.style.setProperty('--ar-choice-selected-bg', styleColor(style, ['selectedOptionBackgroundColor', 'selectedChoiceBackgroundColor', 'selectedItemBackgroundColor'], `color-mix(in srgb, ${primaryColor} 16%, white)`));
  card.style.setProperty('--ar-choice-selected-text', styleColor(style, ['selectedOptionTextColor', 'selectedChoiceTextColor', 'selectedItemTextColor', 'primaryColor'], primaryColor));
  card.style.setProperty('--ar-choice-icon-bg', styleColor(style, ['emojiBackgroundColor', 'iconBackgroundColor', 'optionIconBackgroundColor'], 'rgba(255,255,255,.9)'));
  card.style.setProperty('--ar-positive', styleColor(style, ['positiveButtonColor', 'positiveColor', 'successColor', 'primaryColor', 'buttonBackgroundColor'], primaryColor));
  card.style.setProperty('--ar-positive-text', styleColor(style, ['positiveButtonTextColor', 'buttonTextColor'], buttonTextColor));
  card.style.setProperty('--ar-negative', styleColor(style, ['negativeButtonColor', 'negativeColor', 'errorColor'], '#ef4444'));
  card.style.setProperty('--ar-negative-text', styleColor(style, ['negativeButtonTextColor', 'buttonTextColor'], buttonTextColor));
  card.style.setProperty('--ar-input-bg', styleColor(style, ['commentBackgroundColor', 'textInputBackgroundColor', 'inputBackgroundColor', 'fieldBackgroundColor'], 'rgba(255,255,255,.56)'));
  card.style.setProperty('--ar-input-text', styleColor(style, ['commentTextColor', 'textInputTextColor', 'inputTextColor', 'textColor'], textColor));
  card.style.setProperty('--ar-input-placeholder', styleColor(style, ['commentPlaceholderColor', 'textInputPlaceholderColor', 'inputPlaceholderColor', 'hintTextColor', 'subtitleColor', 'descriptionColor'], mutedColor));
  card.style.setProperty('--ar-input-border', styleColor(style, ['commentBorderColor', 'textInputBorderColor', 'inputBorderColor', 'fieldBorderColor'], 'rgba(15,23,42,.18)'));
  card.style.background = backgroundColor;
  card.style.color = textColor;
  card.style.borderRadius = `${Number(style.borderRadius || style.cornerRadius || 24)}px`;
}

function resolveAdminDimension(style, key, fallback, available = window.innerWidth) {
  if (style?.autoSize === true) return fallback;
  const value = Number(style?.[key]);
  if (!Number.isFinite(value)) return fallback;
  if (value === 0) return fallback;
  if (style?.sizeUnit === '%') return Math.max(0, Math.min(95, value)) / 100 * available;
  return value;
}

function resolveCornerRadius(style, width, height, fallback = 22) {
  const raw = Number(style?.cornerRadius ?? style?.borderRadius ?? fallback);
  const max = Math.min(width || 9999, height || 9999) / 2;
  return Math.max(0, Math.min(Number.isFinite(raw) ? raw : fallback, max));
}

function parseLiveCardFontSize(value, fallback) {
  const sizeMap = {
    small: 13,
    medium: 15,
    large: 18,
    extralarge: 22,
    'extra-large': 22,
    extra_large: 22,
    xlarge: 22,
  };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const unit = String(value.unit || value.sizeUnit || 'px').trim();
    return parseLiveCardFontSize(`${value.value ?? value.size ?? value.fontSize}${unit}`, fallback);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (sizeMap[trimmed]) return sizeMap[trimmed];
    const match = /^(\d+(?:\.\d+)?)(px|sp|dp|pt|rem|em)?$/.exec(trimmed);
    if (match) {
      const numeric = Number(match[1]);
      const unit = match[2] || 'px';
      if (Number.isFinite(numeric) && numeric > 0) {
        if (unit === 'rem' || unit === 'em') return numeric * 16;
        return numeric;
      }
    }
    const numeric = Number(trimmed.replace(/px|sp|dp|pt/g, ''));
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function parseLiveCardIconDimension(rawDimension, rawSize, fallback = 24) {
  const sizeMap = {
    small: 20,
    medium: 24,
    large: 32,
    xlarge: 42,
  };
  const explicit = Number(rawDimension);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (typeof rawSize === 'string') {
    const normalized = rawSize.trim().toLowerCase();
    if (sizeMap[normalized]) return sizeMap[normalized];
    const numeric = Number(normalized.replace(/px|dp|sp/g, ''));
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  const numeric = Number(rawSize);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function liveCardImageUrl(item) {
  return item?.imageUrl || item?.imageURL || item?.image || item?.heroImage || item?.backgroundImage || '';
}

function mergedAnnouncementConfig(structure, config) {
  const structureConfig = objectValue(structure.config);
  return {
    style: {
      ...objectValue(config.style),
      ...objectValue(structureConfig.style),
      ...objectValue(structure.style),
    },
    behavior: {
      ...objectValue(config.behavior),
      ...objectValue(structureConfig.behavior),
      ...objectValue(structure.behavior),
    },
    layout: {
      ...objectValue(config.layout),
      ...objectValue(structureConfig.layout),
      ...objectValue(structure.layout),
    },
    fieldStyles: {
      ...objectValue(config.fieldStyles),
      ...objectValue(structureConfig.fieldStyles),
      ...objectValue(structure.fieldStyles),
    },
  };
}

function fieldStyleValue(fieldStyles, field, key, fallback) {
  const value = fieldStyles?.[field]?.[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function iconColorFor(style) {
  return styleColor(style, ['iconColor', 'primaryColor', 'buttonBackgroundColor', 'primaryButtonColor', 'accentColor'], '#0f8f7f');
}

function materialIconMarkup(iconToken) {
  const key = normalizeIdentifier(iconToken || 'campaign');
  if (key === 'warning' || key === 'reportproblem') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 21h22L12 2 1 21Z"></path><path fill="white" d="M11 18h2v2h-2v-2Zm0-8h2v6h-2v-6Z"></path></svg>';
  }
  const paths = {
    rocket: 'M12 2C8.2 4.2 6 7.6 6 12c0 .6.4 1 1 1h2l-1 5 4-3 4 3-1-5h2c.6 0 1-.4 1-1 0-4.4-2.2-7.8-6-10Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM5 14c-1.7 1.1-2.5 2.8-2.5 5 1.9-.5 3.3-1.3 4.2-2.5L5 14Zm14 0-1.7 2.5c.9 1.2 2.3 2 4.2 2.5 0-2.2-.8-3.9-2.5-5Z',
    rocketlaunch: 'M12 2C8.2 4.2 6 7.6 6 12c0 .6.4 1 1 1h2l-1 5 4-3 4 3-1-5h2c.6 0 1-.4 1-1 0-4.4-2.2-7.8-6-10Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM5 14c-1.7 1.1-2.5 2.8-2.5 5 1.9-.5 3.3-1.3 4.2-2.5L5 14Zm14 0-1.7 2.5c.9 1.2 2.3 2 4.2 2.5 0-2.2-.8-3.9-2.5-5Z',
    featureadoption: 'M12 2C8.2 4.2 6 7.6 6 12c0 .6.4 1 1 1h2l-1 5 4-3 4 3-1-5h2c.6 0 1-.4 1-1 0-4.4-2.2-7.8-6-10Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM5 14c-1.7 1.1-2.5 2.8-2.5 5 1.9-.5 3.3-1.3 4.2-2.5L5 14Zm14 0-1.7 2.5c.9 1.2 2.3 2 4.2 2.5 0-2.2-.8-3.9-2.5-5Z',
    sparkles: 'm12 2 1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2Zm6.5 9.5.9 2.9 2.9.9-2.9.9-.9 2.9-.9-2.9-2.9-.9 2.9-.9.9-2.9ZM6 14l1.1 3.4L10.5 18l-3.4 1.1L6 22l-1.1-2.9L1.5 18l3.4-.6L6 14Z',
    info: 'M11 17h2v-6h-2v6Zm1-8.75a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5ZM12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z',
    security: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1 14-4-4 1.4-1.4 2.6 2.6 5.6-5.6L18 9l-7 7Z',
    systemupdate: 'M12 16 6 10h4V4h4v6h4l-6 6Zm-7 4v-2h14v2H5Z',
    download: 'M12 16 6 10h4V4h4v6h4l-6 6Zm-7 4v-2h14v2H5Z',
    newreleases: 'm23 12-2.4 2.7.3 3.6-3.5.8-1.8 3.1-3.3-1.4L9 21.4l-1.8-3.1-3.5-.8.3-3.6L1 12l3-1.9-.3-3.6 3.5-.8L9 2.6l3.3 1.4L15.6 2l1.8 3.1 3.5.8-.3 3.6L23 12Zm-12 5h2v-2h-2v2Zm0-4h2V7h-2v6Z',
    update: 'M12 6V3L8 7l4 4V8c2.2 0 4 1.8 4 4 0 .7-.2 1.3-.5 1.9l1.5 1.5c.6-1 1-2.1 1-3.4 0-3.3-2.7-6-6-6Zm-4.5.6c-.6 1-1 2.1-1 3.4 0 3.3 2.7 6 6 6v3l4-4-4-4v3c-2.2 0-4-1.8-4-4 0-.7.2-1.3.5-1.9L7.5 6.6Z',
    campaign: 'M18 11v2h4v-2h-4Zm-2.5 6.6 3.2 2.4 1.2-1.6-3.2-2.4-1.2 1.6ZM19.9 5.6 18.7 4l-3.2 2.4 1.2 1.6 3.2-2.4ZM4 9v6h4l5 4V5L8 9H4Z',
    emoji_events: 'M7 4V2h10v2h3v3c0 2.8-2.2 5-5 5h-.2A6 6 0 0 1 13 14.7V18h3v2H8v-2h3v-3.3A6 6 0 0 1 9.2 12H9c-2.8 0-5-2.2-5-5V4h3Zm0 2H6v1c0 1.5 1 2.7 2.4 3A7 7 0 0 1 7 6Zm10 0a7 7 0 0 1-1.4 4A3 3 0 0 0 18 7V6h-1Z',
    emojievents: 'M7 4V2h10v2h3v3c0 2.8-2.2 5-5 5h-.2A6 6 0 0 1 13 14.7V18h3v2H8v-2h3v-3.3A6 6 0 0 1 9.2 12H9c-2.8 0-5-2.2-5-5V4h3Zm0 2H6v1c0 1.5 1 2.7 2.4 3A7 7 0 0 1 7 6Zm10 0a7 7 0 0 1-1.4 4A3 3 0 0 0 18 7V6h-1Z',
    cardgiftcard: 'M20 6h-2.2c.1-.3.2-.7.2-1a3 3 0 0 0-5.2-2l-.8.9-.8-.9A3 3 0 0 0 6 5c0 .3.1.7.2 1H4c-1.1 0-2 .9-2 2v3h20V8c0-1.1-.9-2-2-2Zm-7-1.6.8-.9A1.2 1.2 0 0 1 16 5c0 .6-.4 1-1 1h-2V4.4ZM8 3.8c.3 0 .6.1.8.4l.8.9V6H8c-.6 0-1-.4-1-1s.4-1.2 1-1.2ZM2 13v7c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-7h-9v9h-2v-9H2Z',
    gift: 'M20 6h-2.2c.1-.3.2-.7.2-1a3 3 0 0 0-5.2-2l-.8.9-.8-.9A3 3 0 0 0 6 5c0 .3.1.7.2 1H4c-1.1 0-2 .9-2 2v3h20V8c0-1.1-.9-2-2-2Zm-7-1.6.8-.9A1.2 1.2 0 0 1 16 5c0 .6-.4 1-1 1h-2V4.4ZM8 3.8c.3 0 .6.1.8.4l.8.9V6H8c-.6 0-1-.4-1-1s.4-1.2 1-1.2ZM2 13v7c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-7h-9v9h-2v-9H2Z',
    checkcircle: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Zm-1.1-6 7-7-1.4-1.4-5.6 5.6-2.4-2.4L7.1 12l3.8 4Z',
    erroroutline: 'M11 15h2v2h-2v-2Zm0-8h2v6h-2V7Zm1 15a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z',
    error: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm5 13.6L15.6 17 12 13.4 8.4 17 7 15.6l3.6-3.6L7 8.4 8.4 7l3.6 3.6L15.6 7 17 8.4 13.4 12l3.6 3.6Z',
    build: 'M22.6 19.3 13 9.7c.9-2.3.4-5-1.5-6.8-2-2-5-2.4-7.4-1.2l4.5 4.5-2.8 2.8L1.3 4.5C.1 7-.3 10 1.7 12c1.8 1.8 4.5 2.4 6.8 1.5l9.6 9.6c.4.4 1 .4 1.4 0l3.1-3.1c.4-.4.4-1 0-1.4Z',
    construction: 'M13.8 4.2 16 2l6 6-2.2 2.2-1.4-1.4-3.5 3.5 1.3 1.3-2.1 2.1-4.7-4.7 2.1-2.1 1.3 1.3 3.5-3.5-1.4-1.4ZM4.4 21.8 2.2 19.6l8.1-8.1 2.2 2.2-8.1 8.1ZM4 8l3-3 3 3-3 3-3-3Z',
    cloudoff: 'M3.3 2 2 3.3l3.2 3.2C2.8 7.2 1 9.4 1 12c0 3.3 2.7 6 6 6h10.7l3 3 1.3-1.3L3.3 2ZM7 16c-2.2 0-4-1.8-4-4 0-1.7 1.1-3.2 2.6-3.8L13.4 16H7Zm10.9 0h.1c2.2 0 4-1.8 4-4s-1.8-4-4-4h-.7C16.4 5.1 13.7 3 10.5 3c-1.2 0-2.4.3-3.4.9l2 2c.5-.2 1-.3 1.5-.3 2.4 0 4.4 1.7 4.9 3.9l.2 1h2.3c1.1 0 2 .9 2 2 0 .8-.5 1.5-1.2 1.8L17.9 16Z',
    signalwifioff: 'M12 18.5 8.5 15c1.9-1.6 5.1-1.6 7 0L12 18.5Zm7.8-7.8 1.4-1.4C15.9 4.2 8.2 3.8 3 8.3l1.4 1.4c4.4-3.7 10.6-3.4 15.4 1Zm-3.2 3.2 1.4-1.4c-3.4-3-8.6-3-12 0l1.4 1.4c2.6-2.2 6.6-2.2 9.2 0ZM3.3 2 2 3.3l18.7 18.7 1.3-1.3L3.3 2Z',
  };
  const path = paths[key] || paths.campaign;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
}

function renderAnnouncementIcon(structure, style) {
  const icon = el('div', 'apprainier-ann-icon');
  icon.style.setProperty('--ar-ann-icon', iconColorFor(style));
  const iconToken = structure.iconUrl || structure.iconURL || structure.icon || 'campaign';
  if (/^https?:|^data:image/.test(String(iconToken))) {
    const img = el('img');
    img.src = iconToken;
    img.alt = '';
    img.style.cssText = 'width:64%;height:64%;object-fit:contain;';
    icon.append(img);
  } else {
    icon.innerHTML = materialIconMarkup(iconToken);
  }
  return icon;
}

function renderSurveyDialog(survey, eventName) {
  injectStyles();
  const structure = parseStructure(survey);
  const config = parseConfig(survey);
  const structureConfig = objectValue(structure.config);
  const style = mergedStyle(config, config.style, structureConfig, structureConfig.style, structure.style);
  const behavior = mergedStyle(config.behavior, structureConfig.behavior, structure.behavior);
  const questions = getSurveyQuestions(structure);
  const answers = {};
  const template = resolveSurveyTemplate(survey, structure, questions);
  const overlay = el('div', 'apprainier-overlay');
  const card = el('section', `apprainier-survey-card ${surveyCardSize(template)}`);
  const defaultBackground = template === 'multiStep' ? '#ffffff' : '#eaf8f6';
  applySurveyTheme(card, style, { defaultBackground });
  overlay.append(card);

  const ctx = {
    survey,
    eventName,
    structure,
    style,
    behavior,
    template,
    questions,
    answers,
    overlay,
    card,
    submit: async (responses = answers, completed = true, outcome = 'submitted') => {
      await submitSurveyInteraction(survey, eventName, responses, completed, outcome);
      emit(completed ? AppRainierEvents.surveySubmitted : AppRainierEvents.surveyCancelled, surveyPayload(survey, eventName, responses));
      closeOverlay(overlay);
    },
    dismiss: async () => {
      await submitSurveyInteraction(survey, eventName, answers, false, 'dismissed');
      emit(AppRainierEvents.surveyDismissed, surveyPayload(survey, eventName, answers));
      closeOverlay(overlay);
    },
    cancel: async () => {
      await submitSurveyInteraction(survey, eventName, answers, false, 'cancelled');
      emit(AppRainierEvents.surveyCancelled, surveyPayload(survey, eventName, answers));
      closeOverlay(overlay);
    },
  };

  if (shouldShowSurveyClose(structure, behavior)) {
    card.append(button('x', 'apprainier-survey-close', ctx.dismiss));
  }

  const renderer = {
    starRating: renderStarSurvey,
    thumbsFeedback: renderThumbsSurvey,
    textFeedback: renderTextFeedbackSurvey,
    nps: renderNpsSurvey,
    csat: renderCsatSurvey,
    multipleChoice: renderMultipleChoiceSurvey,
    singleQuestionPoll: renderSingleQuestionPollSurvey,
    emojiMood: renderEmojiMoodSurvey,
    customerDiscovery: renderCustomerDiscoverySurvey,
    pmf: renderPmfSurvey,
    exitSurvey: renderExitSurvey,
    postSupportFeedback: renderPostSupportSurvey,
    multiStep: renderMultiStepSurvey,
  }[template] || renderGenericSurvey;
  renderer(ctx);
  document.body.append(overlay);
}

function resolveSurveyTemplate(survey, structure, questions) {
  const identity = normalizeIdentifier([
    survey.templateId,
    structure.templateId,
    eventTargetFor(survey),
    survey.name,
  ].filter(Boolean).join(' '));
  if (identity.includes('multistep')) return 'multiStep';
  if (identity.includes('postsupport')) return 'postSupportFeedback';
  if (identity.includes('customerdiscovery')) return 'customerDiscovery';
  if (identity.includes('pmf') || identity.includes('productmarketfit')) return 'pmf';
  if (identity.includes('multiplechoice')) return 'multipleChoice';
  if (identity.includes('singlequestionpoll')) return 'singleQuestionPoll';
  if (identity.includes('emojimood') || identity.includes('moodtracker')) return 'emojiMood';
  if (identity.includes('exitsurvey')) return 'exitSurvey';
  if (identity.includes('textfeedback') || identity.includes('feedbackform')) return 'textFeedback';
  if (identity.includes('nps') || identity.includes('netpromoter')) return 'nps';
  if (identity.includes('csat') || identity.includes('customersatisfaction')) return 'csat';
  if (identity.includes('starrating') || identity.includes('star')) return 'starRating';
  if (identity.includes('thumb')) return 'thumbsFeedback';

  const questionTypes = questions.map((question) => normalizeIdentifier(question.type)).join(' ');
  if (questionTypes.includes('starrating') || questionTypes.includes('star')) return 'starRating';
  if (questionTypes.includes('thumb')) return 'thumbsFeedback';
  if (questionTypes.includes('nps') || questionTypes.includes('netpromoter')) return 'nps';
  if (questionTypes.includes('csat') || questionTypes.includes('customersatisfaction')) return 'csat';
  if (questionTypes.includes('multiplechoice')) return 'multipleChoice';
  if (questionTypes.includes('singlequestionpoll') || questionTypes.includes('poll')) return 'singleQuestionPoll';
  if (questionTypes.includes('emojimood') || questionTypes.includes('moodtracker') || questionTypes.includes('emoji')) return 'emojiMood';
  return 'generic';
}

function normalizeIdentifier(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getSurveyQuestions(structure) {
  return Array.isArray(structure.questions) && structure.questions.length > 0
    ? structure.questions
    : [{ id: 'feedback', type: 'text', title: structure.description || structure.title || 'Share your feedback', placeholder: 'What is on your mind?' }];
}

function surveyCardSize(template) {
  if (template === 'multiStep') return 'multi-step';
  return ['nps', 'multipleChoice', 'emojiMood', 'multiStep', 'postSupportFeedback'].includes(template) ? 'wide' : 'compact';
}

function shouldShowSurveyClose(structure, behavior) {
  return structure.showCloseButton === true ||
    behavior.showCloseButton === true ||
    behavior.autoDismiss === true ||
    structure.autoDismiss === true;
}

function firstQuestion(ctx, predicates = []) {
  for (const predicate of predicates) {
    const found = ctx.questions.find((question) => predicate(normalizeIdentifier(question.type), question));
    if (found) return found;
  }
  return ctx.questions[0];
}

function questionKey(question, fallback = 'answer') {
  return String(question?.id || question?.key || question?.name || question?.title || fallback);
}

function questionTitle(question, fallback) {
  return question?.title || question?.label || question?.text || fallback;
}

function questionSubtitle(question, fallback = '') {
  return question?.subtitle || question?.description || fallback;
}

function surveyHeader(ctx, title, subtitle, options = {}) {
  const header = el('header', `apprainier-survey-header${options.alignStart ? ' start' : ''}`);
  if (options.eyebrow) header.append(el('p', 'apprainier-survey-eyebrow', options.eyebrow));
  header.append(el('h2', 'apprainier-survey-title', title || ctx.structure.title || ctx.survey.name || 'Survey'));
  if (subtitle) header.append(el('p', 'apprainier-survey-subtitle', subtitle));
  ctx.card.append(header);
  return header;
}

function surveyActions(ctx, options) {
  const row = el('div', 'apprainier-survey-actions');
  const secondaryText = options.secondaryText || buttonText(ctx.structure, 'secondary', 'Cancel');
  const primaryText = options.primaryText || buttonText(ctx.structure, 'primary', 'Submit');
  const secondary = button(secondaryText, 'apprainier-survey-btn apprainier-survey-secondary', options.onSecondary || ctx.cancel);
  const primary = button(primaryText, 'apprainier-survey-btn apprainier-survey-primary', async () => {
    if (primary.disabled) return;
    await (options.onPrimary || (() => ctx.submit()))();
  });
  const update = () => {
    primary.disabled = options.canSubmit ? !options.canSubmit() : false;
  };
  row.append(secondary, primary);
  ctx.card.append(row);
  update();
  return { row, primary, secondary, update };
}

function optionList(question) {
  return (Array.isArray(question?.options) ? question.options : []).map((option, index) => {
    if (typeof option === 'string') return { value: option.toLowerCase().replace(/\s+/g, '_'), label: option };
    const label = option?.label || option?.text || option?.title || option?.value || `Option ${index + 1}`;
    return {
      ...option,
      value: option?.value || label,
      label,
      description: option?.description || option?.subtitle || '',
      emoji: option?.emoji,
    };
  });
}

function textQuestion(ctx) {
  return ctx.questions.find((question) => {
    const type = normalizeIdentifier(question.type);
    return type === 'text' || type.includes('feedback') || type.includes('textarea') || type.includes('openended');
  }) || {
    id: 'feedback',
    type: 'text',
    title: 'What can we improve?',
    placeholder: 'Optional feedback...',
  };
}

function createTextArea(question, ctx, options = {}) {
  const key = questionKey(question, options.key || 'feedback');
  const wrap = el('div', 'apprainier-survey-textarea-wrap');
  if (options.showLabel !== false) {
    wrap.append(el('p', 'apprainier-survey-question-title', options.label || questionTitle(question, 'What can we improve?')));
  }
  const area = el('textarea', 'apprainier-survey-textarea');
  area.placeholder = options.placeholder || question?.placeholder || 'Please share your suggestions...';
  area.maxLength = Number(question?.maxLength || options.maxLength || 1000);
  area.style.minHeight = `${Number(options.height || question?.inputHeight || 96)}px`;
  area.value = valueToString(ctx.answers[key] || '');
  area.addEventListener('input', () => {
    ctx.answers[key] = area.value;
    if (counter) counter.textContent = `${area.value.length}/${area.maxLength}`;
    options.onInput?.();
  });
  wrap.append(area);
  let counter = null;
  if (options.showCount) {
    counter = el('span', 'apprainier-char-count', `${area.value.length}/${area.maxLength}`);
    wrap.append(counter);
  }
  return wrap;
}

function renderTextFeedbackSurvey(ctx) {
  const question = textQuestion(ctx);
  surveyHeader(
    ctx,
    questionTitle(question, ctx.structure.title || 'Share your feedback'),
    questionSubtitle(question, ctx.structure.subtitle || 'We read every suggestion and use it to improve')
  );
  ctx.card.append(createTextArea(question, ctx, {
    showLabel: false,
    placeholder: question?.placeholder || "What's on your mind?",
    height: 150,
    showCount: true,
    onInput: () => actions.update(),
  }));
  const key = questionKey(question, 'feedback');
  const actions = surveyActions(ctx, {
    primaryText: buttonText(ctx.structure, 'primary', 'Send Feedback'),
    secondaryText: buttonText(ctx.structure, 'secondary', 'Cancel'),
    canSubmit: () => String(ctx.answers[key] || '').trim().length > 0,
  });
}

function renderStarSurvey(ctx) {
  const starQuestion = firstQuestion(ctx, [(type) => type.includes('starrating') || type === 'rating' || type === 'star']);
  const feedbackQuestion = textQuestion(ctx);
  const starStyle = {
    ...objectValue(ctx.style),
    ...objectValue(starQuestion?.style),
  };
  const feedbackStyle = {
    ...objectValue(ctx.style),
    ...objectValue(feedbackQuestion?.style),
  };
  ctx.card.style.setProperty('--ar-star', styleColor(starStyle, ['starFilledColor', 'ratingColor', 'primaryColor'], '#FFD700'));
  ctx.card.style.setProperty('--ar-star-empty', styleColor(starStyle, ['starEmptyColor', 'ratingEmptyColor'], '#E0E0E0'));
  ctx.card.style.setProperty('--ar-title', styleColor(starStyle, ['primaryTextColor', 'titleColor', 'textColor'], '#151922'));
  ctx.card.style.setProperty('--ar-muted', styleColor(starStyle, ['secondaryTextColor', 'subtitleColor', 'descriptionColor', 'textColor'], '#5f6875'));
  ctx.card.style.setProperty('--ar-input-bg', styleColor(feedbackStyle, ['inputBackgroundColor', 'textInputBackgroundColor'], '#F5F5F5'));
  ctx.card.style.setProperty('--ar-input-text', styleColor(feedbackStyle, ['inputTextColor', 'textInputTextColor', 'textColor'], '#151922'));
  ctx.card.style.setProperty('--ar-input-placeholder', styleColor(feedbackStyle, ['hintTextColor', 'inputPlaceholderColor', 'textInputPlaceholderColor'], '#888888'));
  ctx.card.style.setProperty('--ar-input-border', styleColor(feedbackStyle, ['inputBorderColor', 'textInputBorderColor'], '#E0E0E0'));
  const starKey = questionKey(starQuestion, 'rating');
  const feedbackKey = questionKey(feedbackQuestion, 'feedback');
  const alwaysShowFeedback = ctx.behavior.alwaysShowFeedback !== false && ctx.style.alwaysShowFeedback !== false;
  surveyHeader(
    ctx,
    questionTitle(starQuestion, 'How would you rate your experience?'),
    questionSubtitle(starQuestion, 'Your feedback helps us improve')
  );
  const row = el('div', 'apprainier-star-row');
  const feedbackSlot = el('div');
  const max = Number(starQuestion?.maxRating || 5);
  const updateStars = (rating) => {
    ctx.answers[starKey] = rating;
    [...row.children].forEach((child, index) => child.classList.toggle('selected', index < rating));
    renderFeedbackIfNeeded();
    actions.update();
  };
  for (let i = 1; i <= max; i += 1) {
    row.append(button('★', 'apprainier-star-btn', () => updateStars(i)));
  }
  ctx.card.append(row, feedbackSlot);
  function renderFeedbackIfNeeded() {
    const rating = Number(ctx.answers[starKey] || 0);
    const shouldShowFeedback = alwaysShowFeedback || (rating >= 1 && rating <= 3);
    if (!shouldShowFeedback || feedbackSlot.childElementCount > 0) return;
    feedbackSlot.append(createTextArea(feedbackQuestion, ctx, {
      key: feedbackKey,
      label: questionTitle(feedbackQuestion, 'What can we improve?'),
      placeholder: feedbackQuestion?.placeholder || 'Please share your suggestions...',
      height: Number(ctx.style.inputHeight || ctx.style.textInputHeight || feedbackQuestion?.inputHeight || 100),
    }));
  }
  if (alwaysShowFeedback) renderFeedbackIfNeeded();
  const actions = surveyActions(ctx, {
    primaryText: buttonText(ctx.structure, 'primary', 'Send Feedback'),
    secondaryText: buttonText(ctx.structure, 'secondary', 'Maybe Later'),
    canSubmit: () => Number(ctx.answers[starKey]) > 0,
  });
}

function renderThumbsSurvey(ctx) {
  const thumbsQuestion = firstQuestion(ctx, [(type) => type.includes('thumb')]);
  const feedbackQuestion = textQuestion(ctx);
  const thumbsStyle = mergedStyle(ctx.style, thumbsQuestion?.style);
  const feedbackStyle = mergedStyle(ctx.style, feedbackQuestion?.style);
  const thumbsTextColor = styleColor(thumbsStyle, ['textColor', 'titleColor', 'primaryTextColor', 'questionTextColor'], styleColor(ctx.style, ['textColor'], '#111827'));
  const mutedTextColor = styleColor(thumbsStyle, ['subtitleColor', 'descriptionColor', 'secondaryTextColor', 'textColor'], styleColor(ctx.style, ['textColor'], '#2F3437'));
  const feedbackTextColor = styleColor(feedbackStyle, ['textColor', 'titleColor', 'primaryTextColor', 'questionTextColor'], thumbsTextColor);
  ctx.card.style.setProperty('--ar-title', thumbsTextColor);
  ctx.card.style.setProperty('--ar-text', styleColor(ctx.style, ['textColor', 'bodyTextColor'], thumbsTextColor));
  ctx.card.style.setProperty('--ar-muted', mutedTextColor);
  ctx.card.style.setProperty('--ar-choice-text', styleColor(ctx.style, ['optionTextColor', 'choiceTextColor', 'textColor'], thumbsTextColor));
  ctx.card.style.setProperty('--ar-positive-text', styleColor(ctx.style, ['positiveButtonTextColor', 'textColor'], thumbsTextColor));
  ctx.card.style.setProperty('--ar-negative-text', styleColor(ctx.style, ['negativeButtonTextColor', 'textColor'], thumbsTextColor));
  ctx.card.style.setProperty('--ar-input-text', styleColor(feedbackStyle, ['inputTextColor', 'textInputTextColor', 'textColor'], feedbackTextColor));
  ctx.card.style.setProperty('--ar-input-placeholder', styleColor(feedbackStyle, ['hintTextColor', 'inputPlaceholderColor', 'textInputPlaceholderColor'], '#888888'));
  ctx.card.style.setProperty('--ar-input-border', styleColor(feedbackStyle, ['inputBorderColor', 'textInputBorderColor'], '#E0E0E0'));
  const thumbsKey = questionKey(thumbsQuestion, 'thumbs');
  surveyHeader(ctx, questionTitle(thumbsQuestion, 'Did this help?'), questionSubtitle(thumbsQuestion, 'Tell us if this experience worked for you'));
  const options = optionList(thumbsQuestion);
  const positive = options.find((option) => String(option.value).includes('👍') || /yes|up|positive|good/i.test(option.value || option.label)) || { value: true, label: 'Yes' };
  const negative = options.find((option) => String(option.value).includes('👎') || /no|down|negative|bad/i.test(option.value || option.label)) || { value: false, label: 'No' };
  const row = el('div', 'apprainier-thumb-row');
  const feedbackSlot = el('div');
  const ensureFeedbackInput = () => {
    if (feedbackSlot.childElementCount > 0) return;
    feedbackSlot.append(createTextArea(feedbackQuestion, ctx, {
      label: questionTitle(feedbackQuestion, 'What can we improve?'),
      placeholder: feedbackQuestion?.placeholder || 'Please tell us what we can do better...',
      height: 86,
    }));
  };
  const selectThumb = (value, card) => {
    ctx.answers[thumbsKey] = value;
    [...row.children].forEach((child) => child.classList.remove('selected', 'good', 'bad'));
    card.classList.add('selected', value === true ? 'good' : 'bad');
    ensureFeedbackInput();
    actions.update();
  };
  const good = button('', 'apprainier-thumb-card', (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectThumb(true, good);
  });
  good.innerHTML = `<span class="icon">👍</span><span>${positive.label || 'Yes'}</span>`;
  const bad = button('', 'apprainier-thumb-card', (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectThumb(false, bad);
  });
  bad.innerHTML = `<span class="icon">👎</span><span>${negative.label || 'No'}</span>`;
  row.append(good, bad);
  ctx.card.append(row, feedbackSlot);
  const actions = surveyActions(ctx, {
    primaryText: buttonText(ctx.structure, 'primary', 'Submit'),
    secondaryText: buttonText(ctx.structure, 'secondary', 'Cancel'),
    canSubmit: () => ctx.answers[thumbsKey] === true || ctx.answers[thumbsKey] === false,
  });
}

function renderNpsSurvey(ctx) {
  const question = firstQuestion(ctx, [(type) => type.includes('nps') || type.includes('score')]);
  const key = questionKey(question, 'nps_score');
  const commentQuestion = textQuestion(ctx);
  const questionStyle = {
    ...objectValue(ctx.style),
    ...objectValue(question?.style),
  };
  const commentStyle = {
    ...objectValue(ctx.style),
    ...objectValue(commentQuestion?.style),
  };
  ctx.card.style.setProperty('--ar-title', styleColor(questionStyle, ['titleColor', 'questionTextColor', 'npsQuestionTextColor', 'textColor'], '#151922'));
  ctx.card.style.setProperty('--ar-muted', styleColor(questionStyle, ['descriptionColor', 'subtitleColor', 'questionDescriptionColor', 'npsQuestionTextColor', 'textColor'], '#5f6875'));
  ctx.card.style.setProperty('--ar-scale-selected-bg', styleColor(questionStyle, ['selectedNumberBackgroundColor', 'selectedScoreBackgroundColor', 'primaryColor', 'buttonBackgroundColor'], '#007AFF'));
  ctx.card.style.setProperty('--ar-scale-selected-text', styleColor(questionStyle, ['selectedNumberColor', 'selectedScoreColor', 'buttonTextColor'], '#FFFFFF'));
  ctx.card.style.setProperty('--ar-scale-unselected-bg', styleColor(questionStyle, ['unselectedNumberBackgroundColor', 'unselectedScoreBackgroundColor'], '#F5F5F5'));
  ctx.card.style.setProperty('--ar-scale-unselected-text', styleColor(questionStyle, ['unselectedNumberColor', 'unselectedScoreColor', 'textColor'], '#000000'));
  ctx.card.style.setProperty('--ar-input-bg', styleColor(commentStyle, ['commentBackgroundColor', 'textInputBackgroundColor', 'inputBackgroundColor', 'fieldBackgroundColor'], '#F5F5F5'));
  ctx.card.style.setProperty('--ar-input-text', styleColor(commentStyle, ['commentTextColor', 'textInputTextColor', 'inputTextColor', 'textColor'], '#000000'));
  ctx.card.style.setProperty('--ar-input-placeholder', styleColor(commentStyle, ['commentPlaceholderColor', 'textInputPlaceholderColor', 'inputPlaceholderColor', 'hintTextColor'], '#888888'));
  ctx.card.style.setProperty('--ar-input-border', styleColor(commentStyle, ['commentBorderColor', 'textInputBorderColor', 'inputBorderColor', 'fieldBorderColor'], '#E0E0E0'));
  surveyHeader(ctx, questionTitle(question, 'How likely are you to recommend us?'), questionSubtitle(question, 'Choose a score from 0 to 10'));
  const grid = renderScale(question, ctx, key, 0, Number(question?.maxRating || 10), 'apprainier-scale-grid', () => actions.update());
  ctx.card.append(grid);
  const labels = el('div', 'apprainier-scale-labels');
  labels.append(el('span', null, question?.labels?.min || 'Not likely'));
  labels.append(el('span', null, question?.labels?.max || 'Very likely'));
  ctx.card.append(labels);
  ctx.card.append(createTextArea(commentQuestion, ctx, {
    label: 'What is the main reason for your score?',
    placeholder: 'Optional feedback...',
    height: 82,
  }));
  const actions = surveyActions(ctx, {
    primaryText: buttonText(ctx.structure, 'primary', 'Submit'),
    secondaryText: buttonText(ctx.structure, 'secondary', 'Maybe Later'),
    canSubmit: () => Number.isFinite(Number(ctx.answers[key])),
  });
}

function renderCsatSurvey(ctx) {
  const question = firstQuestion(ctx, [(type) => type.includes('csat') || type.includes('satisfaction')]);
  const key = questionKey(question, 'csat_score');
  surveyHeader(ctx, questionTitle(question, 'How satisfied are you?'), questionSubtitle(question, 'Tap the number that best matches your experience'));
  ctx.card.append(renderScale(question, ctx, key, 1, Number(question?.maxRating || 5), 'apprainier-scale-grid csat', () => actions.update()));
  const labels = el('div', 'apprainier-scale-labels');
  labels.append(el('span', null, question?.labels?.min || 'Poor'));
  labels.append(el('span', null, question?.labels?.max || 'Excellent'));
  ctx.card.append(labels);
  const feedbackSlot = el('div');
  ctx.card.append(feedbackSlot);
  const actions = surveyActions(ctx, {
    primaryText: buttonText(ctx.structure, 'primary', 'Submit'),
    secondaryText: buttonText(ctx.structure, 'secondary', 'Maybe Later'),
    canSubmit: () => Number.isFinite(Number(ctx.answers[key])),
  });
  const originalUpdate = actions.update;
  actions.update = () => {
    if (Number.isFinite(Number(ctx.answers[key])) && feedbackSlot.childElementCount === 0) {
      feedbackSlot.append(createTextArea(textQuestion(ctx), ctx, {
        label: 'What could we do better?',
        placeholder: 'Optional feedback...',
        height: 82,
      }));
    }
    originalUpdate();
  };
}

function renderScale(question, ctx, key, min, max, className, onSelect) {
  const grid = el('div', className);
  for (let value = min; value <= max; value += 1) {
    const item = button(String(value), 'apprainier-scale-btn', () => {
      ctx.answers[key] = value;
      [...grid.children].forEach((child) => child.classList.toggle('selected', child.textContent === String(value)));
      onSelect?.();
    });
    item.classList.toggle('selected', Number(ctx.answers[key]) === value);
    grid.append(item);
  }
  return grid;
}

function renderMultipleChoiceSurvey(ctx) {
  const question = firstQuestion(ctx, [(type, q) => type.includes('multiplechoice') || optionList(q).length > 0]);
  renderChoiceSurvey(ctx, question, { multi: true, eyebrow: null });
}

function renderSingleQuestionPollSurvey(ctx) {
  const question = firstQuestion(ctx, [(type, q) => type.includes('poll') || optionList(q).length > 0]);
  renderChoiceSurvey(ctx, question, { multi: false, eyebrow: 'Quick poll' });
}

function renderCustomerDiscoverySurvey(ctx) {
  const question = firstQuestion(ctx, [(type, q) => optionList(q).length > 0]);
  renderChoiceSurvey(ctx, question, { multi: false, eyebrow: 'Customer discovery', followUp: 'Tell us a little more' });
}

function renderPmfSurvey(ctx) {
  ctx.card.classList.add('pmf-survey');
  const choiceQuestion = firstQuestion(ctx, [
    (type, q) =>
      type.includes('singlechoice') ||
      normalizeIdentifier(q?.id || q?.key || q?.name || '').includes('disappointment') ||
      optionList(q).length > 0,
  ]);
  const primaryBenefitQuestion = ctx.questions.find((question) => {
    const id = normalizeIdentifier(question.id || question.key || question.name || '');
    return id === 'primarybenefit' || id.includes('primarybenefit');
  }) || {
    id: 'primary_benefit',
    type: 'text',
    title: 'What is the primary benefit you get from our service?',
    placeholder: 'Please describe the main value you receive...',
  };
  const improvementQuestion = ctx.questions.find((question) => {
    const id = normalizeIdentifier(question.id || question.key || question.name || '');
    return id === 'improvementsuggestions' || id.includes('improvement');
  }) || {
    id: 'improvement_suggestions',
    type: 'text',
    title: 'What could we do to make our service more valuable to you?',
    placeholder: 'Your suggestions help us improve...',
  };
  const choiceKey = questionKey(choiceQuestion, 'disappointment_level');
  const primaryBenefitKey = questionKey(primaryBenefitQuestion, 'primary_benefit');
  const improvementKey = questionKey(improvementQuestion, 'improvement_suggestions');
  const choices = optionList(choiceQuestion).length > 0 ? optionList(choiceQuestion) : [
    { value: 'very_disappointed', label: 'Very disappointed', description: 'It would be a significant loss for me' },
    { value: 'somewhat_disappointed', label: 'Somewhat disappointed', description: 'I would miss it but could find alternatives' },
    { value: 'not_disappointed', label: 'Not disappointed', description: "It wouldn't really affect me" },
  ];

  const valuesFromConditions = (question, fallback) => {
    const conditions = objectValue(question?.conditions);
    const matched = Object.entries(conditions).find(([key]) => normalizeIdentifier(key).includes('disappointment'));
    const value = matched?.[1];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return fallback;
  };
  const benefitConditions = valuesFromConditions(primaryBenefitQuestion, ['very_disappointed']);
  const improvementConditions = valuesFromConditions(improvementQuestion, ['somewhat_disappointed', 'not_disappointed']);
  const content = el('div', 'apprainier-pmf-content');
  ctx.card.append(content);
  let selectedOption = valueToString(ctx.answers[choiceKey] || '');
  let currentStep = 1;

  const selectedOptionNeedsBenefit = () => benefitConditions.includes(selectedOption);
  const selectedOptionNeedsImprovement = () => improvementConditions.includes(selectedOption);
  const totalSteps = () => selectedOption && (selectedOptionNeedsBenefit() || selectedOptionNeedsImprovement()) ? 2 : 1;
  const followUpQuestion = () => selectedOptionNeedsBenefit() ? primaryBenefitQuestion : improvementQuestion;
  const followUpKey = () => selectedOptionNeedsBenefit() ? primaryBenefitKey : improvementKey;
  const submitResponses = async () => {
    const responses = {
      [choiceKey]: selectedOption,
      disappointment_level: selectedOption,
    };
    if (selectedOptionNeedsBenefit() && valueToString(ctx.answers[primaryBenefitKey]).trim()) {
      responses[primaryBenefitKey] = valueToString(ctx.answers[primaryBenefitKey]).trim();
      responses.primary_benefit = valueToString(ctx.answers[primaryBenefitKey]).trim();
    }
    if (selectedOptionNeedsImprovement() && valueToString(ctx.answers[improvementKey]).trim()) {
      responses[improvementKey] = valueToString(ctx.answers[improvementKey]).trim();
      responses.improvement_suggestions = valueToString(ctx.answers[improvementKey]).trim();
    }
    if (selectedOption === 'very_disappointed') {
      responses._segment = 'core_users';
      responses._message = 'Thank you for your strong support!';
    } else if (selectedOption === 'somewhat_disappointed') {
      responses._segment = 'potential_champions';
      responses._message = 'We appreciate your feedback!';
    } else if (selectedOption === 'not_disappointed') {
      responses._segment = 'needs_improvement';
      responses._message = "We'd love to know how we can better serve your needs";
    }
    await ctx.submit(responses, true, 'submitted');
  };

  function renderBadge() {
    if (ctx.behavior.showProgress === false || ctx.behavior.showQuestionCount === false) return;
    const row = el('div');
    row.style.cssText = 'display:grid;justify-items:end;margin-bottom:12px;';
    row.append(el('span', 'apprainier-survey-count', `${currentStep}/${totalSteps()}`));
    content.append(row);
  }

  function renderChoiceStep() {
    currentStep = 1;
    content.replaceChildren();
    renderBadge();
    surveyHeader(
      { ...ctx, card: content },
      questionTitle(choiceQuestion, 'How disappointed would you be if you could no longer use our service?'),
      questionSubtitle(choiceQuestion, 'This helps us understand the value our service provides to you'),
      { alignStart: true },
    );
    const list = el('div', 'apprainier-choice-list pmf');
    for (const option of choices) {
      const isSelected = selectedOption === option.value;
      const row = button('', 'apprainier-choice-row', () => {
        selectedOption = option.value;
        ctx.answers[choiceKey] = option.value;
        [...list.children].forEach((child) => {
          const selected = child.dataset.value === option.value;
          child.classList.toggle('selected', selected);
          child.querySelector('.apprainier-choice-mark').textContent = selected ? '✓' : '';
        });
        refreshActions();
      });
      row.dataset.value = option.value;
      row.classList.toggle('selected', isSelected);
      row.append(el('span', 'apprainier-choice-mark', isSelected ? '✓' : ''));
      const copy = el('span', 'apprainier-choice-copy');
      copy.append(el('span', 'apprainier-choice-label', option.label || option.value));
      if (option.description && option.description !== option.label) {
        copy.append(el('span', 'apprainier-choice-desc', option.description));
      }
      row.append(copy);
      list.append(row);
    }
    content.append(list);
    refreshActions();
  }

  function renderFollowUpStep() {
    currentStep = 2;
    content.replaceChildren();
    renderBadge();
    const question = followUpQuestion();
    surveyHeader(
      { ...ctx, card: content },
      questionTitle(question, selectedOptionNeedsBenefit()
        ? 'What is the primary benefit you get from our service?'
        : 'What could we do to make our service more valuable to you?'),
      questionSubtitle(question, 'A short answer helps us better understand the value you expect from this experience.'),
      { alignStart: true },
    );
    content.append(createTextArea(question, ctx, {
      key: followUpKey(),
      showLabel: false,
      placeholder: question?.placeholder || (selectedOptionNeedsBenefit()
        ? 'Please describe the main value you receive...'
        : 'Your suggestions help us improve...'),
      height: Number(ctx.style.textInputHeight || 120),
      onInput: () => refreshActions(),
    }));
    refreshActions();
    window.setTimeout(() => content.querySelector('textarea')?.focus(), 0);
  }

  const primaryLabel = () => {
    if (currentStep === 1 && selectedOption && totalSteps() > 1) return surveyButtonLabel(ctx.structure, ['nextText'], 'Next');
    return surveyButtonLabel(ctx.structure, ['submitText', 'primary'], 'Submit Response');
  };
  const secondaryLabel = () => {
    if (currentStep === 2) return surveyButtonLabel(ctx.structure, ['previousText'], 'Back');
    return ctx.behavior.allowSkip === false
      ? surveyButtonLabel(ctx.structure, ['cancelText', 'secondary'], 'Cancel')
      : surveyButtonLabel(ctx.structure, ['skipText', 'secondary'], 'Skip');
  };
  const refreshActions = () => {
    actions.primary.textContent = primaryLabel();
    actions.secondary.textContent = secondaryLabel();
    actions.update();
  };
  const actions = surveyActions(ctx, {
    primaryText: primaryLabel(),
    secondaryText: secondaryLabel(),
    canSubmit: () => currentStep === 1 ? Boolean(selectedOption) : true,
    onPrimary: async () => {
      if (currentStep === 1 && totalSteps() > 1) {
        renderFollowUpStep();
        return;
      }
      await submitResponses();
    },
    onSecondary: () => {
      if (currentStep === 2) {
        renderChoiceStep();
      } else {
        ctx.dismiss();
      }
    },
  });
  renderChoiceStep();
}

function renderExitSurvey(ctx) {
  const question = firstQuestion(ctx, [(type, q) => optionList(q).length > 0]);
  renderChoiceSurvey(ctx, question, { multi: false, eyebrow: 'Before you go', followUp: 'What is the main reason?' });
}

function renderChoiceSurvey(ctx, question, options = {}) {
  const key = questionKey(question, 'choice');
  const maxSelections = Number(question?.maxSelections || (options.multi ? 0 : 1));
  const required = question?.required === true;
  const choiceTextColor = resolvedTextStyleColor(ctx.style, question?.style, '#000000');
  const choiceMutedColor = styleValue(ctx.style, ['textColor']) || styleValue(question?.style, ['descriptionColor', 'subtitleColor', 'secondaryTextColor']) || '#666666';
  const selectedChoiceColor = primaryStyleColor(ctx.style, '#007AFF');
  const selectedChoiceTextColor = buttonTextStyleColor(ctx.style, '#FFFFFF');
  const submitButtonColor = buttonBackgroundStyleColor(ctx.style, '#007AFF');
  const secondaryButtonColor = secondaryStyleColor(ctx.style, '#8E8E93');
  ctx.card.style.setProperty('--ar-title', choiceTextColor);
  ctx.card.style.setProperty('--ar-text', choiceTextColor);
  ctx.card.style.setProperty('--ar-muted', choiceMutedColor);
  ctx.card.style.setProperty('--ar-primary', selectedChoiceColor);
  ctx.card.style.setProperty('--ar-button', submitButtonColor);
  ctx.card.style.setProperty('--ar-button-text', selectedChoiceTextColor);
  ctx.card.style.setProperty('--ar-secondary', secondaryButtonColor);
  ctx.card.style.setProperty('--ar-secondary-text', secondaryButtonTextStyleColor(ctx.style, selectedChoiceTextColor));
  ctx.card.style.setProperty('--ar-choice-text', choiceTextColor);
  ctx.card.style.setProperty('--ar-choice-selected-bg', styleColor(ctx.style, ['selectedOptionBackgroundColor', 'selectedChoiceBackgroundColor', 'optionSelectedColor'], `color-mix(in srgb, ${selectedChoiceColor} 16%, white)`));
  ctx.card.style.setProperty('--ar-choice-selected-text', selectedChoiceTextColor);
  ctx.card.style.setProperty('--ar-input-text', choiceTextColor);
  surveyHeader(ctx, questionTitle(question, ctx.structure.title || 'Choose an option'), questionSubtitle(question, ctx.structure.subtitle || ''), { alignStart: true, eyebrow: options.eyebrow });
  if (options.multi) {
    const countRow = el('div');
    countRow.style.cssText = 'display:grid;margin-top:-4px;margin-bottom:8px;';
    const counter = el('span', 'apprainier-survey-count', maxSelections > 0 ? `0 of ${maxSelections} selected` : '0 selected');
    countRow.append(counter);
    ctx.card.append(countRow);
    if (maxSelections > 0) ctx.card.append(el('p', 'apprainier-survey-helper', `Choose up to ${maxSelections} options`));
    renderChoices(ctx, question, key, { multi: true, maxSelections, counter, actionsRef: () => actions });
  } else {
    renderChoices(ctx, question, key, { multi: false, actionsRef: () => actions });
  }
  if (options.followUp) {
    ctx.card.append(createTextArea(textQuestion(ctx), ctx, {
      label: options.followUp,
      placeholder: 'Optional feedback...',
      height: 82,
    }));
  }
  const actions = surveyActions(ctx, {
    primaryText: buttonText(ctx.structure, 'primary', 'Submit'),
    secondaryText: buttonText(ctx.structure, 'secondary', options.multi ? 'Skip' : 'Maybe Later'),
    canSubmit: () => !required || (Array.isArray(ctx.answers[key]) ? ctx.answers[key].length > 0 : Boolean(ctx.answers[key])),
  });
}

function renderChoices(ctx, question, key, config) {
  const list = el('div', 'apprainier-choice-list');
  const options = optionList(question);
  const initialSelection = Array.isArray(ctx.answers[key])
    ? ctx.answers[key]
    : ctx.answers[key] !== undefined
      ? [ctx.answers[key]]
      : [];
  const setSelection = (option, row) => {
    if (config.multi) {
      const current = Array.isArray(ctx.answers[key]) ? ctx.answers[key] : [];
      const exists = current.includes(option.value);
      const atMax = config.maxSelections > 0 && current.length >= config.maxSelections;
      ctx.answers[key] = exists ? current.filter((item) => item !== option.value) : atMax ? current : [...current, option.value];
    } else {
      ctx.answers[key] = option.value;
    }
    const selected = Array.isArray(ctx.answers[key]) ? ctx.answers[key] : [ctx.answers[key]];
    [...list.children].forEach((child) => {
      const isSelected = selected.includes(child.dataset.value);
      const disabled = config.multi && config.maxSelections > 0 && selected.length >= config.maxSelections && !isSelected;
      child.classList.toggle('selected', isSelected);
      child.classList.toggle('disabled', disabled);
      child.querySelector('.apprainier-choice-mark').textContent = isSelected ? '✓' : '';
      child.querySelector('.apprainier-choice-pill')?.remove();
      if (isSelected && config.multi) child.append(el('span', 'apprainier-choice-pill', 'Selected'));
    });
    if (config.counter) {
      config.counter.textContent = config.maxSelections > 0
        ? `${selected.length} of ${config.maxSelections} selected`
        : `${selected.length} selected`;
    }
    config.actionsRef?.()?.update();
  };
  for (const option of options) {
    const isInitiallySelected = initialSelection.includes(option.value);
    const isInitiallyDisabled = config.multi &&
      config.maxSelections > 0 &&
      initialSelection.length >= config.maxSelections &&
      !isInitiallySelected;
    const row = button('', `apprainier-choice-row${config.multi ? ' multi' : ''}`, () => setSelection(option, row));
    row.dataset.value = option.value;
    row.classList.toggle('selected', isInitiallySelected);
    row.classList.toggle('disabled', isInitiallyDisabled);
    row.append(el('span', 'apprainier-choice-mark', isInitiallySelected ? '✓' : ''));
    const copy = el('span', 'apprainier-choice-copy');
    copy.append(el('span', 'apprainier-choice-label', option.label));
    if (option.description && option.description !== option.label) copy.append(el('span', 'apprainier-choice-desc', option.description));
    row.append(copy);
    if (isInitiallySelected && config.multi) row.append(el('span', 'apprainier-choice-pill', 'Selected'));
    list.append(row);
  }
  if (config.counter) {
    config.counter.textContent = config.maxSelections > 0
      ? `${initialSelection.length} of ${config.maxSelections} selected`
      : `${initialSelection.length} selected`;
  }
  ctx.card.append(list);
}

function renderEmojiMoodSurvey(ctx) {
  const question = firstQuestion(ctx, [(type) => type.includes('emoji') || type.includes('mood')]);
  const key = questionKey(question, 'mood');
  const emojiStyle = mergedStyle(ctx.style, question?.style);
  const emojiTextColor = resolvedTextStyleColor(ctx.style, question?.style, '#000000');
  const emojiMutedColor = styleColor(emojiStyle, ['descriptionColor', 'subtitleColor', 'secondaryTextColor'], styleValue(ctx.style, ['textColor']) || '#666666');
  const emojiPrimaryColor = primaryStyleColor(ctx.style, '#007AFF');
  const emojiButtonColor = buttonBackgroundStyleColor(ctx.style, emojiPrimaryColor);
  const emojiButtonTextColor = buttonTextStyleColor(ctx.style, '#FFFFFF');
  ctx.card.style.setProperty('--ar-title', emojiTextColor);
  ctx.card.style.setProperty('--ar-text', emojiTextColor);
  ctx.card.style.setProperty('--ar-muted', emojiMutedColor);
  ctx.card.style.setProperty('--ar-primary', emojiPrimaryColor);
  ctx.card.style.setProperty('--ar-button', emojiButtonColor);
  ctx.card.style.setProperty('--ar-button-text', emojiButtonTextColor);
  ctx.card.style.setProperty('--ar-secondary', secondaryStyleColor(ctx.style, '#8E8E93'));
  ctx.card.style.setProperty('--ar-secondary-text', secondaryButtonTextStyleColor(ctx.style, emojiTextColor));
  ctx.card.style.setProperty('--ar-choice-text', styleColor(emojiStyle, ['optionTextColor', 'choiceTextColor'], emojiTextColor));
  ctx.card.style.setProperty('--ar-choice-selected-bg', styleColor(emojiStyle, ['selectedOptionBackgroundColor', 'selectedChoiceBackgroundColor', 'optionSelectedColor'], `color-mix(in srgb, ${emojiPrimaryColor} 14%, white)`));
  ctx.card.style.setProperty('--ar-choice-selected-text', styleColor(emojiStyle, ['selectedOptionTextColor', 'selectedChoiceTextColor'], emojiButtonTextColor));
  ctx.card.style.setProperty('--ar-choice-icon-bg', styleColor(emojiStyle, ['emojiBackgroundColor', 'iconBackgroundColor', 'optionIconBackgroundColor'], 'rgba(255,255,255,.9)'));
  const defaults = [
    { value: 'angry', emoji: '😡', label: 'Hate it' },
    { value: 'neutral', emoji: '😕', label: 'Not great' },
    { value: 'okay', emoji: '🙂', label: "It's okay" },
    { value: 'good', emoji: '😃', label: 'Like it' },
    { value: 'love', emoji: '🤩', label: 'Love it!' },
  ];
  const options = optionList(question).length > 0 ? optionList(question) : defaults;
  surveyHeader(ctx, questionTitle(question, 'How do you feel?'), questionSubtitle(question, 'Pick the feeling that matches closest'), { eyebrow: 'Mood check' });
  const grid = el('div', 'apprainier-emoji-grid');
  for (const option of options) {
    const card = button('', 'apprainier-emoji-card', () => {
      ctx.answers[key] = option.value;
      [...grid.children].forEach((child) => child.classList.toggle('selected', child.dataset.value === option.value));
      actions.update();
    });
    card.dataset.value = option.value;
    card.append(el('span', 'apprainier-emoji-symbol', option.emoji || option.label || '🙂'));
    card.append(el('span', 'apprainier-emoji-label', option.label || option.value));
    grid.append(card);
  }
  ctx.card.append(grid);
  const actions = surveyActions(ctx, {
    primaryText: buttonText(ctx.structure, 'primary', 'Submit'),
    secondaryText: buttonText(ctx.structure, 'secondary', 'Skip'),
    canSubmit: () => Boolean(ctx.answers[key]),
  });
}

function renderPostSupportSurvey(ctx) {
  ctx.card.classList.add('post-support');
  const supportQuestion = firstQuestion(ctx, [(type) => type.includes('thumb')]);
  const commentQuestion = ctx.questions.find((question) => {
    const type = normalizeIdentifier(question.type);
    const id = normalizeIdentifier(question.id || question.key || question.name || '');
    return id === 'supportcomment' || type === 'text' || type.includes('feedback') || type.includes('textarea') || type.includes('openended');
  }) || {
    id: 'support_comment',
    type: 'text',
    title: 'Any additional feedback?',
    placeholder: 'Tell us how we can improve...',
  };
  const supportStyle = mergedStyle(ctx.style, supportQuestion?.style);
  const commentStyle = mergedStyle(ctx.style, commentQuestion?.style);
  const supportTextColor = resolvedTextStyleColor(ctx.style, supportQuestion?.style, '#000000');
  const supportMutedColor = resolvedTextStyleColor(ctx.style, supportQuestion?.style, '#666666');
  const commentTextColor = resolvedTextStyleColor(ctx.style, commentQuestion?.style, supportTextColor);
  const selectedTextColor = buttonTextStyleColor(ctx.style, '#FFFFFF');
  ctx.card.style.setProperty('--ar-title', supportTextColor);
  ctx.card.style.setProperty('--ar-text', supportTextColor);
  ctx.card.style.setProperty('--ar-muted', supportMutedColor);
  ctx.card.style.setProperty('--ar-support-text', supportTextColor);
  ctx.card.style.setProperty('--ar-support-desc', supportMutedColor);
  ctx.card.style.setProperty('--ar-support-selected-text', selectedTextColor);
  ctx.card.style.setProperty('--ar-support-selected-desc', selectedTextColor);
  ctx.card.style.setProperty('--ar-input-text', commentTextColor);
  ctx.card.style.setProperty('--ar-input-placeholder', styleColor(commentStyle, ['textInputPlaceholderColor', 'inputPlaceholderColor', 'hintTextColor'], '#888888'));
  ctx.card.style.setProperty('--ar-input-border', styleColor(commentStyle, ['textInputBorderColor', 'inputBorderColor'], '#E0E0E0'));
  const ratingKey = questionKey(supportQuestion, 'support_rating');
  const commentKey = questionKey(commentQuestion, 'support_comment');
  const options = optionList(supportQuestion);
  const positiveOption = options.find((option) => String(option.value).includes('👍') || /yes|up|positive|good|helpful/i.test(option.value || option.label)) || {};
  const negativeOption = options.find((option) => String(option.value).includes('👎') || /no|down|negative|bad|not/i.test(option.value || option.label)) || {};
  const rawTitle = questionTitle(supportQuestion, 'Was this answer helpful?');
  const rawSubtitle = questionSubtitle(supportQuestion, 'A quick check-in helps us understand whether support solved the issue clearly.');
  const commentTitle = questionTitle(commentQuestion, 'Any additional feedback?');
  const commentPlaceholder = commentQuestion?.placeholder || 'Tell us how we can improve...';
  const positiveLabel = /helpful/i.test(positiveOption.label || '') ? 'Yes' : positiveOption.label || 'Yes';
  const negativeLabel = /not helpful/i.test(negativeOption.label || '') ? 'No' : negativeOption.label || 'No';
  const positiveDescription = /solved my issue/i.test(positiveOption.description || '')
    ? 'That answer resolved what you needed.'
    : positiveOption.description || 'That answer resolved what you needed.';
  const negativeDescription = /still need help/i.test(negativeOption.description || '')
    ? 'Something still felt incomplete or off.'
    : negativeOption.description || 'Something still felt incomplete or off.';
  let currentStep = 1;
  let selectedThumb = null;
  const meta = el('div', 'apprainier-support-meta');
  const countBadge = el('span', 'apprainier-survey-count', '1/1');
  meta.append(countBadge);
  ctx.card.append(meta);
  const content = el('div', 'apprainier-post-support-content');
  ctx.card.append(content);

  function renderLocalHeader(title, subtitle, options = {}) {
    const header = el('header', `apprainier-survey-header${options.alignStart ? ' start' : ''}`);
    if (options.eyebrow) header.append(el('p', 'apprainier-survey-eyebrow', options.eyebrow));
    header.append(el('h2', 'apprainier-survey-title', title));
    if (subtitle) header.append(el('p', 'apprainier-survey-subtitle', subtitle));
    content.append(header);
  }

  function renderChoiceCard(value, emoji, label, description) {
    const accent = value
      ? styleColor(ctx.style, ['positiveButtonColor', 'positiveColor', 'successColor', 'primaryColor', 'buttonBackgroundColor'], '#0f8f7f')
      : styleColor(ctx.style, ['negativeButtonColor', 'negativeColor', 'errorColor'], '#ef4444');
    const selectedText = value
      ? styleColor(ctx.style, ['positiveButtonTextColor', 'buttonTextColor'], selectedTextColor)
      : styleColor(ctx.style, ['negativeButtonTextColor', 'buttonTextColor'], selectedTextColor);
    const card = button('', 'apprainier-support-card', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectedThumb = value;
      ctx.answers[ratingKey] = value ? '👍' : '👎';
      renderStepOne();
    });
    card.style.setProperty('--ar-support-accent', accent);
    card.style.setProperty('--ar-support-selected-text', selectedText);
    card.style.setProperty('--ar-support-selected-desc', selectedText);
    card.classList.toggle('selected', selectedThumb === value);
    card.append(
      el('div', 'icon', emoji),
      el('strong', null, label),
      el('span', 'apprainier-choice-desc', description),
    );
    return card;
  }

  function updateActions() {
    const totalSteps = selectedThumb === false ? 2 : 1;
    countBadge.textContent = `${currentStep}/${totalSteps}`;
    if (!actions) return;
    actions.primary.textContent = currentStep === 1 && selectedThumb === false
      ? 'Continue'
      : buttonText(ctx.structure, 'primary', 'Submit');
    actions.secondary.textContent = currentStep === 2
      ? 'Back'
      : surveyButtonLabel(ctx.structure, ['skipText'], 'Skip');
    actions.update();
  }

  function renderStepOne() {
    currentStep = 1;
    content.replaceChildren();
    renderLocalHeader(
      /how was support/i.test(rawTitle) ? 'Was this answer helpful?' : rawTitle,
      /help us improve your support experience/i.test(rawSubtitle)
        ? 'A quick check-in helps us understand whether support solved the issue clearly.'
        : rawSubtitle,
      { eyebrow: 'Support follow-up' },
    );
    const row = el('div', 'apprainier-support-grid');
    row.append(
      renderChoiceCard(true, '👍', positiveLabel, positiveDescription),
      renderChoiceCard(false, '👎', negativeLabel, negativeDescription),
    );
    content.append(row);
    updateActions();
  }

  function renderStepTwo() {
    currentStep = 2;
    content.replaceChildren();
    renderLocalHeader(
      commentTitle,
      'Optional notes help our team understand what felt confusing, incomplete, or frustrating.',
      { eyebrow: 'Tell us more', alignStart: true },
    );
    content.append(createTextArea(commentQuestion, ctx, {
      key: commentKey,
      showLabel: false,
      placeholder: commentPlaceholder,
      height: 104,
    }));
    content.append(el('p', 'apprainier-survey-helper', 'Optional, but especially helpful when support missed the mark.'));
    updateActions();
    window.setTimeout(() => content.querySelector('textarea')?.focus(), 0);
  }

  let actions = null;
  actions = surveyActions(ctx, {
    primaryText: buttonText(ctx.structure, 'primary', 'Submit'),
    secondaryText: surveyButtonLabel(ctx.structure, ['skipText'], 'Skip'),
    canSubmit: () => currentStep === 2 || selectedThumb !== null,
    onPrimary: async () => {
      if (currentStep === 1 && selectedThumb === false) {
        renderStepTwo();
        return;
      }
      await ctx.submit(ctx.answers, true, 'submitted');
    },
    onSecondary: () => {
      if (currentStep === 2) {
        renderStepOne();
      } else {
        ctx.dismiss();
      }
    },
  });
  renderStepOne();
}

function renderMultiStepSurvey(ctx) {
  let index = 0;
  const localAnswers = ctx.answers;
  const behavior = ctx.behavior || {};
  const totalSteps = Math.max(1, ctx.questions.length);
  const showQuestionCount = behavior.showQuestionCount !== false;
  const showProgress = behavior.showProgress !== false;
  const allowSkip = behavior.allowSkip !== false;
  const autoAdvance = behavior.autoAdvance !== false;
  const content = el('div');
  ctx.card.append(content);

  const primaryLabel = () => index === totalSteps - 1
    ? surveyButtonLabel(ctx.structure, ['submitText', 'primary'], 'Submit')
    : surveyButtonLabel(ctx.structure, ['nextText'], 'Next');
  const secondaryLabel = () => index > 0
    ? surveyButtonLabel(ctx.structure, ['previousText'], 'Back')
    : allowSkip
      ? surveyButtonLabel(ctx.structure, ['skipText', 'secondary'], 'Skip')
      : surveyButtonLabel(ctx.structure, ['cancelText', 'secondary'], 'Cancel');
  const refreshActions = () => {
    actions.primary.textContent = primaryLabel();
    actions.secondary.textContent = secondaryLabel();
    actions.update();
  };
  const goNext = async () => {
    if (index < totalSteps - 1) {
      index += 1;
      renderStep();
      refreshActions();
    } else {
      await ctx.submit(localAnswers, true, 'submitted');
    }
  };
  const renderStep = () => {
    content.replaceChildren();
    const question = ctx.questions[index];
    if (showQuestionCount && totalSteps > 1) {
      const countRow = el('div');
      countRow.style.cssText = 'display:grid;justify-items:end;margin-bottom:10px;';
      countRow.append(el('span', 'apprainier-survey-count', `Step ${index + 1} of ${totalSteps}`));
      content.append(countRow);
    }
    if (showProgress && totalSteps > 1) {
      const progress = el('div', 'apprainier-step-progress');
      const bar = el('span');
      bar.style.width = `${Math.round(((index + 1) / totalSteps) * 100)}%`;
      progress.append(bar);
      content.append(progress);
    }
    const requiredRow = el('div');
    requiredRow.style.cssText = 'display:grid;justify-items:start;margin:18px 0 12px;';
    requiredRow.append(el('span', 'apprainier-survey-count', question?.required === false ? 'Optional' : 'Required'));
    content.append(requiredRow);
    const tmpCtx = { ...ctx, card: content, answers: localAnswers };
    surveyHeader(tmpCtx, questionTitle(question, `Question ${index + 1}`), questionSubtitle(question, ''), { alignStart: true });
    const stepIndex = index;
    renderQuestionInput(tmpCtx, question, () => {
      actions.update();
      const type = normalizeIdentifier(question?.type);
      const shouldAutoAdvance = autoAdvance &&
        stepIndex === index &&
        index < totalSteps - 1 &&
        isQuestionAnswered(localAnswers, question) &&
        (type.includes('singlechoice') || type.includes('csat'));
      if (shouldAutoAdvance) {
        window.setTimeout(() => {
          if (stepIndex === index) goNext();
        }, 160);
      }
    });
  };
  const actions = surveyActions(ctx, {
    primaryText: primaryLabel(),
    secondaryText: secondaryLabel(),
    onSecondary: () => {
      if (index === 0) return ctx.cancel();
      index -= 1;
      renderStep();
      refreshActions();
    },
    onPrimary: goNext,
    canSubmit: () => isQuestionAnswered(localAnswers, ctx.questions[index]),
  });
  renderStep();
  refreshActions();
}

function renderQuestionInput(ctx, question, onChange) {
  const type = normalizeIdentifier(question?.type);
  const key = questionKey(question, 'answer');
  if (type.includes('star')) {
    renderInlineStarInput(ctx, question, key, onChange);
    return;
  }
  if (type.includes('csat') || type.includes('rating') || type.includes('score') || type.includes('nps')) {
    ctx.card.append(renderScale(question, ctx, key, type.includes('nps') ? 0 : 1, Number(question?.maxRating || (type.includes('nps') ? 10 : 5)), `apprainier-scale-grid${type.includes('csat') ? ' csat' : ''}`, onChange));
    return;
  }
  if (type.includes('emoji') || type.includes('mood')) {
    renderInlineEmojiInput(ctx, question, key, onChange);
    return;
  }
  if (optionList(question).length > 0 || type.includes('choice') || type.includes('poll')) {
    renderChoices(ctx, question, key, { multi: Number(question?.maxSelections || 1) > 1, maxSelections: Number(question?.maxSelections || 0), actionsRef: () => ({ update: onChange }) });
    return;
  }
  ctx.card.append(createTextArea(question, ctx, { showLabel: false, height: 96, onInput: onChange }));
}

function renderInlineStarInput(ctx, question, key, onChange) {
  const row = el('div', 'apprainier-star-row');
  const max = Number(question?.maxRating || 5);
  const current = Number(ctx.answers[key] || 0);
  for (let i = 1; i <= max; i += 1) {
    const star = button('★', 'apprainier-star-btn', () => {
      ctx.answers[key] = i;
      [...row.children].forEach((child, index) => child.classList.toggle('selected', index < i));
      onChange?.();
    });
    star.classList.toggle('selected', i <= current);
    row.append(star);
  }
  ctx.card.append(row);
}

function renderInlineEmojiInput(ctx, question, key, onChange) {
  const options = optionList(question).length > 0 ? optionList(question) : [
    { value: 'angry', emoji: '😡', label: 'Hate it' },
    { value: 'neutral', emoji: '😕', label: 'Not great' },
    { value: 'okay', emoji: '🙂', label: "It's okay" },
    { value: 'good', emoji: '😃', label: 'Like it' },
    { value: 'love', emoji: '🤩', label: 'Love it!' },
  ];
  const grid = el('div', 'apprainier-emoji-grid');
  for (const option of options) {
    const card = button('', 'apprainier-emoji-card', () => {
      ctx.answers[key] = option.value;
      [...grid.children].forEach((child) => child.classList.toggle('selected', child.dataset.value === option.value));
      onChange?.();
    });
    card.dataset.value = option.value;
    card.classList.toggle('selected', ctx.answers[key] === option.value);
    card.append(el('span', 'apprainier-emoji-symbol', option.emoji || option.label || '🙂'));
    card.append(el('span', 'apprainier-emoji-label', option.label || option.value));
    grid.append(card);
  }
  ctx.card.append(grid);
}

function isQuestionAnswered(answers, question) {
  if (question?.required === false) return true;
  const value = answers[questionKey(question, 'answer')];
  return Array.isArray(value) ? value.length > 0 : value !== undefined && String(value).trim() !== '';
}

function renderGenericSurvey(ctx) {
  const question = ctx.questions[0];
  surveyHeader(ctx, ctx.structure.title || questionTitle(question, ctx.survey.name || 'Survey'), ctx.structure.subtitle || questionSubtitle(question, ''));
  renderQuestionInput(ctx, question, () => actions.update());
  const actions = surveyActions(ctx, {
    primaryText: buttonText(ctx.structure, 'primary', 'Submit'),
    secondaryText: buttonText(ctx.structure, 'secondary', 'Cancel'),
    canSubmit: () => isQuestionAnswered(ctx.answers, question),
  });
}

function buttonText(structure, role, fallback) {
  const buttons = structure.buttons || {};
  if (role === 'primary') {
    return buttons.primary?.text || buttons.submitText?.text || buttons.confirmText?.text || fallback;
  }
  return buttons.secondary?.text || buttons.cancelText?.text || buttons.skipText?.text || buttons.dismissText?.text || fallback;
}

function surveyButtonLabel(structure, keys, fallback) {
  const buttons = structure.buttons || {};
  for (const key of keys) {
    const candidate = buttons[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (candidate?.text && String(candidate.text).trim()) return String(candidate.text).trim();
  }
  return fallback;
}

function renderQuestion(question, answers) {
  const wrapper = el('div', 'apprainier-field');
  const id = question.id || question.title || randomId('q');
  wrapper.append(el('label', null, question.title || question.description || 'Question'));
  if (question.subtitle) wrapper.append(el('p', 'apprainier-subtitle', question.subtitle));
  const type = String(question.type || 'text').toLowerCase();
  if (type.includes('choice') || type.includes('poll') || type.includes('select')) {
    const maxSelections = Number(question.maxSelections || (type.includes('multi') ? 99 : 1));
    const options = el('div', 'apprainier-options');
    for (const option of question.options || []) {
      const label = option.label || option.description || option.value || String(option);
      const value = option.value || label;
      const opt = button(label, 'apprainier-option', () => {
        const current = Array.isArray(answers[id]) ? answers[id] : [];
        const exists = current.includes(value);
        const next = maxSelections === 1
          ? [value]
          : exists
            ? current.filter((item) => item !== value)
            : current.length < maxSelections
              ? [...current, value]
              : current;
        answers[id] = maxSelections === 1 ? next[0] : next;
        for (const child of options.children) {
          child.setAttribute('aria-pressed', String(next.includes(child.dataset.value)));
        }
      });
      opt.dataset.value = value;
      opt.setAttribute('aria-pressed', 'false');
      options.append(opt);
    }
    wrapper.append(options);
    return wrapper;
  }
  if (type.includes('rating') || type.includes('score') || type.includes('nps') || type.includes('satisfaction')) {
    const min = Number(question.minRating ?? (type.includes('nps') ? 0 : 1));
    const max = Number(question.maxRating ?? question.scale ?? (type.includes('nps') ? 10 : 5));
    const rating = el('div', 'apprainier-rating');
    for (let value = min; value <= max; value += 1) {
      const option = button(String(value), '', () => {
        answers[id] = value;
        for (const child of rating.children) child.setAttribute('aria-pressed', String(child.textContent === String(value)));
      });
      option.setAttribute('aria-pressed', 'false');
      rating.append(option);
    }
    wrapper.append(rating);
    return wrapper;
  }
  const textarea = el('textarea', 'apprainier-textarea');
  textarea.placeholder = question.placeholder || 'Share your thoughts...';
  textarea.maxLength = Number(question.maxLength || 1000);
  textarea.addEventListener('input', () => {
    answers[id] = textarea.value;
  });
  wrapper.append(textarea);
  return wrapper;
}

function surveyPayload(survey, eventName, responses) {
  return {
    surveyId: survey.$id,
    surveyName: survey.name,
    eventName,
    responses,
  };
}

async function submitSurveyInteraction(survey, eventName, responses, completed, outcome) {
  await executeGateway('submit_survey_response', {
    userId: getEffectiveUserId(),
    ownerId: getEffectiveUserId().slice(0, 36),
    surveyId: survey.$id,
    surveyName: survey.name || null,
    userName: getUserName(),
    userEmail: getUserEmail(),
    platform: 'web',
    appVersion: valueToString(state.appProperties.app_version || '1'),
    responses: stringifySafe(responses),
    answers: stringifySafe(responses),
    completed,
    score: null,
    completionTime: Math.floor(Date.now() / 1000),
    deviceInfo: valueToString(state.deviceProperties.device_model || 'web'),
    metadata: stringifySafe({ eventName, outcome, runtime: 'web' }),
    submittedAt: nowIso(),
  }).catch((error) => console.warn('[AppRainier] Failed to submit survey response', error));
}

function renderAnnouncementDialog(announcement, eventName) {
  injectStyles();
  const structure = parseStructure(announcement);
  const config = parseConfig(announcement);
  const merged = mergedAnnouncementConfig(structure, config);
  const style = merged.style;
  const behavior = merged.behavior;
  const layout = merged.layout;
  const fieldStyles = merged.fieldStyles;
  const type = normalizeIdentifier(structure.type || announcement.templateId || '');
  const fullscreen = layout.position === 'fullscreen' || type.includes('fullscreen') || behavior.fullscreen === true || behavior.showAsFullscreen === true;
  const overlay = el('div', `apprainier-overlay${fullscreen ? ' apprainier-fullscreen' : ''}`);
  const dialog = el('section', 'apprainier-dialog apprainier-ann-dialog');
  const background = styleColor(style, ['backgroundColor', 'containerBackgroundColor', 'cardBackgroundColor'], fullscreen ? '#ffffff' : '#eaf8f6');
  const primaryColor = primaryStyleColor(style);
  const buttonTextColor = buttonTextStyleColor(style);
  const secondaryColor = secondaryStyleColor(style);
  const secondaryTextColor = secondaryButtonTextStyleColor(style, '#454b54');
  dialog.style.setProperty('--ar-ann-bg', background);
  dialog.style.setProperty('--ar-ann-primary', primaryColor);
  dialog.style.setProperty('--ar-ann-icon', iconColorFor(style));
  dialog.style.setProperty('--ar-button', primaryColor);
  dialog.style.setProperty('--ar-button-text', buttonTextColor);
  dialog.style.setProperty('--ar-secondary', secondaryColor);
  dialog.style.setProperty('--ar-secondary-text', secondaryTextColor);
  dialog.style.setProperty('--ar-ann-title', fieldStyleValue(fieldStyles, 'title', 'textColor', style.titleColor || style.textColor || '#151922'));
  dialog.style.setProperty('--ar-ann-subtitle', fieldStyleValue(fieldStyles, 'subtitle', 'textColor', style.subtitleColor || '#5f6875'));
  dialog.style.setProperty('--ar-ann-description', fieldStyleValue(fieldStyles, 'description', 'textColor', style.descriptionColor || style.textColor || '#20242b'));
  dialog.style.setProperty('--ar-ann-bullet', styleColor(style, ['bulletColor', 'primaryColor', 'iconColor', 'buttonBackgroundColor'], primaryColor));
  dialog.style.setProperty('--ar-ann-bullet-text', styleColor(style, ['bulletTextColor', 'textColor'], '#20242b'));
  dialog.style.background = background;
  dialog.style.color = styleColor(style, ['textColor', 'bodyTextColor'], '#111827');
  overlay.append(dialog);

  const preventClose = behavior.preventClose === true || structure.preventClose === true;
  if (!preventClose) {
    dialog.append(button('×', 'apprainier-close', async () => {
      const responses = {
        action: 'dismissed',
        button_clicked: 'dismissed',
        interaction_outcome: 'dismissed',
      };
      const responseId = await submitAnnouncementInteraction(announcement, eventName, responses, 'dismissed', {
        completed: false,
      });
      await trackAnnouncementResponseEvents(announcement, eventName, responses, false, responseId);
      await trackAnnouncementEvent('announcement_dismissed', announcement, {
        event_name: eventName,
        eventName,
        button_clicked: 'dismissed',
        interaction_outcome: 'dismissed',
        completion_time: announcementCompletionTime(announcement),
      });
      emit(AppRainierEvents.announcementDismissed, announcementPayload(announcement, eventName, 'dismissed'));
      closeOverlay(overlay);
    }));
  }

  const carouselItems = announcementCarouselItems(structure);
  if (isCarouselAnnouncement(announcement, structure, carouselItems)) {
    renderCarouselAnnouncementDialog(dialog, announcement, eventName, overlay, structure, style, carouselItems);
    document.body.append(overlay);
    return;
  }

  const imageUrl = structure.image || structure.imageUrl || structure.heroImage;
  if (imageUrl) {
    const img = el('img');
    img.src = imageUrl;
    img.alt = structure.title || announcement.name || 'Announcement';
    img.style.cssText = 'width:100%;max-height:260px;object-fit:cover;border-radius:24px;margin-bottom:24px;box-shadow:0 14px 32px rgba(15,23,42,.12);';
    dialog.append(img);
  }

  dialog.append(renderAnnouncementIcon(structure, style));
  const title = el('h2', 'apprainier-ann-title', structure.title || announcement.name || 'Announcement');
  applyAnnouncementTextStyle(title, fieldStyles.title);
  dialog.append(title);
  const subtitle = structure.subtitle || announcement.description;
  if (subtitle) {
    const subtitleNode = el('p', 'apprainier-ann-subtitle', subtitle);
    applyAnnouncementTextStyle(subtitleNode, fieldStyles.subtitle);
    dialog.append(subtitleNode);
  }
  if (structure.description || (Array.isArray(structure.bullets) && structure.bullets.length > 0)) {
    const panel = el('div', 'apprainier-ann-panel');
    if (structure.description) {
      const description = el('p', 'apprainier-ann-description', structure.description);
      applyAnnouncementTextStyle(description, fieldStyles.description);
      panel.append(description);
    }
    if (Array.isArray(structure.bullets) && structure.bullets.length > 0) {
      const list = el('ul', 'apprainier-ann-list');
      for (const item of structure.bullets) list.append(el('li', null, item));
      panel.append(list);
    }
    dialog.append(panel);
  }
  const actions = el('div', 'apprainier-buttons');
  const secondaryText = buttonText(structure, 'secondary', 'Maybe Later');
  const primaryText = buttonText(structure, 'primary', 'Continue');
  const secondaryVisible = structure.buttons?.secondary?.visible !== false;
  const primaryVisible = structure.buttons?.primary?.visible !== false;
  if (secondaryVisible) {
    const secondary = button(secondaryText, 'apprainier-button apprainier-secondary', async () => {
      await handleAnnouncementAction(announcement, eventName, 'secondary', overlay);
    });
    secondary.style.background = secondaryColor;
    secondary.style.color = secondaryTextColor;
    actions.append(secondary);
  }
  const primary = button(primaryText, 'apprainier-button apprainier-primary', async () => {
    await handleAnnouncementAction(announcement, eventName, 'primary', overlay);
  });
  primary.style.background = primaryColor;
  primary.style.color = buttonTextColor;
  if (primaryVisible) actions.append(primary);
  if (actions.children.length > 0) dialog.append(actions);
  document.body.append(overlay);
}

function applyAnnouncementTextStyle(node, fieldStyle = {}) {
  if (!fieldStyle || typeof fieldStyle !== 'object') return;
  if (fieldStyle.textColor) node.style.color = fieldStyle.textColor;
  if (fieldStyle.fontWeight) node.style.fontWeight = fieldStyle.fontWeight;
  if (fieldStyle.fontFamily && fieldStyle.fontFamily !== 'System') node.style.fontFamily = fieldStyle.fontFamily;
  const sizeMap = { small: '15px', medium: '18px', large: '30px', xlarge: '36px' };
  if (fieldStyle.fontSize) node.style.fontSize = sizeMap[fieldStyle.fontSize] || fieldStyle.fontSize;
}

function isCarouselAnnouncement(announcement, structure, items) {
  const type = normalizeIdentifier(structure.type || announcement.templateId || announcement.name);
  return type.includes('carousel') || items.length > 0;
}

function announcementCarouselItems(structure) {
  const rawItems = Array.isArray(structure.items)
    ? structure.items
    : Array.isArray(structure.carouselItems)
      ? structure.carouselItems
      : [];
  return rawItems.map((item, index) => ({
    index,
    imageUrl: item.imageUrl || item.imageURL || item.image || item.heroImage || '',
    title: item.title || `Item ${index + 1}`,
    description: item.description || item.subtitle || '',
    deepLink: item.deepLink || item.deeplink || item.target || item.action?.target || null,
    backgroundColor: item.backgroundColor || '#e2e8f0',
    textColor: item.textColor || null,
  }));
}

function renderCarouselAnnouncementDialog(dialog, announcement, eventName, overlay, structure, style, items) {
  let index = 0;
  let timer = null;
  const showIndicators = structure.showIndicators !== false;
  const autoAdvance = structure.autoAdvance === true && items.length > 1;
  const intervalMs = Math.max(1200, Number(structure.autoAdvanceInterval || 3000));
  const carousel = el('div', 'apprainier-ann-carousel');
  const primaryColor = primaryStyleColor(style, '#087ff5');
  const buttonTextColor = buttonTextStyleColor(style);
  const secondaryColor = secondaryStyleColor(style);
  const secondaryTextColor = secondaryButtonTextStyleColor(style);
  dialog.style.setProperty('--ar-ann-primary', primaryColor);
  dialog.style.setProperty('--ar-button', primaryColor);
  dialog.style.setProperty('--ar-button-text', buttonTextColor);
  dialog.style.setProperty('--ar-secondary', secondaryColor);
  dialog.style.setProperty('--ar-secondary-text', secondaryTextColor);
  dialog.style.setProperty('--ar-ann-title', styleColor(style, ['titleColor', 'textColor'], '#0f172a'));
  dialog.style.setProperty('--ar-ann-muted', styleColor(style, ['descriptionColor', 'subtitleColor', 'mutedTextColor'], '#64748b'));

  const dots = el('div', 'apprainier-ann-indicators');
  const count = el('div', 'apprainier-ann-count');
  const imageFrame = el('div', 'apprainier-ann-image');
  const copy = el('div', 'apprainier-ann-slide-copy');
  const title = el('h2', 'apprainier-ann-slide-title');
  const description = el('p', 'apprainier-ann-slide-desc');
  const slideIndex = el('p', 'apprainier-ann-slide-index');

  const render = () => {
    const item = items[index] || {};
    imageFrame.style.background = item.backgroundColor || '#e2e8f0';
    imageFrame.replaceChildren();
    if (item.imageUrl) {
      const img = el('img');
      img.src = item.imageUrl;
      img.alt = item.title || announcement.name || 'Announcement';
      img.loading = 'eager';
      img.onerror = () => {
        imageFrame.replaceChildren(el('span', 'apprainier-ann-placeholder', `Image ${index + 1}`));
      };
      imageFrame.append(img);
    } else {
      imageFrame.append(el('span', 'apprainier-ann-placeholder', `Image ${index + 1}`));
    }
    title.textContent = item.title || structure.title || announcement.name || 'Announcement';
    description.textContent = item.description || structure.description || '';
    description.hidden = !description.textContent;
    slideIndex.textContent = `Item ${index + 1} of ${Math.max(items.length, 1)}`;
    count.textContent = `${index + 1} of ${items.length}`;
    [...dots.children].forEach((dot, dotIndex) => dot.classList.toggle('active', dotIndex === index));
  };
  const goTo = (nextIndex) => {
    index = (nextIndex + items.length) % items.length;
    render();
  };

  if (showIndicators && items.length > 1) {
    for (let i = 0; i < items.length; i += 1) {
      dots.append(button('', 'apprainier-ann-dot', () => goTo(i)));
    }
    carousel.append(dots, count);
  }

  imageFrame.addEventListener('click', () => {
    if (items.length > 1) goTo(index + 1);
  });
  copy.append(title, description, slideIndex);
  carousel.append(imageFrame, copy);

  const actions = el('div', 'apprainier-buttons');
  const secondary = button(buttonText(structure, 'secondary', 'Skip'), 'apprainier-button apprainier-secondary', async () => {
    window.clearInterval(timer);
    await handleAnnouncementAction(announcement, eventName, 'secondary', overlay, items[index]);
  });
  secondary.style.background = secondaryColor;
  secondary.style.color = secondaryTextColor;
  actions.append(secondary);
  const primary = button(buttonText(structure, 'primary', 'Get Started'), 'apprainier-button apprainier-primary', async () => {
    window.clearInterval(timer);
    await handleAnnouncementAction(announcement, eventName, 'primary', overlay, items[index]);
  });
  primary.style.background = primaryColor;
  primary.style.color = buttonTextColor;
  actions.append(primary);

  dialog.append(carousel, actions);
  render();
  if (autoAdvance) timer = window.setInterval(() => goTo(index + 1), intervalMs);
}

async function handleAnnouncementAction(announcement, eventName, role, overlay, activeCarouselItem = null) {
  const structure = parseStructure(announcement);
  const buttonConfig = structure.buttons?.[role] || {};
  const deepLink = activeCarouselItem?.deepLink || buttonConfig.deeplinkUri || buttonConfig.deeplinkURI || buttonConfig.target || buttonConfig.actionTarget;
  const completed = role === 'primary';
  const buttonLabel = buttonText(structure, role, role);
  const responses = {
    action: role,
    button_clicked: metricButtonLabel(buttonLabel, role),
    interaction_outcome: completed ? 'positive' : 'negative',
    ...(deepLink ? { deep_link: deepLink } : {}),
    ...(activeCarouselItem
      ? {
          page_index: activeCarouselItem.index ?? null,
          page_title: activeCarouselItem.title || null,
        }
      : {}),
  };
  const responseId = await submitAnnouncementInteraction(announcement, eventName, responses, 'cta_clicked', {
    completed,
  });
  await trackAnnouncementResponseEvents(announcement, eventName, responses, completed, responseId);
  const payload = announcementPayload(announcement, eventName, role, deepLink);
  emit(completed ? AppRainierEvents.announcementSubmitted : AppRainierEvents.announcementCancelled, payload);
  if (deepLink) emit(AppRainierEvents.deepLink, payload);
  closeOverlay(overlay);
}

function metricButtonLabel(text, fallback) {
  const candidate = valueToString(text || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return candidate || fallback;
}

function announcementPayload(announcement, eventName, action, deepLink = null) {
  return {
    announcementId: announcementIdValue(announcement),
    announcementName: announcementNameValue(announcement),
    eventName,
    action,
    deepLink,
  };
}

async function submitAnnouncementInteraction(announcement, eventName, responses, interactionType, options = {}) {
  const id = announcementIdValue(announcement);
  const name = announcementNameValue(announcement);
  const completed = options.completed ?? (interactionType === 'cta_clicked' && responses?.action === 'primary');
  const completionTime = announcementCompletionTime(announcement);
  const data = await executeGateway('submit_announcement_banner_response', {
    userId: getEffectiveUserId(),
    sessionId: state.sessionId,
    anonymousId: state.anonymousId,
    ownerId: getEffectiveUserId().slice(0, 36),
    bannerId: id,
    bannerName: name || null,
    userName: getUserName(),
    userEmail: getUserEmail(),
    platform: 'web',
    appVersion: valueToString(state.appProperties.app_version || '1'),
    responses: stringifySafe(responses),
    answers: stringifySafe(responses),
    interactionType,
    completed,
    score: null,
    completionTime,
    deviceInfo: valueToString(state.deviceProperties.device_model || 'web'),
    deviceId: state.deviceId,
    bundleOrPackageId: location.hostname || 'web',
    metadata: stringifySafe({
      eventName,
      interactionType,
      runtime: 'web',
      templateId: announcementTemplateId(announcement),
      interactionOutcome: responses?.interaction_outcome || null,
      deepLink: responses?.deep_link || null,
    }),
    submittedAt: nowIso(),
  }).catch((error) => {
    console.warn('[AppRainier] Failed to submit announcement response', error);
    return null;
  });
  return data?.rowId || data?.id || data?.$id || data?.responseId || '';
}

function renderLiveCard(card, triggerId, options) {
  injectStyles();
  const structure = parseStructure(card);
  const config = parseConfig(card);
  const style = config.style || {};
  const type = String(structure.type || card.templateId || 'list_tile').toLowerCase();
  const viewport = Math.min(window.innerWidth - 32, 860);
  const defaultHeight = type.includes('carousel') ? 260 : 108;
  const width = resolveAdminDimension(style, 'cardWidth', viewport, viewport);
  const height = resolveAdminDimension(style, 'cardHeight', defaultHeight, width);
  const radius = resolveCornerRadius(style, width, height, 22);
  const root = el('article', `apprainier-live-card ${type.includes('carousel') ? 'apprainier-live-carousel' : 'apprainier-live-list'}`);
  root.style.width = `${Math.round(width)}px`;
  if (type.includes('carousel')) {
    root.style.height = `${Math.round(Math.max(height, 180))}px`;
  } else if (Number(style.cardHeight) === 0) {
    root.style.minHeight = '80px';
  } else {
    root.style.height = `${Math.round(Math.max(height, 80))}px`;
  }
  root.style.borderRadius = `${radius}px`;
  const background = liveCardBackground(style, card);
  root.style.background = background;
  root.style.setProperty('--ar-live-bg', liveCardSurfaceColor(style, card));
  root.style.color = resolveStyleColor(style.textColor, card.textColor || '#0f172a');
  root.style.setProperty('--ar-live-text', resolveStyleColor(style.textColor, card.textColor || '#0f172a'));
  root.style.setProperty('--ar-live-accent', resolveStyleColor(style.iconColor || style.buttonBackgroundColor, '#0f8f7f'));
  root.style.setProperty('--ar-live-shadow', style.shadow === false ? 'none' : '0 10px 28px rgba(15,23,42,.10)');
  root.style.setProperty('--ar-live-title-size', `${parseLiveCardFontSize(style.titleSize, type.includes('carousel') ? 18 : 16)}px`);
  root.style.setProperty('--ar-live-subtitle-size', `${parseLiveCardFontSize(style.subtitleSize || style.textSize, type.includes('carousel') ? 15 : 14)}px`);
  if (type.includes('carousel') && Array.isArray(structure.carouselItems) && structure.carouselItems.length > 0) {
    renderCarouselLiveCard(root, card, structure, style, Math.max(height, 180), triggerId, options);
  } else {
    renderListLiveCard(root, card, structure, style, triggerId, options);
  }
  return root;
}

function liveCardBackground(style, card) {
  if (style?.isImageBackground === true && style?.backgroundImage) {
    return `linear-gradient(180deg, rgba(0,0,0,.10), rgba(0,0,0,.30)), url("${style.backgroundImage}") center / cover no-repeat`;
  }
  if (Array.isArray(style.gradientColors) && style.gradientColors.length >= 2) {
    const direction = style.gradientDirection === 'horizontal' ? '90deg' : '180deg';
    return `linear-gradient(${direction}, ${style.gradientColors.join(',')})`;
  }
  return resolveStyleColor(style.backgroundColor, card.backgroundColor || '#fff');
}

function liveCardSurfaceColor(style, card) {
  return resolveStyleColor(style?.backgroundColor, card.backgroundColor || '#fff');
}

function renderListLiveCard(root, card, structure, style, triggerId, options) {
  const icon = el('div', 'apprainier-live-icon');
  const iconWidth = parseLiveCardIconDimension(style.iconWidth, style.iconSize, 24);
  const iconHeight = parseLiveCardIconDimension(style.iconHeight, style.iconSize, 24);
  const iconFrameSize = Math.max(iconWidth, iconHeight) + 22;
  icon.style.width = `${iconFrameSize}px`;
  icon.style.height = `${iconFrameSize}px`;
  icon.style.color = resolveStyleColor(style.iconColor, '#0f8f7f');
  const iconToken = structure.iconUrl || structure.iconURL || structure.icon || card.icon;
  if (iconToken && /^https?:|^data:image/.test(iconToken)) {
    const img = el('img');
    img.src = iconToken;
    img.alt = card.title || card.name || 'Live card';
    img.style.width = `${iconWidth}px`;
    img.style.height = `${iconHeight}px`;
    icon.append(img);
  } else {
    icon.innerHTML = materialIconMarkup(iconToken || 'sparkles');
    const svg = icon.querySelector('svg');
    if (svg) {
      svg.style.width = `${Math.max(iconWidth, iconHeight) * 0.88}px`;
      svg.style.height = `${Math.max(iconWidth, iconHeight) * 0.88}px`;
    }
  }
  const copy = el('div', 'apprainier-live-copy');
  const title = el('div', 'apprainier-live-title', card.title || structure.title || card.name || 'Live Card');
  title.style.color = resolveStyleColor(style.titleColor || style.textColor, '#0f172a');
  const subtitle = el('div', 'apprainier-live-subtitle', card.subtitle || structure.subtitle || '');
  subtitle.style.color = resolveStyleColor(style.subtitleColor || style.textColor, '#475569');
  copy.append(title, subtitle);
  const chevron = el('div', 'apprainier-live-chevron', '›');
  if (style.isImageBackground === true || (Array.isArray(style.gradientColors) && style.gradientColors.length >= 2)) {
    chevron.style.color = 'rgba(255,255,255,.92)';
  }
  root.append(icon, copy, chevron);
  root.addEventListener('click', () => {
    const payload = {
      triggerId,
      liveCardId: card.$id,
      liveCardName: card.name,
      actionTarget: structure.deepLink || card.deepLink || null,
      carouselItemIndex: null,
      buttonType: 'primary',
      position: 'list_tile',
    };
    void trackLiveCardClick(card, payload);
    emit(AppRainierEvents.liveCardClicked, payload);
    if (payload.actionTarget) emit(AppRainierEvents.deepLink, payload);
    options.onClick?.(payload);
  });
}

function renderCarouselLiveCard(root, card, structure, style, height, triggerId, options) {
  const items = structure.carouselItems || [];
  let index = 0;
  let suppressNextClick = false;
  const media = el('div', 'apprainier-carousel-media');
  const track = el('div', 'apprainier-carousel-track');
  const dots = el('div', 'apprainier-carousel-dots');
  media.append(track);
  root.append(media);
  media.style.height = '100%';
  track.append(...items.map((item) => {
    const slide = el('div', 'apprainier-carousel-slide');
    const imageUrl = liveCardImageUrl(item);
    slide.style.backgroundImage = imageUrl ? `url("${imageUrl}")` : 'linear-gradient(135deg,#0f8f7f,#38bdf8)';
    slide.style.backgroundColor = item.color || style.backgroundColor || '#0f8f7f';
    const content = el('div', 'apprainier-carousel-slide-content');
    const slideTitle = el('div', 'apprainier-live-title', item.title || card.title || card.name || 'Live Card');
    const slideSubtitle = el('div', 'apprainier-live-subtitle', item.subtitle || card.subtitle || '');
    slideTitle.style.color = resolveStyleColor(item.titleColor || item.textColor || style.titleColor || style.textColor, '#ffffff');
    slideSubtitle.style.color = resolveStyleColor(item.subtitleColor || item.descriptionColor || item.textColor || style.subtitleColor || style.textColor, 'rgba(255,255,255,.9)');
    slideTitle.style.fontSize = `${parseLiveCardFontSize(item.titleSize || item.titleFontSize || style.titleSize, 18)}px`;
    slideSubtitle.style.fontSize = `${parseLiveCardFontSize(item.subtitleSize || item.subtitleFontSize || style.subtitleSize || style.textSize, 15)}px`;
    content.append(slideTitle);
    if (slideSubtitle.textContent) content.append(slideSubtitle);
    slide.append(content);
    return slide;
  }));
  media.append(dots);

  function paint() {
    track.style.transform = `translate3d(${-index * 100}%,0,0)`;
    dots.hidden = structure.showIndicators === false || items.length <= 1;
    if (!dots.hidden) {
      dots.replaceChildren(...items.map((_, dotIndex) => {
        const dot = el('span');
        if (dotIndex === index) dot.classList.add('active');
        dot.addEventListener('click', (event) => {
          event.stopPropagation();
          goTo(dotIndex);
        });
        return dot;
      }));
    } else {
      dots.replaceChildren();
    }
  }
  function goTo(nextIndex) {
    if (items.length === 0) return;
    index = (nextIndex + items.length) % items.length;
    paint();
  }
  function next() {
    goTo(index + 1);
  }
  function previous() {
    goTo(index - 1);
  }
  if (items.length > 1) {
    const previousButton = button('‹', 'apprainier-carousel-arrow prev', (event) => {
      event.preventDefault();
      event.stopPropagation();
      suppressNextClick = true;
      previous();
    });
    const nextButton = button('›', 'apprainier-carousel-arrow next', (event) => {
      event.preventDefault();
      event.stopPropagation();
      suppressNextClick = true;
      next();
    });
    previousButton.setAttribute('aria-label', 'Previous live card image');
    nextButton.setAttribute('aria-label', 'Next live card image');
    for (const control of [previousButton, nextButton]) {
      control.addEventListener('pointerdown', (event) => event.stopPropagation());
      control.addEventListener('pointerup', (event) => event.stopPropagation());
    }
    media.append(previousButton, nextButton);
  }
  paint();
  if (items.length > 1) {
    installSwipeNavigation(root, {
      onNext: () => {
        suppressNextClick = true;
        next();
      },
      onPrevious: () => {
        suppressNextClick = true;
        previous();
      },
    });
  }
  root.addEventListener('click', (event) => {
    if (event.target?.closest?.('.apprainier-carousel-arrow,.apprainier-carousel-dots')) {
      return;
    }
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    const item = items[index] || {};
    const payload = {
      triggerId,
      liveCardId: card.$id,
      liveCardName: card.name,
      actionTarget: item.deepLink || item.action?.target || structure.deepLink || card.deepLink || null,
      carouselItemIndex: index,
      buttonType: 'primary',
      position: 'carousel',
    };
    void trackLiveCardClick(card, payload);
    emit(AppRainierEvents.liveCardClicked, payload);
    if (payload.actionTarget) emit(AppRainierEvents.deepLink, payload);
    options.onClick?.(payload);
  });
  if (items.length > 1 && structure.autoScroll !== false) {
    window.setInterval(() => {
      if (!root.isConnected) return;
      next();
    }, Number(structure.scrollInterval || 4000));
  }
}

function installSwipeNavigation(element, { onNext, onPrevious }) {
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let dragging = false;
  const threshold = 42;

  const reset = () => {
    pointerId = null;
    dragging = false;
    element.classList.remove('dragging');
  };

  element.addEventListener('pointerdown', (event) => {
    if (event.target?.closest?.('.apprainier-carousel-arrow,.apprainier-carousel-dots')) return;
    if (event.button != null && event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    lastX = event.clientX;
    dragging = true;
    element.classList.add('dragging');
    element.setPointerCapture?.(event.pointerId);
  });

  element.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    lastX = event.clientX;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      event.preventDefault();
    }
  });

  element.addEventListener('pointerup', (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX || lastX - startX;
    const dy = event.clientY - startY;
    element.releasePointerCapture?.(event.pointerId);
    reset();
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (dx < 0) onNext();
    else onPrevious();
  });

  element.addEventListener('pointercancel', reset);
  element.addEventListener('lostpointercapture', reset);

  element.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 20) return;
    event.preventDefault();
    if (event.deltaX > 0) onNext();
    else onPrevious();
  }, { passive: false });
}

function messageThreadId(thread) {
  return thread?.conversationId || thread?.threadId || thread?.$id || thread?.id || '';
}

function messageAnnouncementId(announcement) {
  return announcement?.$id || announcement?.id || announcement?.announcementId || '';
}

function messageDateValue(item) {
  return item?.lastMessageAt || item?.sentAt || item?.createdAt || item?.$createdAt || item?.updatedAt || item?.$updatedAt || '';
}

function dateFromValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatMessageTime(value) {
  const date = dateFromValue(value);
  return date ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Now';
}

function formatMessageDay(value) {
  const date = dateFromValue(value);
  if (!date) return 'Today';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const key = (item) => item.toDateString();
  if (key(date) === key(today)) return 'Today';
  if (key(date) === key(yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function formatAnnouncementDate(announcement, full = false) {
  const date = dateFromValue(messageDateValue(announcement));
  if (!date) return 'Update';
  return date.toLocaleDateString([], full ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
}

function messageRelativeTime(value) {
  const date = dateFromValue(value);
  if (!date) return 'No messages yet';
  const diffMs = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diffMs < minute) return 'Just now';
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < day * 7) return `${Math.floor(diffMs / day)}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function messageIsOwn(message) {
  const senderType = String(message?.senderType || '').toLowerCase();
  return senderType === 'user' || message?.senderId === getEffectiveUserId() || message?.senderId === state.anonymousId;
}

function parseMessageMetadata(item) {
  return objectValue(parseJson(item?.metadata ?? item?.metadataJSON, {}));
}

function threadPreview(thread) {
  const metadata = parseMessageMetadata(thread);
  return valueToString(metadata.lastMessagePreview || metadata.preview || metadata.lastMessage || '').trim()
    || (thread?.userName ? `Conversation with ${thread.userName}` : 'Tap to open this support conversation.');
}

function threadInitial(thread) {
  return valueToString(thread?.userName || thread?.title || thread?.subject || 'S').trim().charAt(0).toUpperCase() || 'S';
}

function isClosedThread(thread) {
  return String(thread?.status || '').toLowerCase() === 'closed';
}

function messageCenterSettings() {
  return objectValue(state.messageCenterSettings);
}

function isMessageCenterAvailable() {
  return messageCenterSettings().isEnabled !== false;
}

function isMessageCenterChatEnabled() {
  const settings = messageCenterSettings();
  return settings.isEnabled !== false && settings.chatEnabled !== false;
}

function isMessageCenterAnnouncementsEnabled() {
  const settings = messageCenterSettings();
  return settings.isEnabled !== false && settings.announcementsEnabled !== false;
}

function maxOpenConversations() {
  const value = Number(messageCenterSettings().maxOpenConversationsPerUser);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function openConversationCount() {
  return state.messageThreads.filter((thread) => !isClosedThread(thread)).length;
}

function canStartConversation() {
  return isMessageCenterChatEnabled() && openConversationCount() < maxOpenConversations();
}

function conversationLimitMessage() {
  const max = maxOpenConversations();
  return `You can keep only ${max} open conversation${max === 1 ? '' : 's'} at a time. Please close an existing conversation before starting a new one.`;
}

function canDeleteConversations() {
  return isMessageCenterChatEnabled() && messageCenterSettings().allowUserConversationDelete === true;
}

async function closeThreadForUser(thread) {
  const threadId = messageThreadId(thread);
  const documentId = thread?.$id || thread?.id || threadId;
  const first = await executeGateway('hide_thread_for_user', { threadId }).catch(() => false);
  if (first) return true;
  if (documentId && documentId !== threadId) {
    return executeGateway('hide_thread_for_user', { threadId: documentId }).catch(() => false);
  }
  return false;
}

function parseAttachments(value) {
  if (Array.isArray(value)) return value;
  const parsed = parseJson(value, null);
  if (Array.isArray(parsed)) return parsed;
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function isLikelyImageUrl(value) {
  const text = valueToString(value).toLowerCase();
  return (text.startsWith('http://') || text.startsWith('https://'))
    && (/\.(png|jpe?g|webp|gif|heic|bmp)(\?|#|$)/.test(text) || text.includes('/storage/') || text.includes('/files/'));
}

function announcementImageUrl(announcement) {
  const direct = announcement?.imageUrl || announcement?.imageURL || announcement?.image || announcement?.heroImage || announcement?.thumbnailUrl;
  if (isLikelyImageUrl(direct)) return direct;
  for (const item of parseAttachments(announcement?.attachments ?? announcement?.attachmentsJSON)) {
    if (typeof item === 'string' && isLikelyImageUrl(item)) return item;
    if (item && typeof item === 'object') {
      const value = item.url || item.href || item.imageUrl || item.imageURL || item.fileUrl || item.value || item.thumbnailUrl;
      if (isLikelyImageUrl(value)) return value;
    }
  }
  return '';
}

function announcementSummary(announcement) {
  const metadata = parseMessageMetadata(announcement);
  return valueToString(metadata.subtitle || metadata.summary || announcement?.subtitle || 'A new update is ready for you');
}

function announcementHasUnreadBadge(announcement) {
  return Number(announcement?.openedCount || 0) === 0 || announcement?.isRead === false;
}

function scrollMessageContentToBottom(node) {
  requestAnimationFrame(() => {
    node.scrollTop = node.scrollHeight;
  });
}

function shouldKeepChatPinned(node) {
  return !node || node.scrollHeight - node.scrollTop - node.clientHeight < 96;
}

function messageSignature(messages) {
  return messages.map((message) => `${message.$id || message.id || message.createdAt || message.$createdAt || ''}:${message.isRead ? '1' : '0'}`).join('|');
}

async function fetchThreadMessages(threadId) {
  const messagesData = await executeGateway('get_messages', { threadId, limit: 100 }).catch(() => ({ items: [] }));
  return (messagesData.items || []).map(normalizeRow);
}

async function markThreadMessagesRead(threadId, messages) {
  await Promise.all(messages.filter((message) => !messageIsOwn(message) && !message.isRead && message.$id).map((message) => executeGateway('mark_message_read', { id: message.$id }).catch(() => false)));
  await executeGateway('update_thread_unread_count', { threadId, unreadCount: 0 }).catch(() => false);
}

function renderChatMessages(list, messages) {
  list.replaceChildren();
  let previousDay = '';
  for (const message of messages) {
    const day = formatMessageDay(messageDateValue(message));
    if (day !== previousDay) {
      list.append(el('div', 'apprainier-date-separator', day));
      previousDay = day;
    }
    const mine = messageIsOwn(message);
    const row = el('div', `apprainier-bubble-row ${mine ? 'mine' : 'agent'}`);
    const bubble = el('div', 'apprainier-bubble');
    bubble.append(
      el('span', 'apprainier-bubble-author', mine ? 'You' : (message.senderName || 'Support')),
      el('span', null, message.content || ''),
      el('span', 'apprainier-bubble-time', formatMessageTime(messageDateValue(message))),
    );
    row.append(bubble);
    list.append(row);
  }
  if (messages.length === 0) list.append(renderEmptyMessage('No messages yet', 'Send the first message to begin the conversation.'));
}

function showImageViewer(imageUrl, title = 'Announcement image') {
  let zoom = 1;
  const overlay = el('div', 'apprainier-image-viewer');
  const bar = el('div', 'apprainier-image-viewer-bar');
  const titleNode = el('div', 'apprainier-image-viewer-title', title);
  const actions = el('div', 'apprainier-image-viewer-actions');
  const zoomOut = button('−', null, () => setZoom(zoom - 0.25));
  const zoomLabel = button('100%', null, () => setZoom(1));
  const zoomIn = button('+', null, () => setZoom(zoom + 0.25));
  const close = button('×', null, () => overlay.remove());
  actions.append(zoomOut, zoomLabel, zoomIn, close);
  bar.append(titleNode, actions);

  const stage = el('div', 'apprainier-image-stage');
  const image = el('img');
  image.src = imageUrl;
  image.alt = title;
  stage.append(image);
  overlay.append(bar, stage);

  function setZoom(nextZoom) {
    zoom = Math.max(0.5, Math.min(4, nextZoom));
    image.style.transform = `scale(${zoom})`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  stage.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 0.15 : -0.15));
  }, { passive: false });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target === stage) overlay.remove();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') overlay.remove();
    if (event.key === '+' || event.key === '=') setZoom(zoom + 0.25);
    if (event.key === '-') setZoom(zoom - 0.25);
    if (event.key === '0') setZoom(1);
  });

  document.body.append(overlay);
  overlay.tabIndex = -1;
  overlay.focus();
  setZoom(1);
}

function renderEmptyMessage(title, copy) {
  const card = el('div', 'apprainier-empty-card');
  card.append(el('strong', null, title), el('span', null, copy));
  return card;
}

function renderMessageCenter(options = {}) {
  injectStyles();
  if (!isMessageCenterAvailable()) {
    console.warn('AppRainier Message Center is disabled for this workspace/environment.');
    return;
  }
  const shell = el('section', 'apprainier-message-shell');
  const header = el('header', 'apprainier-message-header');
  const mark = el('div', 'apprainier-message-mark', '✉');
  const heading = el('div');
  heading.append(el('h2', null, 'Message Center'), el('p', null, 'Messages and announcements in one place'));
  const closeButton = button('×', 'apprainier-message-close', () => {});
  header.append(mark, heading, closeButton);
  const tabs = el('div', 'apprainier-tabs');
  const content = el('div', 'apprainier-message-content');
  shell.append(header, tabs, content);

  let activeTab = options.initialTab === 'announcements' || !isMessageCenterChatEnabled()
    ? 'announcements'
    : 'messages';
  let messageCenterRefreshTimer = null;

  const closeMessageCenter = () => {
    clearActiveChatTimer();
    if (messageCenterRefreshTimer) {
      window.clearInterval(messageCenterRefreshTimer);
      state.timers.delete(messageCenterRefreshTimer);
      messageCenterRefreshTimer = null;
    }
    shell.remove();
  };

  closeButton.addEventListener('click', closeMessageCenter, { once: true });

  const paintTabs = () => {
    if (!isMessageCenterChatEnabled() && activeTab === 'messages') activeTab = 'announcements';
    if (!isMessageCenterAnnouncementsEnabled() && activeTab === 'announcements') activeTab = 'messages';
    const unreadMessages = getUnreadMessageCountSync();
    const unreadAnnouncements = getUnreadAnnouncementCountSync();
    const messagesLabel = unreadMessages > 0 ? `✉  Messages (${unreadMessages})` : '✉  Messages';
    const announcementsLabel = unreadAnnouncements > 0 ? `▰  Announcements (${unreadAnnouncements} new)` : '▰  Announcements';
    const tabButtons = [];
    if (isMessageCenterChatEnabled()) {
      tabButtons.push(button(messagesLabel, `apprainier-tab${activeTab === 'messages' ? ' active' : ''}`, () => {
        activeTab = 'messages';
        paintMain();
      }));
    }
    if (isMessageCenterAnnouncementsEnabled()) {
      tabButtons.push(button(announcementsLabel, `apprainier-tab${activeTab === 'announcements' ? ' active' : ''}`, () => {
        activeTab = 'announcements';
        paintMain();
      }));
    }
    tabs.hidden = false;
    tabs.replaceChildren(...tabButtons);
  };

  const paintMain = () => {
    clearActiveChatTimer();
    paintTabs();
    content.replaceChildren();
    if (activeTab === 'messages' && isMessageCenterChatEnabled()) paintThreads(content, { openThread, openNewConversation });
    else paintMessageAnnouncements(content, { openAnnouncementDetail });
    content.scrollTop = 0;
  };

  const openNewConversation = () => {
    tabs.hidden = true;
    renderNewConversation(content, {
      onBack: () => {
        activeTab = 'messages';
        paintMain();
      },
      onThreadCreated: openThread,
    });
  };

  const openThread = (thread) => {
    tabs.hidden = true;
    renderChat(content, thread, async () => {
      await refreshMessageCenter();
      activeTab = 'messages';
      paintMain();
    });
  };

  const openAnnouncementDetail = (announcement) => {
    tabs.hidden = true;
    renderAnnouncementDetail(content, announcement, async () => {
      await refreshMessageCenter();
      activeTab = 'announcements';
      paintMain();
    });
  };

  paintMain();
  document.body.append(shell);
  // Poll only while the Message Center UI is mounted. This avoids idle gateway calls.
  messageCenterRefreshTimer = scheduleTimer(async () => {
    if (!shell.isConnected) {
      if (messageCenterRefreshTimer) {
        window.clearInterval(messageCenterRefreshTimer);
        state.timers.delete(messageCenterRefreshTimer);
        messageCenterRefreshTimer = null;
      }
      return;
    }
    await refreshMessageCenter();
    if (!tabs.hidden) paintTabs();
  }, Number(runtimeConfigValue(['messageCenter', 'listPollingIntervalMs'], 60_000)) || 60_000);
}

function paintThreads(content, handlers = {}) {
  const main = el('div', 'apprainier-message-main');
  const hero = el('section', 'apprainier-message-hero-card');
  hero.append(
    el('div', 'apprainier-message-hero-icon', '💬'),
    el('div', null, ''),
  );
  hero.lastChild.append(
    el('h3', null, 'Support chat'),
    el('p', null, `${state.messageThreads.length} conversation${state.messageThreads.length === 1 ? '' : 's'} · ${getUnreadMessageCountSync()} unread`),
  );

  const actionRow = el('div', 'apprainier-message-action-row');
  const limitText = el('span', 'apprainier-message-pill', `${openConversationCount()} of ${maxOpenConversations()} open conversations`);
  const newButton = button('Start New Conversation', 'apprainier-button apprainier-primary', () => {
    if (messageCenterSettings().chatEnabled === false) {
      window.alert('Support chat is currently unavailable.');
      return;
    }
    if (!canStartConversation()) {
      window.alert(conversationLimitMessage());
      return;
    }
    handlers.openNewConversation?.();
  });
  if (!canStartConversation()) newButton.title = conversationLimitMessage();
  actionRow.append(limitText, newButton);
  main.append(hero, actionRow);

  if (state.messageThreads.length === 0) {
    main.append(renderEmptyMessage('No conversations yet', 'Start a new conversation when you need help from support.'));
  }

  for (const thread of state.messageThreads) {
    const unread = Number(thread.unreadCount || 0);
    const closed = isClosedThread(thread);
    const row = el('article', `apprainier-thread${unread > 0 ? ' unread' : ''}`);
    const inner = el('div', 'apprainier-thread-row');
    const avatar = el('div', 'apprainier-thread-avatar', threadInitial(thread));
    const copy = el('div', 'apprainier-thread-copy');
    const top = el('div', 'apprainier-thread-top');
    top.append(el('h3', null, thread.title || thread.subject || 'Support conversation'));
    if (unread > 0) top.append(el('span', 'apprainier-badge', unread > 99 ? '99+' : String(unread)));
    copy.append(top, el('p', null, threadPreview(thread)));
    const meta = el('div', 'apprainier-message-meta');
    meta.append(
      el('span', 'apprainier-message-pill', messageRelativeTime(thread.lastMessageAt || thread.$updatedAt || thread.$createdAt)),
      el('span', `apprainier-message-pill ${closed ? 'closed' : 'open'}`, closed ? 'Closed' : 'Open'),
    );
    if (unread > 0) meta.append(el('span', 'apprainier-message-pill open', 'Unread'));
    copy.append(meta);
    inner.append(avatar, copy);
    row.append(inner);
    row.addEventListener('click', () => handlers.openThread?.(thread));
    main.append(row);
  }
  content.replaceChildren(main);
}

function getUnreadMessageCountSync() {
  if (!isMessageCenterChatEnabled()) return 0;
  return state.messageThreads.reduce((total, thread) => total + Math.max(0, Number(thread.unreadCount || 0)), 0);
}

function getUnreadAnnouncementCountSync() {
  if (!isMessageCenterAnnouncementsEnabled()) return 0;
  return state.messageAnnouncements.reduce((total, announcement) => total + (announcementHasUnreadBadge(announcement) ? 1 : 0), 0);
}

function paintMessageAnnouncements(content, handlers = {}) {
  const main = el('div', 'apprainier-message-main');
  const hero = el('section', 'apprainier-message-hero-card');
  hero.append(
    el('div', 'apprainier-message-hero-icon', '📣'),
    el('div', null, ''),
  );
  hero.lastChild.append(
    el('h3', null, 'Announcements'),
    el('p', null, `${state.messageAnnouncements.length} update${state.messageAnnouncements.length === 1 ? '' : 's'} to explore`),
  );
  main.append(hero);

  if (state.messageAnnouncements.length === 0) {
    main.append(renderEmptyMessage('No announcements yet', 'Important updates from the team will appear here.'));
  }

  for (const announcement of state.messageAnnouncements) {
    const imageUrl = announcementImageUrl(announcement);
    const row = el('article', 'apprainier-announcement-row');
    const inner = el('div', 'apprainier-announcement-row-inner');
    if (imageUrl) {
      const image = el('img', 'apprainier-announcement-thumb');
      image.src = imageUrl;
      image.alt = announcement.title || 'Announcement image';
      inner.append(image);
    } else {
      inner.append(el('div', 'apprainier-announcement-fallback', '📣'));
    }
    const copy = el('div', 'apprainier-announcement-copy');
    const datePill = el('span', 'apprainier-message-pill', formatAnnouncementDate(announcement));
    copy.append(datePill, el('h3', null, announcement.title || 'Announcement'), el('p', null, announcement.content || announcementSummary(announcement)));
    const meta = el('div', 'apprainier-message-meta');
    if (imageUrl) meta.append(el('span', 'apprainier-announcement-photo', '🔗 Photo'));
    meta.append(el('span', 'apprainier-message-pill', announcement.type || 'Update'));
    copy.append(meta);
    inner.append(copy, el('div', 'apprainier-announcement-arrow', '↗'));
    row.append(inner);
    if (announcementHasUnreadBadge(announcement)) row.append(el('span', 'apprainier-announcement-new', 'New'));
    row.addEventListener('click', () => handlers.openAnnouncementDetail?.(announcement));
    main.append(row);
  }
  content.replaceChildren(main);
}

function renderNewConversation(content, handlers = {}) {
  content.replaceChildren();
  const screen = el('div', 'apprainier-message-detail');
  screen.append(button('← Back to messages', 'apprainier-message-back', handlers.onBack || (() => {})));
  const card = el('section', 'apprainier-message-detail-card');
  const hero = el('div', 'apprainier-new-hero');
  hero.append(
    el('div', 'icon', '✎'),
    el('h3', null, 'Start a new conversation'),
    el('p', null, 'Send a message to our support team'),
    el('div', 'apprainier-new-hint', `You can keep ${maxOpenConversations()} open conversation${maxOpenConversations() === 1 ? '' : 's'} at a time.`),
  );
  const form = el('div', 'apprainier-message-form');
  const subjectWrap = el('label', 'apprainier-message-input-wrap');
  subjectWrap.append(el('span', null, '☰'));
  const subject = el('input');
  subject.placeholder = 'Subject';
  subjectWrap.append(subject);
  const messageWrap = el('label', 'apprainier-message-input-wrap');
  messageWrap.append(el('span', null, '▤'));
  const message = el('textarea');
  message.placeholder = 'Your message';
  messageWrap.append(message);
  const limitNotice = el('div', 'apprainier-new-hint', conversationLimitMessage());
  limitNotice.hidden = canStartConversation();
  const create = button('➤  Send Message', 'apprainier-button apprainier-primary', async () => {
    const subjectValue = subject.value.trim();
    const messageValue = message.value.trim();
    if (!canStartConversation()) {
      limitNotice.hidden = false;
      window.alert(conversationLimitMessage());
      return;
    }
    if (!subjectValue || !messageValue) return;
    create.disabled = true;
    create.textContent = 'Creating...';
    try {
      const data = await executeGateway('create_thread', {
        appId: state.config?.appId,
        environment: state.environment,
        userId: getEffectiveUserId(),
        anonymousId: state.anonymousId,
        sessionId: state.sessionId,
        subject: subjectValue,
        initialMessage: messageValue,
        userName: getUserName(),
        userEmail: getUserEmail(),
        type: 'support',
        metadata: { platform: 'web' },
      });
      await refreshMessageCenter();
      const thread = normalizeRow(data.item || data);
      handlers.onThreadCreated?.(thread);
    } catch (error) {
      create.disabled = false;
      create.textContent = '➤  Send Message';
      console.error('[AppRainier] Failed to create conversation', error);
    }
  });
  form.append(subjectWrap, messageWrap, limitNotice, create);
  const tips = el('aside', 'apprainier-message-tips');
  tips.append(
    el('strong', null, '💡 Tips for better support'),
    el('div', null, '• Be specific about your issue\n• Include any error messages you have seen\n• Mention what you have already tried\n• Add relevant screenshots if needed'),
  );
  card.append(hero, form, tips);
  screen.append(card);
  content.append(screen);
}

async function renderChat(content, thread, onBack) {
  const threadId = messageThreadId(thread);
  clearActiveChatTimer();
  const messages = await fetchThreadMessages(threadId);
  await markThreadMessagesRead(threadId, messages);

  content.replaceChildren();
  const frame = el('div', 'apprainier-chat-frame');
  frame.append(button('← Back to messages', 'apprainier-message-back', () => {
    clearActiveChatTimer();
    onBack?.();
  }));
  const header = el('section', 'apprainier-chat-header');
  header.append(el('div', 'apprainier-thread-avatar', threadInitial(thread)));
  const title = el('div', 'apprainier-chat-title');
  title.append(el('h3', null, thread.title || thread.subject || 'Support conversation'), el('p', null, isClosedThread(thread) ? 'This conversation is closed by support.' : 'Support usually replies here.'));
  header.append(title, el('span', `apprainier-message-pill ${isClosedThread(thread) ? 'closed' : 'open'}`, isClosedThread(thread) ? 'Closed' : 'Open'));
  if (canDeleteConversations() && !isClosedThread(thread)) {
    const deleteButton = button('🗑', 'apprainier-delete-chat', async () => {
      const shouldClose = window.confirm('Remove this conversation?\n\nThis conversation will be removed from your message center and marked closed for support.');
      if (!shouldClose) return;
      deleteButton.disabled = true;
      const didClose = await closeThreadForUser(thread);
      if (didClose) {
        clearActiveChatTimer();
        await refreshMessageCenter();
        onBack?.();
      } else {
        deleteButton.disabled = false;
        window.alert('Unable to remove this conversation. Please try again.');
      }
    });
    deleteButton.setAttribute('aria-label', 'Remove conversation');
    deleteButton.title = 'Remove conversation';
    header.append(deleteButton);
  }
  frame.append(header);

  const list = el('div', 'apprainier-chat-list');
  renderChatMessages(list, messages);
  frame.append(list);

  const composer = el('div', 'apprainier-composer');
  const input = el('textarea');
  input.placeholder = isClosedThread(thread) ? 'This conversation is closed' : 'Message support';
  input.disabled = isClosedThread(thread);
  const send = button('›', 'apprainier-send-button', async () => {
    const value = input.value.trim();
    if (!value || isClosedThread(thread)) return;
    input.value = '';
    send.disabled = true;
    try {
      await executeGateway('send_message', {
        threadId,
        userId: getEffectiveUserId(),
        userName: getUserName(),
        userEmail: getUserEmail(),
        sessionId: state.sessionId,
        environment: state.environment,
        messageType: 'text',
        content: value,
        metadata: { platform: 'web' },
      });
      await refreshMessageCenter();
      const latestMessages = await fetchThreadMessages(threadId);
      await markThreadMessagesRead(threadId, latestMessages);
      state.activeChat.signature = messageSignature(latestMessages);
      renderChatMessages(list, latestMessages);
      scrollMessageContentToBottom(list);
    } catch (error) {
      input.value = value;
      console.error('[AppRainier] Failed to send message', error);
    } finally {
      send.disabled = false;
    }
  });
  send.disabled = isClosedThread(thread);
  composer.append(input, send);
  frame.append(composer);
  content.append(frame);
  scrollMessageContentToBottom(list);
  state.activeChat = {
    threadId,
    input,
    list,
    signature: messageSignature(messages),
  };
  state.activeChatTimer = scheduleTimer(async () => {
    if (!state.activeChat || state.activeChat.threadId !== threadId || !frame.isConnected || document.visibilityState === 'hidden') return;
    const latestMessages = await fetchThreadMessages(threadId);
    const nextSignature = messageSignature(latestMessages);
    if (nextSignature === state.activeChat.signature) return;
    const draft = input.value;
    const stayPinned = shouldKeepChatPinned(list);
    state.activeChat.signature = nextSignature;
    renderChatMessages(list, latestMessages);
    input.value = draft;
    await markThreadMessagesRead(threadId, latestMessages);
    await refreshMessageCenter();
    if (stayPinned) scrollMessageContentToBottom(list);
  }, Number(runtimeConfigValue(['messageCenter', 'chatPollingIntervalMs'], 10_000)) || 10_000);
}

async function renderAnnouncementDetail(content, announcement, onBack) {
  const announcementId = messageAnnouncementId(announcement);
  if (announcementId) {
    await executeGateway('mark_message_announcement_read', {
      announcementId,
      userId: getEffectiveUserId(),
      anonymousId: state.anonymousId,
    }).catch(() => false);
  }
  content.replaceChildren();
  const screen = el('div', 'apprainier-message-detail');
  const head = el('div', 'apprainier-message-detail-head');
  head.append(button('← Back to announcements', 'apprainier-message-back', onBack || (() => {})));
  screen.append(head);
  const imageUrl = announcementImageUrl(announcement);
  if (imageUrl) {
    const hero = el('img', 'apprainier-announcement-hero clickable');
    hero.src = imageUrl;
    hero.alt = announcement.title || 'Announcement image';
    hero.title = 'Click to view full image';
    hero.addEventListener('click', () => showImageViewer(imageUrl, announcement.title || 'Announcement image'));
    screen.append(hero);
  }
  const summary = el('section', 'apprainier-announcement-summary');
  summary.append(el('div', 'apprainier-announcement-fallback', '📣'));
  const copy = el('div');
  copy.append(
    el('h3', null, announcement.title || 'Announcement'),
    el('p', null, announcementSummary(announcement)),
    el('span', 'apprainier-message-pill open', `📅 ${formatAnnouncementDate(announcement, true)}`),
  );
  summary.append(copy);
  const body = el('section', 'apprainier-announcement-detail-body');
  body.append(el('strong', null, 'Details'), el('div', null, announcement.content || announcementSummary(announcement)));
  screen.append(summary, body);
  content.append(screen);
}

async function shutdown() {
  if (state.initialized) {
    await flush({ force: true, silent: true });
    await flushRuntimeTelemetry({ force: true, silent: true });
    await executeGateway('end_session', {
      snapshot: buildSnapshot(),
      sessionData: {
        sessionId: state.sessionId,
        startTime: state.sessionStartedAt,
        endTime: Date.now(),
        duration: Date.now() - state.sessionStartedAt,
        foregroundTime: Date.now() - state.sessionStartedAt,
        backgroundTime: 0,
        deviceInfo: state.deviceProperties,
        appInfo: state.appProperties,
      },
    }).catch(() => false);
  }
  for (const timer of state.timers) clearInterval(timer);
  state.timers.clear();
  state.activeChatTimer = null;
  state.runtimeTelemetryTimer = null;
  state.activeChat = null;
  state.initialized = false;
  return true;
}

export const AppRainier = Object.freeze({
  initialize,
  initializeWithConfig,
  initializeFromConfigUrl,
  identify,
  resetUser,
  setUserProfile,
  setUserProperty: (key, value) => setProperty(state.userProperties, key, value),
  setAppProperty: (key, value) => setProperty(state.appProperties, key, value),
  setDeviceProperty: (key, value) => setProperty(state.deviceProperties, key, value),
  setCustomProperty: (key, value) => setProperty(state.customProperties, key, value),
  setUserType,
  refreshRuntimeBundle,
  refreshFeatureFlags,
  getFeatureFlag,
  getExperimentVariation,
  getExperimentConfig,
  trackExperimentExposure,
  trackExperimentConversion,
  trackEvent,
  flush,
  refreshSurveys,
  canShowSurvey,
  showSurvey,
  refreshAnnouncements,
  canShowAnnouncement,
  showAnnouncement,
  refreshLiveCards,
  hasLiveCard,
  getLiveCard,
  createLiveCard,
  mountLiveCard,
  refreshMessageCenter,
  openMessageCenter,
  getUnreadMessageCount,
  addListener,
  addSurveyCallback(callback = {}) {
    return combineSubscriptions([
      addListener(AppRainierEvents.surveySubmitted, (payload) => callback.onSurveySubmitted?.(payload)),
      addListener(AppRainierEvents.surveyCancelled, (payload) => callback.onSurveyCancelled?.(payload)),
      addListener(AppRainierEvents.surveyDismissed, (payload) => callback.onSurveyDismissed?.(payload)),
    ]);
  },
  addAnnouncementCallback(callback = {}) {
    return combineSubscriptions([
      addListener(AppRainierEvents.announcementSubmitted, (payload) => callback.onAnnouncementSubmitted?.(payload)),
      addListener(AppRainierEvents.announcementCancelled, (payload) => callback.onAnnouncementCancelled?.(payload)),
      addListener(AppRainierEvents.announcementDismissed, (payload) => callback.onAnnouncementDismissed?.(payload)),
    ]);
  },
  async getUserId() {
    return getEffectiveUserId();
  },
  async getUserDebugState() {
    return {
      initialized: state.initialized,
      anonymousId: state.anonymousId,
      identifiedUserId: state.identifiedUserId,
      effectiveUserId: getEffectiveUserId(),
      deviceId: state.deviceId,
      sessionId: state.sessionId,
      environment: state.environment,
      config: state.config,
      queuedEvents: state.eventQueue.length,
    };
  },
  shutdown,
});

export default AppRainier;
