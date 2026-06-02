#
# To learn more about a Podspec see http://guides.cocoapods.org/syntax/podspec.html.
# Run `pod lib lint flutter_apprainier_plugin.podspec` to validate before publishing.
#
Pod::Spec.new do |s|
  s.name             = 'flutter_apprainier_plugin'
  s.version          = '2.0.0'
  s.summary          = 'Flutter bridge for the AppRainier engagement SDK.'
  s.description      = <<-DESC
Flutter bridge for AppRainier surveys, announcements, live cards, feature flags, experiments, and message center.
                       DESC
  s.homepage         = 'https://apprainier.com'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'AppRainier' => 'support@apprainier.com' }
  s.source           = { :path => '.' }
  s.source_files = 'Classes/**/*'
  s.vendored_frameworks = 'Frameworks/AppRainierSdk.xcframework'
  s.dependency 'Flutter'
  s.platform = :ios, '16.0'

  # Flutter.framework does not contain a i386 slice.
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386' }
  s.swift_version = '5.9'

  # If your plugin requires a privacy manifest, for example if it uses any
  # required reason APIs, update the PrivacyInfo.xcprivacy file to describe your
  # plugin's privacy impact, and then uncomment this line. For more information,
  # see https://developer.apple.com/documentation/bundleresources/privacy_manifest_files
  # s.resource_bundles = {'flutter_apprainier_plugin_privacy' => ['Resources/PrivacyInfo.xcprivacy']}
end
