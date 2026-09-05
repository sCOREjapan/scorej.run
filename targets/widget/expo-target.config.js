/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'sCOREWidget',
  displayName: 'sCORE',
  colors: {
    $accent: '#166534',
    $widgetBackground: '#ffffff',
  },
  deploymentTarget: '17.0',
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
})
