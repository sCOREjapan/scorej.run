/**
 * polyfills.js — React Native グローバルポリフィル
 *
 * Metro の getPolyfills() で注入される。全モジュールのロード前に実行される。
 *
 * iOS 26 beta (23E261) の Hermes 0.81.5 には String.fromCodePoint の
 * ネイティブ実装にスタックバッファオーバーフローのバグがある。
 * ここで純粋な JS 実装に差し替えることで、@expo/vector-icons などが
 * Ionicons アイコンをレンダリングする際のクラッシュを防ぐ。
 */

(function () {
  // Hermes の buggy ネイティブ実装を純粋 JS で置き換える
  String.fromCodePoint = function safeFromCodePoint() {
    var result = '';
    for (var i = 0; i < arguments.length; i++) {
      var cp = arguments[i];
      if (typeof cp !== 'number') {
        cp = Number(cp);
      }
      if (isNaN(cp) || cp < 0 || cp > 0x10FFFF || Math.floor(cp) !== cp) {
        // Invalid code point — throw same error as spec, but wrapped so it
        // doesn't propagate as an uncaught exception that could kill the app.
        try { throw new RangeError('Invalid code point: ' + cp); } catch (e) {
          result += '�'; // replacement character
          continue;
        }
      }
      if (cp <= 0xFFFF) {
        result += String.fromCharCode(cp);
      } else {
        var adjusted = cp - 0x10000;
        result += String.fromCharCode(0xD800 + (adjusted >> 10), 0xDC00 + (adjusted & 0x3FF));
      }
    }
    return result;
  };
})();
