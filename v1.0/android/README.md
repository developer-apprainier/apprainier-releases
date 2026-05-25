# Android SDK v1.0.0

## Files

- `apprainier-android-sdk-1.0.0.aar`
- `apprainier-android-sdk-1.0.0.zip`

## Usage

Use this artifact for native Android apps.

Place the AAR in the client app, commonly:

```text
app/libs/apprainier-android-sdk-1.0.0.aar
```

Then add it as a dependency from the app module Gradle file.

The client app should also include the AppRainier config JSON generated from the admin portal and pass it during SDK initialization.

## Notes

- This is a release AAR.
- R8/minification is enabled in the SDK release build.
- Keep the config JSON outside this release artifact because each customer/API key has its own config.
