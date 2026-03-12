import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { FullScreenLoader } from "../Preloader";
import validateSessionTokenForUser from "@/utils/session";
import paths from "@/utils/paths";
import { AUTH_TIMESTAMP, AUTH_TOKEN, AUTH_USER } from "@/utils/constants";
import { userFromStorage } from "@/utils/request";
import System from "@/models/system";
import UserMenu from "../UserMenu";
import { KeyboardShortcutWrapper } from "@/utils/keyboardShortcuts";

const SERVER_CHECK_TIMEOUT_MS = 12000;

function ServerUnreachableScreen({ onRetry }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-theme-bg-primary p-6 text-center">
      <p className="text-lg font-medium text-theme-text-primary">
        Không kết nối được server chatbot
      </p>
      <p className="max-w-md text-sm text-theme-text-secondary">
        Server (port 4101) không phản hồi. Chạy <strong>start-chatbot.bat</strong> hoặc <strong>start-dev.bat</strong> rồi bấm Thử lại.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-theme-button-primary px-4 py-2 text-theme-button-primary-text hover:opacity-90"
      >
        Thử lại
      </button>
    </div>
  );
}

// Used only for Multi-user mode only as we permission specific pages based on auth role.
// When in single user mode we just bypass any authchecks.
function useIsAuthenticated() {
  const [isAuthd, setIsAuthed] = useState(null);
  const [shouldRedirectToOnboarding, setShouldRedirectToOnboarding] =
    useState(false);
  const [multiUserMode, setMultiUserMode] = useState(false);
  const [serverUnreachable, setServerUnreachable] = useState(false);

  const runValidation = React.useCallback(async () => {
    setServerUnreachable(false);
    const timeout = () =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), SERVER_CHECK_TIMEOUT_MS)
      );
    try {
      const onboardingComplete = await Promise.race([
        System.isOnboardingComplete(),
        timeout(),
      ]).catch((e) => {
        if (e?.message === "timeout") throw e;
        return false;
      });
      const keysResult = await Promise.race([
        System.keys(),
        timeout(),
      ]).catch((e) => {
        if (e?.message === "timeout") throw e;
        return null;
      });
      const MultiUserMode = keysResult?.MultiUserMode;
      const RequiresAuth = keysResult?.RequiresAuth;
      setMultiUserMode(MultiUserMode);

      if (onboardingComplete === false) {
        setShouldRedirectToOnboarding(true);
        setIsAuthed(true);
        return;
      }
      if (!MultiUserMode && !RequiresAuth) {
        setIsAuthed(true);
        return;
      }
      if (!MultiUserMode && RequiresAuth) {
        const localAuthToken = localStorage.getItem(AUTH_TOKEN);
        if (!localAuthToken) {
          setIsAuthed(false);
          return;
        }
        const isValid = await validateSessionTokenForUser();
        setIsAuthed(isValid);
        return;
      }
      const localUser = localStorage.getItem(AUTH_USER);
      const localAuthToken = localStorage.getItem(AUTH_TOKEN);
      if (!localUser || !localAuthToken) {
        setIsAuthed(false);
        return;
      }
      const isValid = await validateSessionTokenForUser();
      if (!isValid) {
        localStorage.removeItem(AUTH_USER);
        localStorage.removeItem(AUTH_TOKEN);
        localStorage.removeItem(AUTH_TIMESTAMP);
        setIsAuthed(false);
        return;
      }
      setIsAuthed(true);
    } catch (e) {
      if (e?.message === "timeout") setServerUnreachable(true);
      setIsAuthed(false);
    }
  }, []);

  useEffect(() => {
    runValidation();
  }, [runValidation]);

  return {
    isAuthd,
    shouldRedirectToOnboarding,
    multiUserMode,
    serverUnreachable,
    retry: runValidation,
  };
}

// Allows only admin to access the route and if in single user mode,
// allows all users to access the route
export function AdminRoute({ Component, hideUserMenu = false }) {
  const { isAuthd, shouldRedirectToOnboarding, multiUserMode, serverUnreachable, retry } =
    useIsAuthenticated();
  if (serverUnreachable) return <ServerUnreachableScreen onRetry={retry} />;
  if (isAuthd === null) return <FullScreenLoader />;

  if (shouldRedirectToOnboarding) {
    return <Navigate to={paths.onboarding.home()} />;
  }

  const user = userFromStorage();
  return isAuthd && (user?.role === "admin" || !multiUserMode) ? (
    hideUserMenu ? (
      <KeyboardShortcutWrapper>
        <Component />
      </KeyboardShortcutWrapper>
    ) : (
      <KeyboardShortcutWrapper>
        <UserMenu>
          <Component />
        </UserMenu>
      </KeyboardShortcutWrapper>
    )
  ) : (
    <Navigate to={paths.home()} />
  );
}

// Allows manager and admin to access the route and if in single user mode,
// allows all users to access the route
export function ManagerRoute({ Component }) {
  const { isAuthd, shouldRedirectToOnboarding, multiUserMode, serverUnreachable, retry } =
    useIsAuthenticated();
  if (serverUnreachable) return <ServerUnreachableScreen onRetry={retry} />;
  if (isAuthd === null) return <FullScreenLoader />;

  if (shouldRedirectToOnboarding) {
    return <Navigate to={paths.onboarding.home()} />;
  }

  const user = userFromStorage();
  return isAuthd && (user?.role !== "default" || !multiUserMode) ? (
    <KeyboardShortcutWrapper>
      <UserMenu>
        <Component />
      </UserMenu>
    </KeyboardShortcutWrapper>
  ) : (
    <Navigate to={paths.home()} />
  );
}

export default function PrivateRoute({ Component }) {
  const { isAuthd, shouldRedirectToOnboarding, serverUnreachable, retry } = useIsAuthenticated();
  if (serverUnreachable) return <ServerUnreachableScreen onRetry={retry} />;
  if (isAuthd === null) return <FullScreenLoader />;

  if (shouldRedirectToOnboarding) {
    return <Navigate to="/onboarding" />;
  }

  return isAuthd ? (
    <KeyboardShortcutWrapper>
      <UserMenu>
        <Component />
      </UserMenu>
    </KeyboardShortcutWrapper>
  ) : (
    <Navigate to={paths.login(true)} />
  );
}
