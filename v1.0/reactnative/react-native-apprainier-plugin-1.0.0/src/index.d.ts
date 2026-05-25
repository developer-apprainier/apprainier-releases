import type { ComponentType } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

export type AppRainierEnvironment =
  | "debug"
  | "stage"
  | "production"
  | (string & {});

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = Record<string, JsonValue>;

export type AppRainierUserProfile = {
  userId: string;
  userType: string;
  userProperties?: JsonObject;
  appProperties?: JsonObject;
  deviceProperties?: JsonObject;
  customProperties?: JsonObject;
};

export type AppRainierMessageCenterOptions = {
  initialTab?: "messages" | "announcements" | string | null;
  announcementId?: string | null;
  threadId?: string | null;
};

export type AppRainierSdkConfig = {
  schemaVersion?: number;
  apiKey: string;
  apiKeyId?: string | null;
  apiKeyName?: string | null;
  environment?: AppRainierEnvironment;
  appwrite?: {
    endpoint?: string;
    projectId?: string;
    databaseId?: string;
    gatewayFunctionId?: string;
    imagesBucketId?: string | null;
    messageAttachmentsBucketId?: string | null;
  };
};

export type AppRainierConversionOptions = {
  goalId?: string | null;
  value?: JsonValue;
  context?: JsonObject;
};

export type AppRainierEventName =
  | "AppRainierSurveySubmitted"
  | "AppRainierSurveyCancelled"
  | "AppRainierSurveyDismissed"
  | "AppRainierAnnouncementSubmitted"
  | "AppRainierAnnouncementCancelled"
  | "AppRainierAnnouncementDismissed";

export type AppRainierSubscription = {
  remove(): void;
};

export type SurveyCallbackPayload = {
  surveyId?: string;
  responses?: JsonObject;
  targetScreen?: string | null;
  deepLink?: string | null;
};

export type AnnouncementCallbackPayload = {
  announcementId?: string;
  responses?: JsonObject;
  targetScreen?: string | null;
  deepLink?: string | null;
};

export type ReactNativeSurveyCallback = {
  onSurveySubmitted?: (payload: SurveyCallbackPayload) => void;
  onSurveyCancelled?: (payload: SurveyCallbackPayload) => void;
  onSurveyDismissed?: (payload: SurveyCallbackPayload) => void;
};

export type ReactNativeAnnouncementCallback = {
  onAnnouncementSubmitted?: (payload: AnnouncementCallbackPayload) => void;
  onAnnouncementCancelled?: (payload: AnnouncementCallbackPayload) => void;
  onAnnouncementDismissed?: (payload: AnnouncementCallbackPayload) => void;
};

export type LiveCardClickPayload = {
  triggerId?: string;
  liveCardId?: string | null;
  liveCardName?: string | null;
  buttonType?: string | null;
  actionType?: string | null;
  actionTarget?: string | null;
  carouselItemIndex?: number;
};

export type LiveCardUnavailablePayload = {
  triggerId?: string;
};

export type LiveCardViewProps = ViewProps & {
  triggerId: string;
  refreshKey?: number;
  onCardClick?: (event: NativeSyntheticEvent<LiveCardClickPayload>) => void;
  onCardReady?: (
    event: NativeSyntheticEvent<LiveCardUnavailablePayload>
  ) => void;
  onCardUnavailable?: (
    event: NativeSyntheticEvent<LiveCardUnavailablePayload>
  ) => void;
};

export declare const AppRainier: {
  initialize(
    apiKey: string,
    environment?: AppRainierEnvironment
  ): Promise<string>;
  initializeWithConfig(config: AppRainierSdkConfig): Promise<string>;
  identify(userId: string, traits?: JsonObject): Promise<boolean>;
  resetUser(reason?: string): Promise<boolean>;
  setUserProfile(profile: AppRainierUserProfile): Promise<boolean>;
  setUserProperty(key: string, value: JsonValue): Promise<boolean>;
  setAppProperty(key: string, value: JsonValue): Promise<boolean>;
  setDeviceProperty(key: string, value: JsonValue): Promise<boolean>;
  setCustomProperty(key: string, value: JsonValue): Promise<boolean>;
  setUserType(userType: string): Promise<boolean>;
  refreshFeatureFlags(force?: boolean): Promise<boolean>;
  getFeatureFlag<T extends JsonValue>(
    flagKey: string,
    defaultValue: T
  ): Promise<T>;
  getExperimentVariation(flagKey: string): Promise<JsonObject | null>;
  getExperimentConfig(flagKey: string): Promise<JsonObject | null>;
  trackExperimentExposure(
    flagKey: string,
    context?: JsonObject
  ): Promise<boolean>;
  trackExperimentConversion(
    flagKey: string,
    options?: AppRainierConversionOptions
  ): Promise<boolean>;
  trackEvent(
    eventName: string,
    properties?: JsonObject,
    eventType?: string
  ): Promise<boolean>;
  refreshSurveys(force?: boolean): Promise<boolean>;
  canShowSurvey(eventName: string): Promise<boolean>;
  showSurvey(eventName: string): Promise<boolean>;
  refreshAnnouncements(force?: boolean): Promise<boolean>;
  canShowAnnouncement(eventName: string): Promise<boolean>;
  showAnnouncement(eventName: string): Promise<boolean>;
  refreshLiveCards(force?: boolean): Promise<boolean>;
  hasLiveCard(triggerId: string): Promise<boolean>;
  refreshMessageCenter(): Promise<boolean>;
  openMessageCenter(options?: AppRainierMessageCenterOptions): Promise<boolean>;
  getUnreadMessageCount(): Promise<number>;
  onPushTokenRefreshed(token: string): Promise<boolean>;
  isAppRainierPush(payload: JsonObject): Promise<boolean>;
  handlePushMessage(
    payload: JsonObject,
    notificationTitle?: string | null,
    notificationBody?: string | null
  ): Promise<boolean>;
  getUserId(): Promise<string | null>;
  getUserDebugState(): Promise<JsonObject | null>;
  flush(): Promise<boolean>;
  shutdown(): Promise<boolean>;
  addListener(
    eventName: AppRainierEventName,
    listener: (payload: JsonObject) => void
  ): AppRainierSubscription;
  addSurveyCallback(callback: ReactNativeSurveyCallback): AppRainierSubscription;
  addAnnouncementCallback(
    callback: ReactNativeAnnouncementCallback
  ): AppRainierSubscription;
};

export declare const AppRainierLiveCardView: ComponentType<LiveCardViewProps>;
export declare const LiveCardView: ComponentType<LiveCardViewProps>;

export declare const AppRainierEvents: Readonly<{
  surveySubmitted: "AppRainierSurveySubmitted";
  surveyCancelled: "AppRainierSurveyCancelled";
  surveyDismissed: "AppRainierSurveyDismissed";
  announcementSubmitted: "AppRainierAnnouncementSubmitted";
  announcementCancelled: "AppRainierAnnouncementCancelled";
  announcementDismissed: "AppRainierAnnouncementDismissed";
}>;

export declare const APPRAINIER_EVENTS: typeof AppRainierEvents;

export default AppRainier;
