import AsyncStorage from '@react-native-async-storage/async-storage';

// Why this exists:
//
// In a release build, React Native's default global error handler reports a
// fatal JS error (anything thrown outside React's render phase: a timer, a
// requestAnimationFrame / R3F useFrame callback, an event handler) to the
// native ExceptionsManager, whose reportFatal deliberately raises an
// NSException to terminate the app. On the New Architecture that call is an
// async "void" TurboModule method, so the NSException is caught inside
// ObjCTurboModule::performVoidMethodInvocation on a background queue, which
// then builds a JS error object against the Hermes runtime from the wrong
// thread. The result is not a clean abort but memory corruption: the
// TestFlight crash of 2026-11-15 (build 32, iOS 27.0.1) is exactly this —
// EXC_BAD_ACCESS inside HadesGC under
// convertNSExceptionToJSError <- performVoidMethodInvocation — and its report
// carries no JS message at all, so the original error is unrecoverable from
// the crash log (facebook/react-native#54859).
//
// Handling fatal errors in JS avoids that native path entirely: the app shows
// its own error screen (with the message and stack) instead of dying, and the
// error is persisted so it can still be read after a relaunch.

export interface FatalErrorInfo {
  message: string;
  stack: string;
  /** ISO timestamp of when the error was caught. */
  at: string;
}

const STORAGE_KEY = 'warboss_last_fatal';

type Listener = (info: FatalErrorInfo) => void;
type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsShape {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(handler: GlobalHandler): void;
}

let listener: Listener | null = null;
let pending: FatalErrorInfo | null = null;
let installed = false;

function toInfo(error: unknown): FatalErrorInfo {
  const e = error as { message?: unknown; stack?: unknown } | null | undefined;
  return {
    message: typeof e?.message === 'string' ? e.message : String(error),
    stack: typeof e?.stack === 'string' ? e.stack : '',
    at: new Date().toISOString(),
  };
}

/** Call once, as early as possible (before any screen mounts). */
export function installFatalErrorHandler(): void {
  if (installed) return;
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (!errorUtils) return;
  installed = true;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    // Development keeps the stock behaviour (redbox). Non-fatal reports don't
    // take the crashing native path, so they pass through untouched too.
    if (__DEV__ || !isFatal) {
      previous(error, isFatal);
      return;
    }
    const info = toInfo(error);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(info)).catch(() => {
      // best-effort: the on-screen report below is the primary signal
    });
    if (listener) listener(info);
    else pending = info;
  });
}

/** Receives fatal errors as they happen (and one that fired before subscribing). */
export function subscribeFatalError(next: Listener): () => void {
  listener = next;
  if (pending) {
    const info = pending;
    pending = null;
    next(info);
  }
  return () => {
    if (listener === next) listener = null;
  };
}

export function toError(info: FatalErrorInfo): Error {
  const error = new Error(info.message);
  if (info.stack) error.stack = info.stack;
  return error;
}
