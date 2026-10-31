const {
  AndroidConfig, withAndroidManifest, withAppBuildGradle,
  withMainApplication, withDangerousMod,
} = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// Keep the native receiver in one source tree; Expo prebuild recreates its host.
module.exports = function withHomePingTv(config) {
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$['android:allowBackup'] = 'false';
    application.$['android:usesCleartextTraffic'] = 'false';
    application.$['android:banner'] = '@drawable/homeping_tv_banner';
    application.$['android:icon'] = '@drawable/homeping_icon';
    application.$['android:roundIcon'] = '@drawable/homeping_icon';
    application['meta-data'] = (application['meta-data'] ?? [])
      .filter(item => item.$['android:name'] !== 'dev.homeping.BACKEND_URL');
    application['meta-data'].push({ $: {
      'android:name': 'dev.homeping.BACKEND_URL',
      'android:value': config.extra?.homepingBackendUrl ?? '',
    } });
    const permissions = [
      'INTERNET', 'ACCESS_NETWORK_STATE', 'POST_NOTIFICATIONS', 'USE_FULL_SCREEN_INTENT',
      'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_DATA_SYNC', 'SYSTEM_ALERT_WINDOW', 'RECEIVE_BOOT_COMPLETED',
      'CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'WAKE_LOCK',
    ];
    manifest['uses-permission'] ??= [];
    for (const name of permissions) {
      const fullName = 'android.permission.' + name;
      const existing = manifest['uses-permission'].find(item => item.$['android:name'] === fullName);
      if (existing) delete existing.$['tools:node'];
      else
        manifest['uses-permission'].push({ $: { 'android:name': fullName } });
    }
    manifest['uses-feature'] ??= [];
    for (const name of [
      'android.software.leanback', 'android.hardware.touchscreen',
      'android.hardware.camera', 'android.hardware.camera.any', 'android.hardware.camera.autofocus',
      'android.hardware.microphone',
    ]) {
      const existing = manifest['uses-feature'].find(item => item.$['android:name'] === name);
      if (existing) existing.$['android:required'] = 'false';
      else manifest['uses-feature'].push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    const launcherCategories = new Set(['android.intent.category.LAUNCHER', 'android.intent.category.LEANBACK_LAUNCHER']);
    for (const activity of application.activity ?? []) {
      if (activity.$['android:name'] === '.MainActivity')
        activity.$['android:screenOrientation'] = 'portrait';
      activity['intent-filter'] = (activity['intent-filter'] ?? []).filter(filter =>
        !(filter.category ?? []).some(category => launcherCategories.has(category.$['android:name'])));
    }
    const add = (kind, component) => {
      application[kind] ??= [];
      application[kind] = application[kind].filter(item => item.$['android:name'] !== component.$['android:name']);
      application[kind].push(component);
    };
    add('activity', {
      $: { 'android:name': 'dev.tvcall.caller.HomePingLauncherActivity', 'android:exported': 'true',
        'android:theme': '@android:style/Theme.Material.NoActionBar', 'android:excludeFromRecents': 'true',
        'android:icon': '@drawable/homeping_icon', 'android:banner': '@drawable/homeping_tv_banner', 'android:label': 'HomePing' },
      'intent-filter': [{
        action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
        category: [...launcherCategories].map(name => ({ $: { 'android:name': name } })),
      }],
    });
    for (const name of ['SetupActivity', 'IncomingActivity', 'CallActivity', 'ModeActivity'])
      add('activity', { $: { 'android:name': 'dev.tvcall.tv.' + name,
        'android:exported': 'false', 'android:theme': '@android:style/Theme.Material.NoActionBar',
        'android:screenOrientation': 'landscape', 'android:excludeFromRecents': 'true' } });
    add('service', {
      $: { 'android:name': 'dev.tvcall.tv.MessagingService', 'android:exported': 'false' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }] }],
    });
    add('service', { $: { 'android:name': 'dev.tvcall.tv.RingService', 'android:exported': 'false',
      'android:foregroundServiceType': 'dataSync' } });
    add('receiver', { $: { 'android:name': 'dev.tvcall.tv.ActionReceiver', 'android:exported': 'false' } });
    add('receiver', {
      $: { 'android:name': 'dev.tvcall.tv.BootReceiver', 'android:exported': 'false' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } }] }],
    });
    return config;
  });
  config = withAppBuildGradle(config, (config) => {
    const marker = '// HomePing unified TV receiver';
    config.modResults.contents = config.modResults.contents.replace(
      /\n\/\/ HomePing unified TV receiver\nandroid \{[\s\S]*?\n\}\ndependencies \{[\s\S]*?\n\}\n/, '');
    config.modResults.contents += `

${marker}
android {
    defaultConfig { minSdkVersion 26 }
    sourceSets.main.java.srcDir new File(rootDir, "../../tv/app/src/main/java")
    sourceSets.main.java.srcDir new File(rootDir, "../native")
    sourceSets.test.java.srcDir new File(rootDir, "../native-tests")
}
dependencies {
    implementation platform("com.google.firebase:firebase-bom:33.16.0")
    implementation "com.google.firebase:firebase-auth"
    implementation "com.google.firebase:firebase-messaging"
    implementation "androidx.work:work-runtime-ktx:2.10.1"
    implementation "androidx.security:security-crypto:1.1.0-alpha06"
    implementation "com.google.zxing:core:3.5.3"
    implementation "io.livekit:livekit-android:2.29.2"
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0"
    testImplementation "junit:junit:4.13.2"
}
`;
    return config;
  });
  config = withMainApplication(config, (config) => {
    let source = config.modResults.contents;
    if (!source.includes('add(HomePingModePackage())'))
      source = source.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(HomePingModePackage())');
    if (!source.includes('dev.tvcall.tv.TvRuntime.initialize(this)'))
      source = source.replace('super.onCreate()', 'super.onCreate()\n    dev.tvcall.tv.TvRuntime.initialize(this)');
    config.modResults.contents = source;
    return config;
  });
  return withDangerousMod(config, ['android', async (config) => {
    const target = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
    await fs.mkdir(target, { recursive: true });
    await fs.rm(path.join(target, 'homeping_tv_banner.xml'), { force: true });
    for (const [folder, filename] of [['drawable-nodpi', 'homeping_icon.png'], ['drawable-xhdpi', 'homeping_tv_banner.png'], ['drawable-xxxhdpi', 'homeping_tv_banner.png']]) {
      const destination = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res', folder);
      await fs.mkdir(destination, { recursive: true });
      await fs.copyFile(path.join(config.modRequest.projectRoot, '../tv/app/src/main/res', folder, filename), path.join(destination, filename));
    }
    const raw = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/raw');
    await fs.mkdir(raw, { recursive: true });
    await fs.rm(path.join(raw, 'homeping_ring.wav'), { force: true });
    await fs.copyFile(path.join(config.modRequest.projectRoot, '../tv/app/src/main/res/raw/homeping_ring.mp3'),
      path.join(raw, 'homeping_ring.mp3'));
    return config;
  }]);
};
