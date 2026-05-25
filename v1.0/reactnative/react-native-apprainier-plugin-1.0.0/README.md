# AppRainier React Native Plugin

Production React Native bridge for the AppRainier Android and iOS SDKs. It exposes one JavaScript API, renders native Live Cards, and delegates surveys, announcements, feature flags, events, push helpers, and Message Center to the native SDKs.

## Package Contents

- `src/` - JavaScript and TypeScript public API.
- `android/` - Android React Native bridge plus bundled AppRainier Android SDK Maven artifact.
- `ios/` - iOS React Native bridge plus bundled `AppRainierSdk.xcframework`.
- `react-native-apprainier-plugin.podspec` - iOS autolinking podspec.

## Install

For local development:

```json
{
  "dependencies": {
    "react-native-apprainier-plugin": "file:../apprainier-react-native-plugin"
  }
}
```

Then run:

```bash
npm install
cd ios && pod install
```

## Initialize

Download the API-key config JSON from the AppRainier admin portal and pass it to `initializeWithConfig`.

```ts
import AppRainier from 'react-native-apprainier-plugin';
import config from './apprainier-config.json';

await AppRainier.initializeWithConfig(config);
await AppRainier.setUserProfile({
  userId: 'user_123',
  userType: 'registered',
  userProperties: { email: 'user@example.com' },
});
```

## Common APIs

```ts
await AppRainier.trackEvent('checkout_started', { cartValue: 42 });
await AppRainier.showSurvey('thumbs_up_down_feedback_survey');
await AppRainier.showAnnouncement('maintenance_alert_announcement');
await AppRainier.refreshFeatureFlags(true);
const enabled = await AppRainier.getFeatureFlag('promo_status', false);
await AppRainier.openMessageCenter({ initialTab: 'messages' });
const unread = await AppRainier.getUnreadMessageCount();
```

## Live Cards

```tsx
import { AppRainierLiveCardView } from 'react-native-apprainier-plugin';

<AppRainierLiveCardView
  triggerId="live_card_discount_product"
  style={{ width: '100%', height: 180 }}
  onCardClick={({ nativeEvent }) => {
    console.log('Live card clicked', nativeEvent);
  }}
/>;
```

## Callbacks

```ts
const subscription = AppRainier.addSurveyCallback({
  onSurveySubmitted: payload => console.log(payload),
  onSurveyDismissed: payload => console.log(payload),
});

subscription.remove();
```

Announcement callbacks are available through `addAnnouncementCallback`.

## Push Helpers

```ts
await AppRainier.onPushTokenRefreshed(token);
const isAppRainier = await AppRainier.isAppRainierPush(remoteMessage.data);
await AppRainier.handlePushMessage(remoteMessage.data, title, body);
```

Android apps can forward FCM payloads to these helpers. iOS apps can forward APNs `userInfo` dictionaries through the same JS API.

## Native Artifact Updates

When the native SDKs change:

1. Build the Android release AAR from `apprainier-android-sdk`.
2. Copy it to `android/repo/com/apprainier/apprainier-android-sdk/1.0.0/apprainier-android-sdk-1.0.0.aar`.
3. Also refresh the reference copy at `android/libs/apprainier-sdk-release.aar`.
4. Build the iOS XCFramework from `apprainier-ios-sdk`.
5. Copy it to `ios/Frameworks/AppRainierSdk.xcframework`.
6. Run Android and iOS test app builds before publishing.

## Verification

```bash
npm pack --dry-run
```

Use the React Native test app in the sibling repository for end-to-end Android and iOS checks.
