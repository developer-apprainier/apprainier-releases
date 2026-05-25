# AppRainier Releases

This repository stores published AppRainier client SDK release artifacts.

Each version folder is immutable once published. If a fix is needed after a release is shared, create a new patch version folder such as `v1.0.1` instead of replacing files inside an already published version.

## Repository Layout

```text
v1.0/
  android/
  ios/
  flutter/
  reactnative/
  web/
  CHECKSUMS.txt
  README.md
```

## Release Rules

- Keep zipped artifacts and expanded SDK folders together when useful for inspection.
- Do not commit local IDE files, build caches, dependency folders, or machine-specific config.
- Verify package checksums before uploading artifacts to a public download location.
- Keep platform plugin bundles in sync with the native Android AAR and iOS XCFramework used for that release.

## Verification

From a version folder, verify release zip checksums with:

```bash
shasum -a 256 android/*.zip ios/*.zip flutter/*.zip reactnative/*.zip web/*.zip
```

Compare the output with `CHECKSUMS.txt`.
