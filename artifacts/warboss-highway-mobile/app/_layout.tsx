import '@/lib/polyfills';
import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorFallback } from '@/components/ErrorFallback';
import { installFatalErrorHandler, subscribeFatalError, toError } from '@/lib/fatal-errors';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { setAudioModeAsync } from 'expo-audio';
import { setBaseUrl } from '@workspace/api-client-react';
import { hydrateSettings } from '@/lib/settings';

// Must run before anything else can throw: see lib/fatal-errors.ts for why a
// fatal JS error otherwise takes the whole process down inside Hermes.
installFatalErrorHandler();

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// The web app calls the same API same-origin (Vercel rewrites /api/* to
// the api-server — see vercel.json at the repo root); the mobile app has
// no "current origin" to piggyback on, so it needs an explicit absolute
// base URL. Points at the stable production alias rather than a
// deployment-specific preview URL.
setBaseUrl('https://nightracer.vercel.app');

// Without this, iOS silences ALL app audio (SFX, music) whenever the
// hardware ring/silent switch is set to silent — expo-audio's iOS default
// respects that switch like a phone call ringer would, which is wrong for
// a game. playsInSilentMode makes gameplay audio behave like every other
// game (plays regardless of the switch, same as the web app's Web Audio
// output, which has no equivalent silent-switch concept at all).
setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});

// Settings (see lib/settings.ts) reads from an in-memory cache that must
// be hydrated from AsyncStorage before any screen calls Settings.getX()
// synchronously — gated here the same way as fonts/Skia-web above.
function useSettingsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    hydrateSettings().then(() => setReady(true));
  }, []);
  return ready;
}

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const settingsReady = useSettingsReady();
  // A fatal JS error thrown outside React's render phase never reaches the
  // <ErrorBoundary> below (boundaries only catch render/lifecycle errors).
  // The global handler forwards it here so it lands on the same screen.
  const [fatalError, setFatalError] = useState<Error | null>(null);
  useEffect(() => subscribeFatalError((info) => setFatalError(toError(info))), []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && settingsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, settingsReady]);

  if (fatalError) {
    // The splash screen may still be up if the error fired during boot.
    SplashScreen.hideAsync().catch(() => {});
    return (
      <SafeAreaProvider>
        <ErrorFallback error={fatalError} resetError={() => setFatalError(null)} />
      </SafeAreaProvider>
    );
  }

  if ((!fontsLoaded && !fontError) || !settingsReady) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <RootLayoutNav />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
