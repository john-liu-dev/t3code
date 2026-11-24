import { createMemoryHistory } from "@tanstack/react-router";
import type { DesktopBridge } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  ensureClientSettingsHydrated,
  persistClientSettingsUpdate,
} from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { installFakeEnvironment } from "../../test/fakeEnvironment";
import { render } from "../../test/render";

function installMockDesktopBridge(overrides: Partial<DesktopBridge>): Disposable {
  const previous = window.desktopBridge;
  window.desktopBridge = {
    getAppBranding: () => null,
    getRelayTelemetryEnabled: () => false,
    getPathForFile: () => "",
    getClientPlatform: () => "darwin",
    setNotificationBadge: async () => undefined,
    onNotificationBadgeClear: () => () => undefined,
    onTrackpadScrollBegin: () => () => undefined,
    onTrackpadScrollEnd: () => () => undefined,
    revealWindow: async () => undefined,
    getSystemLocale: () => "en-US",
    getPreferredSystemLanguages: () => ["en-US"],
    getLocalEnvironmentBootstraps: () => [],
    getLocalEnvironmentEnabled: () => true,
    setLocalEnvironmentEnabled: async () => undefined,
    getLocalEnvironmentBearerToken: async () => "",
    getClientSettings: async () => DEFAULT_CLIENT_SETTINGS,
    setClientSettings: async () => undefined,
    getConnectionCatalog: async () => null,
    setConnectionCatalog: async () => true,
    discoverSshHosts: async () => [],
    resolveSshHost: async () => {
      throw new Error("unused");
    },
    requestSnapShotPermissions: async () => undefined,
    getSnapShotState: async () => {
      throw new Error("unused");
    },
    setupSnapShot: async () => undefined,
    previewSnapShotConfig: async () => null,
    applySnapShotConfig: async () => {
      throw new Error("unused");
    },
    checkSnapShotShortcut: async () => {
      throw new Error("unused");
    },
    setSnapShotShortcutSuppressed: async () => undefined,
    listPendingSnapShots: async () => [],
    readSnapShot: async () => {
      throw new Error("unused");
    },
    setSnapShotAnimationDestination: async () => undefined,
    dismissSnapShotAnimation: async () => undefined,
    acknowledgeSnapShot: async () => undefined,
    ensureSshEnvironment: async () => {
      throw new Error("unused");
    },
    disconnectSshEnvironment: async () => undefined,
    fetchSshEnvironmentDescriptor: async () => {
      throw new Error("unused");
    },
    bootstrapSshBearerSession: async () => {
      throw new Error("unused");
    },
    fetchSshSessionState: async () => {
      throw new Error("unused");
    },
    onSshPasswordPrompt: () => () => undefined,
    onSshPasswordPromptSettled: () => () => undefined,
    resolveSshPasswordPrompt: async () => undefined,
    getServerExposureState: async () => {
      throw new Error("unused");
    },
    setServerExposureMode: async () => {
      throw new Error("unused");
    },
    setTailscaleServeEnabled: async () => {
      throw new Error("unused");
    },
    getAdvertisedEndpoints: async () => [],
    getWslState: async () => {
      throw new Error("unused");
    },
    setWslBackendEnabled: async () => {
      throw new Error("unused");
    },
    setWslDistro: async () => {
      throw new Error("unused");
    },
    setWslOnly: async () => {
      throw new Error("unused");
    },
    pickFolder: async () => null,
    toLocalBackendPath: async () => null,
    pickProjectFavicon: async () => null,
    pickThemeFiles: async () => null,
    setTheme: async () => undefined,
    showContextMenu: async () => null,
    receiveProviderAuthCallback: async () => "",
    cancelProviderAuthCallback: async () => undefined,
    startFileDrag: async () => false,
    openExternal: async () => true,
    readMedia: async () => null,
    openSystemSettings: async () => true,
    checkSystemPermission: async () => false,
    probeRemoteEditors: async () => [],
    pasteAsText: async () => undefined,
    onMenuAction: () => () => undefined,
    onSnapShotEvent: () => () => undefined,
    onQuitShortcut: () => () => undefined,
    getWindowFullscreenState: () => false,
    onWindowFullscreenStateChange: () => () => undefined,
    getWindowZoomFactor: () => 1,
    getUpdateState: async () => {
      throw new Error("unused");
    },
    setUpdateChannel: async () => {
      throw new Error("unused");
    },
    checkForUpdate: async () => {
      throw new Error("unused");
    },
    downloadUpdate: async () => {
      throw new Error("unused");
    },
    installUpdate: async () => {
      throw new Error("unused");
    },
    onUpdateState: () => () => undefined,
    cliCommand: {
      getState: async () => {
        throw new Error("unused");
      },
      install: async () => {
        throw new Error("unused");
      },
      uninstall: async () => {
        throw new Error("unused");
      },
      addToPath: async () => {
        throw new Error("unused");
      },
    },
    webLinks: {
      setReady: async () => undefined,
      onOpen: () => () => undefined,
    },
    appActivation: {
      setReady: async () => undefined,
      complete: async () => undefined,
      onRequest: () => () => undefined,
    },
    preview: {
      setForwardedShortcuts: async () => undefined,
      onPortForwards: () => () => undefined,
      onTunnelAccessRequest: () => () => undefined,
      onStateChange: () => () => undefined,
      onPointerEvent: () => () => undefined,
      onOpenLink: () => () => undefined,
      onFindResult: () => () => undefined,
    } as unknown as DesktopBridge["preview"],
    ...overrides,
  };
  return {
    [Symbol.dispose]: () => {
      if (previous === undefined) {
        delete window.desktopBridge;
      } else {
        window.desktopBridge = previous;
      }
    },
  };
}

it("renders settings pages inside the standalone desktop settings window and navigates sections", async () => {
  using _environment = installFakeEnvironment([]);
  const openInMainWindow = vi.fn(async () => undefined);
  using _bridge = installMockDesktopBridge({
    getWindowRole: () => "settings",
    openInMainWindow,
  });
  const closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined);
  using _closeSpy = { [Symbol.dispose]: () => closeSpy.mockRestore() };

  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });

  const router = getRouter(createMemoryHistory({ initialEntries: ["/settings/general"] }));
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });

  await expect.element(page.getByRole("region", { name: "Settings" })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  expect(page.getByRole("dialog", { name: "Settings" }).query()).toBeNull();

  await userEvent.click(page.getByRole("button", { name: "Appearance" }));
  await expect.element(page.getByRole("heading", { name: "Interface" })).toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "Chat" }));
  await expect.element(page.getByRole("region", { name: "Settings" })).toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "Keybindings" }));
  await expect.element(page.getByRole("region", { name: "Settings" })).toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "Labs" }));
  await expect.element(page.getByRole("heading", { name: "Beta" })).toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "About" }));
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/settings/about"));

  // Intent preloading a non-settings route must never trigger openInMainWindow.
  await router.preloadRoute({ to: "/" });
  expect(openInMainWindow).not.toHaveBeenCalled();

  // Actual navigation to a non-settings route hands off to the main window and stays on About.
  await router.navigate({ href: "/non-settings-link" });
  expect(openInMainWindow).toHaveBeenCalledWith("/non-settings-link");
  expect(router.state.location.pathname).toBe("/settings/about");

  // Escape while a dropdown popup is open must not close the standalone settings window.
  const openSelectPopup = document.createElement("div");
  openSelectPopup.setAttribute("data-slot", "select-popup");
  openSelectPopup.setAttribute("data-open", "");
  document.body.appendChild(openSelectPopup);
  try {
    await userEvent.keyboard("{Escape}");
    expect(closeSpy).not.toHaveBeenCalled();
  } finally {
    openSelectPopup.remove();
  }

  await userEvent.keyboard("{Escape}");
  expect(closeSpy).toHaveBeenCalledTimes(1);
});

it("redirects settings route navigation in the main window to the standalone settings window", async () => {
  using _environment = installFakeEnvironment([]);
  const openSettingsWindow = vi.fn(async () => undefined);
  using _bridge = installMockDesktopBridge({
    getWindowRole: () => "main",
    openSettingsWindow,
  });

  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });

  const router = getRouter(createMemoryHistory({ initialEntries: ["/"] }));
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });

  // Intent preloading /settings must never open the standalone window without a click.
  await router.preloadRoute({ to: "/settings/appearance", hash: "theme" });
  expect(openSettingsWindow).not.toHaveBeenCalled();

  await router.navigate({
    to: "/settings/appearance",
    search: { machine: "env-1" },
    hash: "theme",
  });
  expect(openSettingsWindow).toHaveBeenCalledWith("/settings/appearance?machine=env-1#theme");
  expect(router.state.location.pathname).toBe("/");
});

it("does not loop persistClientSettingsUpdate when an echoed client settings event arrives", async () => {
  let externalListener: ((settings: typeof DEFAULT_CLIENT_SETTINGS) => void) | null = null;
  const setClientSettings = vi.fn(async (next: typeof DEFAULT_CLIENT_SETTINGS) => {
    // Simulate an echo arriving before the IPC invoke resolves.
    externalListener?.({ ...next });
  });
  using _bridge = installMockDesktopBridge({
    getWindowRole: () => "settings",
    getClientSettings: async () => DEFAULT_CLIENT_SETTINGS,
    setClientSettings,
    onClientSettingsChange: (listener) => {
      externalListener = listener;
      return () => {
        externalListener = null;
      };
    },
  });

  __resetClientSettingsPersistenceForTests();
  try {
    await ensureClientSettingsHydrated();
    const updated = await persistClientSettingsUpdate((current) => ({
      ...current,
      confirmThreadDelete: !current.confirmThreadDelete,
    }));
    expect(updated.confirmThreadDelete).toBe(!DEFAULT_CLIENT_SETTINGS.confirmThreadDelete);
    expect(setClientSettings).toHaveBeenCalledTimes(1);
  } finally {
    __resetClientSettingsPersistenceForTests();
  }
});
