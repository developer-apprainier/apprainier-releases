const {
  NativeEventEmitter,
  NativeModules,
  Platform,
  requireNativeComponent,
  View,
} = require("react-native");

const MODULE_NAME = "AppRainierReactNativePlugin";
const LIVE_CARD_VIEW_NAME = "AppRainierLiveCardView";

const AppRainierEvents = Object.freeze({
  surveySubmitted: "AppRainierSurveySubmitted",
  surveyCancelled: "AppRainierSurveyCancelled",
  surveyDismissed: "AppRainierSurveyDismissed",
  announcementSubmitted: "AppRainierAnnouncementSubmitted",
  announcementCancelled: "AppRainierAnnouncementCancelled",
  announcementDismissed: "AppRainierAnnouncementDismissed",
});

const nativeModule = NativeModules[MODULE_NAME];
const eventEmitter = nativeModule ? new NativeEventEmitter(nativeModule) : null;

const AppRainierLiveCardView = nativeModule
  ? requireNativeComponent(LIVE_CARD_VIEW_NAME)
  : View;

function getNativeModule() {
  if (!nativeModule) {
    throw new Error(
      "AppRainier native module is not linked. Reinstall pods/rebuild the app after adding react-native-apprainier-plugin."
    );
  }
  return nativeModule;
}

function nullable(value) {
  return value == null ? null : value;
}

function nonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`AppRainier.${name} must be a non-empty string.`);
  }
  return value;
}

function objectValue(value, name) {
  if (value == null) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`AppRainier.${name} must be an object.`);
  }

  return value;
}

function callbackValue(value) {
  return value && typeof value === "object" ? value : {};
}

function sdkConfigValue(value) {
  const config = objectValue(value, "initializeWithConfig(config)");
  nonEmptyString(config.apiKey, "initializeWithConfig(config.apiKey)");
  return config;
}

function addListener(eventName, listener) {
  if (!eventEmitter) {
    throw new Error("AppRainier native event emitter is unavailable.");
  }

  nonEmptyString(eventName, "addListener(eventName)");

  if (typeof listener !== "function") {
    throw new TypeError("AppRainier.addListener(listener) must be a function.");
  }

  return eventEmitter.addListener(eventName, listener);
}

function combineSubscriptions(subscriptions) {
  return {
    remove() {
      subscriptions.forEach((subscription) => subscription.remove());
    },
  };
}

const AppRainier = Object.freeze({
  initialize(apiKey, environment = "production") {
    return getNativeModule().initialize(
      nonEmptyString(apiKey, "initialize(apiKey)"),
      nonEmptyString(environment, "initialize(environment)")
    );
  },

  initializeWithConfig(config) {
    return getNativeModule().initializeWithConfig(sdkConfigValue(config));
  },

  identify(userId, traits = {}) {
    return getNativeModule().identify(
      nonEmptyString(userId, "identify(userId)"),
      objectValue(traits, "identify(traits)")
    );
  },

  resetUser(reason = "manual_reset") {
    return getNativeModule().resetUser(
      nonEmptyString(reason, "resetUser(reason)")
    );
  },

  setUserProfile(profile) {
    const value = objectValue(profile, "setUserProfile(profile)");

    return getNativeModule().setUserProfile(
      nonEmptyString(value.userId, "setUserProfile(userId)"),
      nonEmptyString(value.userType, "setUserProfile(userType)"),
      objectValue(value.userProperties, "setUserProfile(userProperties)"),
      objectValue(value.appProperties, "setUserProfile(appProperties)"),
      objectValue(value.deviceProperties, "setUserProfile(deviceProperties)"),
      objectValue(value.customProperties, "setUserProfile(customProperties)")
    );
  },

  setUserProperty(key, value) {
    return getNativeModule().setUserProperty(
      nonEmptyString(key, "setUserProperty(key)"),
      value
    );
  },

  setAppProperty(key, value) {
    return getNativeModule().setAppProperty(
      nonEmptyString(key, "setAppProperty(key)"),
      value
    );
  },

  setDeviceProperty(key, value) {
    return getNativeModule().setDeviceProperty(
      nonEmptyString(key, "setDeviceProperty(key)"),
      value
    );
  },

  setCustomProperty(key, value) {
    return getNativeModule().setCustomProperty(
      nonEmptyString(key, "setCustomProperty(key)"),
      value
    );
  },

  setUserType(userType) {
    return getNativeModule().setUserType(
      nonEmptyString(userType, "setUserType(userType)")
    );
  },

  refreshFeatureFlags(force = false) {
    return getNativeModule().refreshFeatureFlags(Boolean(force));
  },

  getFeatureFlag(flagKey, defaultValue) {
    return getNativeModule().getFeatureFlag(
      nonEmptyString(flagKey, "getFeatureFlag(flagKey)"),
      defaultValue
    );
  },

  getExperimentVariation(flagKey) {
    return getNativeModule().getExperimentVariation(
      nonEmptyString(flagKey, "getExperimentVariation(flagKey)")
    );
  },

  getExperimentConfig(flagKey) {
    return getNativeModule().getExperimentConfig(
      nonEmptyString(flagKey, "getExperimentConfig(flagKey)")
    );
  },

  trackExperimentExposure(flagKey, context = {}) {
    return getNativeModule().trackExperimentExposure(
      nonEmptyString(flagKey, "trackExperimentExposure(flagKey)"),
      objectValue(context, "trackExperimentExposure(context)")
    );
  },

  trackExperimentConversion(flagKey, options = {}) {
    const value = objectValue(options, "trackExperimentConversion(options)");

    return getNativeModule().trackExperimentConversion(
      nonEmptyString(flagKey, "trackExperimentConversion(flagKey)"),
      nullable(value.goalId),
      nullable(value.value),
      objectValue(value.context, "trackExperimentConversion(context)")
    );
  },

  trackEvent(eventName, properties = {}, eventType = "custom") {
    return getNativeModule().trackEvent(
      nonEmptyString(eventName, "trackEvent(eventName)"),
      objectValue(properties, "trackEvent(properties)"),
      nonEmptyString(eventType, "trackEvent(eventType)")
    );
  },

  refreshSurveys(force = false) {
    return getNativeModule().refreshSurveys(Boolean(force));
  },

  canShowSurvey(eventName) {
    return getNativeModule().canShowSurvey(
      nonEmptyString(eventName, "canShowSurvey(eventName)")
    );
  },

  showSurvey(eventName) {
    return getNativeModule().showSurvey(
      nonEmptyString(eventName, "showSurvey(eventName)")
    );
  },

  refreshAnnouncements(force = false) {
    return getNativeModule().refreshAnnouncements(Boolean(force));
  },

  canShowAnnouncement(eventName) {
    return getNativeModule().canShowAnnouncement(
      nonEmptyString(eventName, "canShowAnnouncement(eventName)")
    );
  },

  showAnnouncement(eventName) {
    return getNativeModule().showAnnouncement(
      nonEmptyString(eventName, "showAnnouncement(eventName)")
    );
  },

  refreshLiveCards(force = true) {
    return getNativeModule().refreshLiveCards(Boolean(force));
  },

  hasLiveCard(triggerId) {
    return getNativeModule().hasLiveCard(
      nonEmptyString(triggerId, "hasLiveCard(triggerId)")
    );
  },

  refreshMessageCenter() {
    return getNativeModule().refreshMessageCenter();
  },

  openMessageCenter(options = {}) {
    const value = objectValue(options, "openMessageCenter(options)");

    return getNativeModule().openMessageCenter(
      nullable(value.initialTab),
      nullable(value.announcementId),
      nullable(value.threadId)
    );
  },

  getUnreadMessageCount() {
    return getNativeModule().getUnreadMessageCount();
  },

  onPushTokenRefreshed(token) {
    return getNativeModule().onPushTokenRefreshed(
      nonEmptyString(token, "onPushTokenRefreshed(token)")
    );
  },

  isAppRainierPush(payload) {
    return getNativeModule().isAppRainierPush(
      objectValue(payload, "isAppRainierPush(payload)")
    );
  },

  handlePushMessage(payload, notificationTitle, notificationBody) {
    const value = objectValue(payload, "handlePushMessage(payload)");

    if (Platform.OS === "android") {
      return getNativeModule().handlePushMessage(
        value,
        nullable(notificationTitle),
        nullable(notificationBody)
      );
    }

    return getNativeModule().handlePushMessage(value);
  },

  getUserId() {
    return getNativeModule().getUserId();
  },

  getUserDebugState() {
    return getNativeModule().getUserDebugState();
  },

  flush() {
    return getNativeModule().flush();
  },

  shutdown() {
    return getNativeModule().shutdown();
  },

  addListener,

  addSurveyCallback(callback) {
    if (!eventEmitter) {
      return { remove() {} };
    }

    const value = callbackValue(callback);

    return combineSubscriptions([
      addListener(AppRainierEvents.surveySubmitted, (payload) => {
        if (typeof value.onSurveySubmitted === "function") {
          value.onSurveySubmitted(payload);
        }
      }),
      addListener(AppRainierEvents.surveyCancelled, (payload) => {
        if (typeof value.onSurveyCancelled === "function") {
          value.onSurveyCancelled(payload);
        }
      }),
      addListener(AppRainierEvents.surveyDismissed, (payload) => {
        if (typeof value.onSurveyDismissed === "function") {
          value.onSurveyDismissed(payload);
        }
      }),
    ]);
  },

  addAnnouncementCallback(callback) {
    if (!eventEmitter) {
      return { remove() {} };
    }

    const value = callbackValue(callback);

    return combineSubscriptions([
      addListener(AppRainierEvents.announcementSubmitted, (payload) => {
        if (typeof value.onAnnouncementSubmitted === "function") {
          value.onAnnouncementSubmitted(payload);
        }
      }),
      addListener(AppRainierEvents.announcementCancelled, (payload) => {
        if (typeof value.onAnnouncementCancelled === "function") {
          value.onAnnouncementCancelled(payload);
        }
      }),
      addListener(AppRainierEvents.announcementDismissed, (payload) => {
        if (typeof value.onAnnouncementDismissed === "function") {
          value.onAnnouncementDismissed(payload);
        }
      }),
    ]);
  },
});

module.exports = {
  __esModule: true,
  AppRainier,
  AppRainierEvents,
  APPRAINIER_EVENTS: AppRainierEvents,
  AppRainierLiveCardView,
  LiveCardView: AppRainierLiveCardView,
  default: AppRainier,
};
