# AppRainier Flutter Plugin

Official Flutter bridge for the native AppRainier Android and iOS SDKs.

This package is intended for client Flutter apps. It wraps the native AppRainier SDKs and exposes one Dart API for surveys, announcements and banners, live cards, feature flags, experiments, user identity, event logs, push helpers, and Message Center.

## Repository Contents

- `lib/` contains the public Dart API.
- `android/` contains the Flutter Android plugin bridge and bundled AppRainier Android SDK Maven artifact.
- `ios/` contains the Flutter iOS plugin bridge and bundled AppRainier iOS XCFramework.
- `test/` contains lightweight Dart tests.

## Bundled Native SDKs

The plugin intentionally ships native SDK binaries:

- Android local Maven artifact: `android/repo/com/apprainier/apprainier-android-sdk/1.0.0/`
- Android AAR reference copy: `android/libs/apprainier-sdk-release.aar`
- iOS XCFramework: `ios/Frameworks/AppRainierSdk.xcframework`

The Android Gradle bridge resolves `com.apprainier:apprainier-android-sdk:1.0.0` from the bundled local Maven repo. When updating native SDKs, rebuild the native Android/iOS SDKs, refresh both the local Maven AAR and the reference AAR copy, then run the Flutter test app on Android and iOS.

## Installation

For local development:

```yaml
dependencies:
  flutter_apprainier_plugin:
    path: ../apprainier-flutter-plugin
```

For customer apps, use the Git URL or published package source that you provide.

## Configuration

Download an AppRainier API-key config JSON from the AppRainier admin portal and add it to the client Flutter app, for example:

```text
assets/apprainier-config.json
```

Register it in the client app `pubspec.yaml`:

```yaml
flutter:
  assets:
    - assets/apprainier-config.json
```

Initialize AppRainier:

```dart
import 'package:flutter_apprainier_plugin/flutter_apprainier_plugin.dart';

await AppRainier.initializeFromConfigAsset('assets/apprainier-config.json');
```

## Android Setup

The native Android SDK UI uses Jetpack Compose. The host activity must extend `FlutterFragmentActivity` so Compose has lifecycle, saved-state, and view-model owners:

```kotlin
import io.flutter.embedding.android.FlutterFragmentActivity

class MainActivity : FlutterFragmentActivity()
```

Minimum Android SDK: 24.

## iOS Setup

The plugin bundles `AppRainierSdk.xcframework` through CocoaPods. Use iOS 16.0 or newer.

```sh
flutter pub get
cd ios
pod install
```

## Common APIs

```dart
await AppRainier.setUserProfile(
  const AppRainierUserProfile(
    userId: 'user_123',
    userType: 'registered',
    userProperties: {'email': 'user@example.com'},
  ),
);

await AppRainier.trackEvent(
  'checkout_started',
  properties: {'plan': 'growth'},
);

final shown = await AppRainier.showSurvey('thumbs_up_down_feedback_survey');
final opened = await AppRainier.showAnnouncement('maintenance_alert_announcement');
```

## Callbacks

```dart
final subscription = AppRainier.addSurveyCallback(
  AppRainierSurveyCallback(
    onSurveySubmitted: (payload) {
      debugPrint('Survey submitted: ${payload.surveyId}');
    },
    onSurveyDismissed: (payload) {
      debugPrint('Survey dismissed: ${payload.surveyId}');
    },
  ),
);

await subscription.cancel();
```

## Live Cards

```dart
SizedBox(
  height: 220,
  child: AppRainierLiveCardView(
    triggerId: 'promotions_showcase_carousel',
    onCardClick: (payload) {
      debugPrint('Deep link: ${payload['actionTarget']}');
    },
  ),
);
```

## Message Center

```dart
final unread = await AppRainier.getUnreadMessageCount();
await AppRainier.openMessageCenter();
```

## Push Notifications

Forward push tokens and push payloads from the host app:

```dart
await AppRainier.onPushTokenRefreshed(token);

if (await AppRainier.isAppRainierPush(payload)) {
  await AppRainier.handlePushMessage(payload);
}
```

## Development Checks

```sh
flutter pub get
dart format lib test
flutter analyze
flutter test
```

## Publishing Notes

- Do not commit `.dart_tool`, `.idea`, build folders, Pods, or local config files.
- Keep the bundled AAR/XCFramework artifacts because they are required by the plugin.
- The plugin repo should not commit `pubspec.lock`.
