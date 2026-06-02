# AppRainier SDK Release v2.0.0

This folder contains the AppRainier v2.0.0 client SDK release artifacts.

## What's Included

- `android/apprainier-android-sdk-2.0.0.aar`
- `android/apprainier-android-sdk-2.0.0.zip`
- `ios/AppRainierSdk.xcframework`
- `ios/AppRainierSdk-2.0.0.xcframework.zip`
- `flutter/flutter_apprainier_plugin-2.0.0`
- `flutter/flutter_apprainier_plugin-2.0.0.zip`
- `reactnative/react-native-apprainier-plugin-2.0.0`
- `reactnative/react-native-apprainier-plugin-2.0.0.zip`
- `web/apprainier-web-sdk-2.0.0`
- `web/apprainier-web-sdk-2.0.0.zip`

## Which Artifact Should I Use?

- Use the Android AAR when integrating AppRainier directly into a native Android app.
- Use the iOS XCFramework when integrating AppRainier directly into a native iOS app.
- Use the Flutter plugin bundle for Flutter apps. It already contains the Android AAR and iOS XCFramework.
- Use the React Native plugin bundle for React Native apps. It already contains the Android AAR and iOS XCFramework.
- Use the Web SDK bundle for websites and browser-based apps.

## Release Highlights

- Latest Android and iOS SDK binaries are included in native, Flutter, and React Native bundles.
- Live card carousel rendering now aligns across Android, iOS, and Web with title/subtitle overlays on images.
- Announcement built-in icon handling includes local material-style icons such as `rocket_launch`.
- Live card text colors, text sizes, sizing behavior, and web/native parity fixes are included.
- Message Center updates include the latest conversation support available in the SDKs.

## Build Notes

- Android AAR was generated from `ProductionMigration/AndroidWorkspace/apprainier-android-sdk` using `assembleRelease`.
- iOS XCFramework was copied from the latest generated framework in `ProductionMigration/IOSWorkspace/apprainier-ios-testapp/Frameworks`.
- Flutter and React Native release folders include the refreshed Android AAR and iOS XCFramework.
- Web SDK release is packaged from `ProductionMigration/WebWorkspace/apprainier-web-plugin`.

## Integrity Check

Use `CHECKSUMS.txt` to verify zipped release artifacts before uploading or sharing:

```bash
shasum -a 256 android/*.zip ios/*.zip flutter/*.zip reactnative/*.zip web/*.zip
```

## Publishing Checklist

- Confirm the uploaded zip files are from this `v2.0` folder.
- Confirm Flutter and React Native bundles include the same native Android AAR and iOS XCFramework as the native releases.
- Upload the zip files to the chosen public distribution location.
- Update website integration guide links after upload.
- Keep this version folder unchanged after publishing.
