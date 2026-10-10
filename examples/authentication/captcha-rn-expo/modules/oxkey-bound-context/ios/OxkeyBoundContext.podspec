Pod::Spec.new do |s|
  s.name           = 'OxkeyBoundContext'
  s.version        = '0.0.0'
  s.summary        = 'Host-granted bound session context candidate'
  s.description    = s.summary
  s.license        = { :type => 'Apache-2.0' }
  s.author         = '0xkey'
  s.homepage       = 'https://github.com/0xkey-io/sdk-js'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.library = 'sqlite3'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
