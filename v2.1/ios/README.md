# iOS SDK v2.1.0

## Files

- `AppRainierSdk.xcframework`
- `AppRainierSdk-2.1.0.xcframework.zip`

## Usage

Use this artifact for native iOS apps.

Add `AppRainierSdk.xcframework` to the client app target in Xcode. Ensure the framework is available to the app target and embedded according to the integration guide.

The client app should include the AppRainier config JSON generated from the admin portal and pass it during SDK initialization.

## Notes

- The XCFramework contains iOS device and iOS simulator slices.
- The framework was built with `BUILD_LIBRARY_FOR_DISTRIBUTION=YES`.
- Keep the config JSON outside this release artifact because each customer/API key has its own config.
