# Flutter SDK v1.0.0

## Files

- `flutter_apprainier_plugin-1.0.0/`
- `flutter_apprainier_plugin-1.0.0.zip`

## Usage

Use this artifact for Flutter apps.

The Flutter plugin bundle includes:

- Flutter Dart API wrapper.
- Android native AAR.
- iOS native XCFramework.

For local testing, reference the extracted plugin from the app `pubspec.yaml`:

```yaml
dependencies:
  flutter_apprainier_plugin:
    path: ../flutter_apprainier_plugin-1.0.0
```

The client app should include the AppRainier config JSON generated from the admin portal and pass it during SDK initialization.

## Notes

- Do not remove the plugin `android/repo` folder. It contains the embedded Android SDK AAR used by Gradle.
- Do not remove the plugin `ios/Frameworks` folder. It contains the embedded iOS SDK XCFramework.
