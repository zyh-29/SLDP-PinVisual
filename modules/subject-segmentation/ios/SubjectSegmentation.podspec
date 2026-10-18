Pod::Spec.new do |s|
  s.name           = 'SubjectSegmentation'
  s.version        = '1.0.0'
  s.summary        = 'On-device subject cut-out'
  s.description    = 'Cuts the main subject out of an image with Apple Vision (iOS 17+).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'CoreVideo', 'UIKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
