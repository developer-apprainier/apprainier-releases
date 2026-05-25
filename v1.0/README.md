# AppRainier SDK Release v1.0.0

This folder contains the AppRainier v1.0.0 client SDK release artifacts.

## What's Included

- `android/apprainier-android-sdk-1.0.0.aar`
- `android/apprainier-android-sdk-1.0.0.zip`
- `ios/AppRainierSdk.xcframework`
- `ios/AppRainierSdk-1.0.0.xcframework.zip`
- `flutter/flutter_apprainier_plugin-1.0.0`
- `flutter/flutter_apprainier_plugin-1.0.0.zip`
- `reactnative/react-native-apprainier-plugin-1.0.0`
- `reactnative/react-native-apprainier-plugin-1.0.0.zip`
- `web/apprainier-web-sdk-1.0.0`
- `web/apprainier-web-sdk-1.0.0.zip`

## Which Artifact Should I Use?

- Use the Android AAR when integrating AppRainier directly into a native Android app.
- Use the iOS XCFramework when integrating AppRainier directly into a native iOS app.
- Use the Flutter plugin bundle for Flutter apps. It already contains the Android AAR and iOS XCFramework.
- Use the React Native plugin bundle for React Native apps. It already contains the Android AAR and iOS XCFramework.
- Use the Web SDK bundle for websites and browser-based apps.

## Build Notes

- Android AAR was generated from `ProductionMigration/AndroidWorkspace/apprainier-android-sdk` using `assembleRelease`.
- Android release minification/R8 is enabled in the SDK build.
- iOS XCFramework was generated from `ProductionMigration/IOSWorkspace/apprainier-ios-sdk` using `scripts/build-xcframework.sh`.
- Flutter and React Native release folders include the refreshed Android AAR and iOS XCFramework.
- Web SDK release is packaged from `ProductionMigration/WebWorkspace/apprainier-web-plugin`.

## Integrity Check

Use `CHECKSUMS.txt` to verify zipped release artifacts before uploading or sharing:

```bash
shasum -a 256 android/*.zip ios/*.zip flutter/*.zip reactnative/*.zip web/*.zip
```

## Publishing Checklist

- Confirm all SDK package versions are `1.0.0`.
- Confirm Flutter and React Native bundles include the same native Android AAR and iOS XCFramework as the native releases.
- Upload the zip files to the chosen public distribution location.
- Update website integration guide links after upload.
- Keep this version folder unchanged after publishing.
