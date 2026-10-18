// Config plugin: tells Google Play services to download the ML Kit subject
// segmentation model at install time. Expo's dev launcher already asks for
// `barcode_ui` under the same key, so both are combined in the app manifest
// (which overrides the libraries' entries).
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const KEY = 'com.google.mlkit.vision.DEPENDENCIES';
const MODELS = ['barcode_ui', 'subject_segment'];

module.exports = function withSubjectSegmentation(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    manifest.manifest.$['xmlns:tools'] = manifest.manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    const others = (app['meta-data'] ?? []).filter((m) => m.$['android:name'] !== KEY);
    app['meta-data'] = [...others, { $: { 'android:name': KEY, 'android:value': MODELS.join(','), 'tools:replace': 'android:value' } }];
    return cfg;
  });
};
