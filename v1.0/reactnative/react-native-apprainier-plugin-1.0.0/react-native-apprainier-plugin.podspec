require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-apprainier-plugin"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://apprainier.com"
  s.license      = { :type => "MIT" }
  s.author       = { "AppRainier" => "support@apprainier.com" }
  s.platforms    = { :ios => "16.0" }
  s.source       = { :path => "." }
  s.source_files = "ios/*.{h,m,mm,swift}"
  s.vendored_frameworks = "ios/Frameworks/AppRainierSdk.xcframework"
  s.swift_version = "5.0"

  s.dependency "React-Core"
end
