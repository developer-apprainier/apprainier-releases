# React Native SDK v1.0.0

## Files

- `react-native-apprainier-plugin-1.0.0/`
- `react-native-apprainier-plugin-1.0.0.zip`

## Usage

Use this artifact for React Native apps.

The React Native plugin bundle includes:

- JavaScript API wrapper.
- TypeScript definitions.
- Android native bridge and Android AAR.
- iOS native bridge and iOS XCFramework.

For local testing, install the extracted plugin from the React Native app:

```bash
npm install ../react-native-apprainier-plugin-1.0.0
```

For iOS apps, run CocoaPods after installing:

```bash
cd ios
pod install
```

The client app should include the AppRainier config JSON generated from the admin portal and pass it during SDK initialization.

## Notes

- Do not remove the plugin `android/repo` folder. It contains the embedded Android SDK AAR used by Gradle.
- Do not remove the plugin `ios/Frameworks` folder. It contains the embedded iOS SDK XCFramework.
