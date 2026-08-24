// react-native-purchases は iOS では Podfile で直接リンク済みのため、
// iOS の autolinking からのみ除外する（Android は通常どおり自動リンクさせる）
module.exports = {
  dependencies: {
    'react-native-purchases': { platforms: { ios: null } },
  },
}
