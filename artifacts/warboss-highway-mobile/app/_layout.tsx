import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// react-native-skia (used by the game's GameCanvas — see components/game/)
// needs its CanvasKit-wasm binary loaded before any Skia component renders,
// but only on web — iOS/Android ship Skia natively and need no bootstrap.
// This is primarily a dev-verification convenience (this game targets iOS;
// the Expo web target lets the render pipeline be checked in a browser on
// machines without an iOS simulator) rather than a supported platform in
// its own right, but costs nothing on native since it's skipped entirely.
function useSkiaWebReady(): boolean {
  const [ready, setReady] = useState(Platform.OS !== 'web');
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    import('@shopify/react-native-skia/lib/module/web').then(({ LoadSkiaWeb }) => LoadSkiaWeb()).then(() => setReady(true));
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

  const skiaReady = useSkiaWebReady();

  useEffect(() => {
    if ((fontsLoaded || fontError) && skiaReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, skiaReady]);

  if ((!fontsLoaded && !fontError) || !skiaReady) return null;

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
