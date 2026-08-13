import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.recruta',
  appName: 'Recruta',
  webDir: 'dist',
  // Marca a WebView nativa para que o frontend consiga desligar fluxos PWA
  // mesmo quando navega para a URL remota (recrutamento.example.com),
  // cenário em que o bridge `window.Capacitor` não fica disponível.
  appendUserAgent: 'CapacitorNativeApp',
  server: {
    androidScheme: 'https',
    // NÃO definir server.url — app roda do bundle local (webDir)
    allowNavigation: [
      'YOUR_PROJECT.supabase.co',
      '*.supabase.co',
      'recrutamento.example.com',
    ],
  },
  ios: {
    contentInset: 'automatic',
    scheme: 'Recruta',
    appendUserAgent: 'CapacitorNativeApp',
  },
  android: {
    backgroundColor: '#ffffff',
    appendUserAgent: 'CapacitorNativeApp',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#1a2332',
      showSpinner: false,
    },
    StatusBar: {
      // Ícones escuros sobre fundo claro do app
      style: 'DARK',
      backgroundColor: '#ffffff',
      // overlaysWebView=false: o Android desenha a status bar branca FORA da
      // WebView. Sem isso, em devices sem notch/Dynamic Island aparece uma
      // faixa preta no topo (área da status bar transparente sobre fundo
      // padrão do sistema). Em iOS, env(safe-area-inset-top) continua
      // respeitando notch/Dynamic Island normalmente.
      overlaysWebView: false,
    },
    Keyboard: {
      // 'native' faz o Android redimensionar a própria WebView (adjustResize),
      // garantindo que o input focado fique acima do teclado sem faixa preta.
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
