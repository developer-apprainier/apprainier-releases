export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AppRainierEnvironment = 'production' | 'stage' | 'development' | string;

export type UserProfile = {
  userId: string;
  userType?: string;
  userProperties?: Record<string, JsonValue>;
  appProperties?: Record<string, JsonValue>;
  deviceProperties?: Record<string, JsonValue>;
  customProperties?: Record<string, JsonValue>;
};

export type CallbackSubscription = {
  remove(): void;
};

export type SurveyCallbackPayload = {
  surveyId?: string | null;
  surveyName?: string | null;
  eventName?: string | null;
  responses?: Record<string, JsonValue>;
};

export type AnnouncementCallbackPayload = {
  announcementId?: string | null;
  announcementName?: string | null;
  eventName?: string | null;
  action?: string | null;
  deepLink?: string | null;
};

export type LiveCardClickPayload = {
  triggerId?: string | null;
  liveCardId?: string | null;
  liveCardName?: string | null;
  actionTarget?: string | null;
  carouselItemIndex?: number | null;
};

export type MessageCenterOptions = {
  initialTab?: 'messages' | 'announcements';
  threadId?: string | null;
  announcementId?: string | null;
};

export type AppRainierSdkConfig = {
  schemaVersion?: number;
  apiKey: string;
  environment?: AppRainierEnvironment;
  runtime?: Record<string, JsonValue>;
  workspace?: Record<string, JsonValue>;
  appwrite?: {
    endpoint?: string;
    projectId?: string;
    databaseId?: string;
    gatewayFunctionId?: string;
    imagesBucketId?: string;
    messageAttachmentsBucketId?: string;
  };
};

export declare const AppRainierEvents: Readonly<{
  surveySubmitted: 'AppRainierSurveySubmitted';
  surveyCancelled: 'AppRainierSurveyCancelled';
  surveyDismissed: 'AppRainierSurveyDismissed';
  announcementSubmitted: 'AppRainierAnnouncementSubmitted';
  announcementCancelled: 'AppRainierAnnouncementCancelled';
  announcementDismissed: 'AppRainierAnnouncementDismissed';
  liveCardClicked: 'AppRainierLiveCardClicked';
  deepLink: 'AppRainierDeepLink';
}>;

export declare const AppRainier: {
  initialize(apiKey: string, environment?: AppRainierEnvironment): Promise<string>;
  initializeWithConfig(config: AppRainierSdkConfig, overrides?: Partial<AppRainierSdkConfig>): Promise<string>;
  initializeFromConfigUrl(url: string, overrides?: Partial<AppRainierSdkConfig>): Promise<string>;
  identify(userId: string, traits?: Record<string, JsonValue>): Promise<boolean>;
  resetUser(reason?: string): Promise<boolean>;
  setUserProfile(profile: UserProfile): Promise<boolean>;
  setUserProperty(key: string, value: JsonValue): Promise<boolean>;
  setAppProperty(key: string, value: JsonValue): Promise<boolean>;
  setDeviceProperty(key: string, value: JsonValue): Promise<boolean>;
  setCustomProperty(key: string, value: JsonValue): Promise<boolean>;
  setUserType(userType: string): Promise<boolean>;
  refreshRuntimeBundle(force?: boolean): Promise<boolean>;
  refreshFeatureFlags(force?: boolean): Promise<boolean>;
  getFeatureFlag<T = JsonValue>(flagKey: string, defaultValue?: T): Promise<T>;
  getExperimentVariation(flagKey: string): Promise<Record<string, JsonValue> | null>;
  getExperimentConfig(flagKey: string): Promise<Record<string, JsonValue> | null>;
  trackExperimentExposure(flagKey: string, context?: Record<string, JsonValue>): Promise<boolean>;
  trackExperimentConversion(flagKey: string, options?: { goalId?: string; value?: number; context?: Record<string, JsonValue> }): Promise<boolean>;
  trackEvent(eventName: string, properties?: Record<string, JsonValue>, eventType?: string): Promise<boolean>;
  flush(): Promise<boolean>;
  refreshSurveys(force?: boolean): Promise<boolean>;
  canShowSurvey(eventName: string): Promise<boolean>;
  showSurvey(eventName: string): Promise<boolean>;
  refreshAnnouncements(force?: boolean): Promise<boolean>;
  canShowAnnouncement(eventName: string): Promise<boolean>;
  showAnnouncement(eventName: string): Promise<boolean>;
  refreshLiveCards(force?: boolean): Promise<boolean>;
  hasLiveCard(triggerId: string): Promise<boolean>;
  getLiveCard(triggerId: string): Promise<Record<string, JsonValue> | null>;
  createLiveCard(triggerId: string, options?: { onClick?: (payload: LiveCardClickPayload) => void }): Promise<HTMLElement>;
  mountLiveCard(target: Element | string, triggerId: string, options?: { onClick?: (payload: LiveCardClickPayload) => void }): Promise<HTMLElement>;
  refreshMessageCenter(): Promise<boolean>;
  openMessageCenter(options?: MessageCenterOptions): Promise<boolean>;
  getUnreadMessageCount(): Promise<number>;
  addListener(eventName: string, listener: (payload: unknown) => void): CallbackSubscription;
  addSurveyCallback(callback: {
    onSurveySubmitted?: (payload: SurveyCallbackPayload) => void;
    onSurveyCancelled?: (payload: SurveyCallbackPayload) => void;
    onSurveyDismissed?: (payload: SurveyCallbackPayload) => void;
  }): CallbackSubscription;
  addAnnouncementCallback(callback: {
    onAnnouncementSubmitted?: (payload: AnnouncementCallbackPayload) => void;
    onAnnouncementCancelled?: (payload: AnnouncementCallbackPayload) => void;
    onAnnouncementDismissed?: (payload: AnnouncementCallbackPayload) => void;
  }): CallbackSubscription;
  getUserId(): Promise<string>;
  getUserDebugState(): Promise<Record<string, JsonValue>>;
  shutdown(): Promise<boolean>;
};

export default AppRainier;
