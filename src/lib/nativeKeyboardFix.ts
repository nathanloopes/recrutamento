// Native keyboard fix — no-op.
//
// Substituído por solução puramente CSS: usar `min-h-dvh` (100dvh) nas telas
// afetadas, que encolhe automaticamente quando `Keyboard.resize: 'native'`
// (adjustResize no Android / WKWebView no iOS) redimensiona a WebView.
// Nenhum scrollIntoView, translate3d ou hack de visualViewport é necessário.
//
// Mantemos a função exportada para preservar imports existentes.
export function initNativeKeyboardFix() {
  /* no-op */
}
