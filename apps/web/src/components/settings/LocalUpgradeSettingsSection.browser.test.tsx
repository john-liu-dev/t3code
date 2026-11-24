import type { DesktopBridge, DesktopLocalUpgradeStatus } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { ConfirmDialogHost } from "../ConfirmDialogHost";
import { __setClientSettingsForTests } from "../../hooks/useSettings";
import { render } from "../../../test/render";
import { LocalUpgradeSettingsSection } from "./LocalUpgradeSettingsSection";

const baseStatus: DesktopLocalUpgradeStatus = {
  installedKind: "custom",
  installedVersion: "0.1.11",
  hasOfficialBackup: true,
  officialBackupVersion: "0.1.11",
  localBuild: {
    kind: "zip",
    path: "/repo/release/T3-Code-0.1.11-arm64.zip",
    version: "0.1.11",
    modifiedAt: "2026-11-24T07:27:25.000Z",
  },
  officialRelease: null,
  liveDbMigrationId: 111,
  logPath: "/Users/alice/Library/Caches/t3code-local-upgrade/upgrade.log",
  repoDir: "/repo",
  repoBranch: "custom/daily",
  repoBaseTag: "v0.1.11",
  upgradeInProgress: false,
};

function installLocalUpgradeBridge(
  localUpgrade: NonNullable<DesktopBridge["localUpgrade"]>,
): Disposable {
  const previous = window.desktopBridge;
  window.desktopBridge = {
    ...(previous ?? ({} as DesktopBridge)),
    localUpgrade,
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

it("switches to official GitHub release upgrade after confirmation", async () => {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    language: "en",
  });
  const getStatus = vi.fn(async (options?: { readonly checkOfficial?: boolean }) => ({
    ...baseStatus,
    officialRelease: options?.checkOfficial
      ? {
          tag: "v0.1.12",
          version: "0.1.12",
          publishedAt: "2026-11-24T08:00:00Z",
          assetKind: "zip" as const,
          assetName: "T3-Code-0.1.12-arm64.zip",
          assetUrl:
            "https://github.com/pingdotgg/t3code/releases/download/v0.1.12/T3-Code-0.1.12-arm64.zip",
        }
      : null,
  }));
  const run = vi.fn(async () => ({
    started: true,
    logPath: baseStatus.logPath,
    message: null,
  }));
  using _bridge = installLocalUpgradeBridge({ getStatus, run });

  await using _screen = await render(
    <>
      <LocalUpgradeSettingsSection />
      <ConfirmDialogHost />
    </>,
    { router: "/settings/about" },
  );

  await expect.element(page.getByText("Local upgrade manager")).toBeVisible();
  await expect.element(page.getByText("Custom", { exact: true })).toBeVisible();
  await expect.element(page.getByText(/DB migration #111/)).toBeVisible();

  await userEvent.click(page.getByRole("combobox", { name: "Upgrade source" }));
  await userEvent.click(page.getByRole("option", { name: "Official release (GitHub)" }));
  await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
  await expect.element(page.getByText(/v0\.1\.12/)).toBeVisible();
  expect(getStatus).toHaveBeenCalledWith({ checkOfficial: true });

  await userEvent.click(page.getByRole("button", { name: "Upgrade & restart" }));
  await expect.element(page.getByRole("alertdialog")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Confirm", exact: true }));

  await vi.waitFor(() => expect(run).toHaveBeenCalledWith({ target: "official", tag: "v0.1.12" }));
  await expect.element(page.getByRole("button", { name: "Upgrading…" })).toBeDisabled();
});

it("triggers custom rebuild-and-install when Rebuild before installing is enabled", async () => {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    language: "en",
  });
  const getStatus = vi.fn(async () => baseStatus);
  const run = vi.fn(async () => ({
    started: true,
    logPath: baseStatus.logPath,
    message: null,
  }));
  using _bridge = installLocalUpgradeBridge({ getStatus, run });

  await using _screen = await render(
    <>
      <LocalUpgradeSettingsSection />
      <ConfirmDialogHost />
    </>,
    { router: "/settings/about" },
  );

  await expect.element(page.getByText("Local upgrade manager")).toBeVisible();
  await userEvent.click(page.getByRole("switch", { name: "Rebuild before installing" }));
  await userEvent.click(page.getByRole("button", { name: "Upgrade & restart" }));
  await expect.element(page.getByRole("alertdialog")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Confirm", exact: true }));

  await vi.waitFor(() => expect(run).toHaveBeenCalledWith({ target: "custom", buildFirst: true }));
});

it("auto-enables rebuild and passes syncUpstream when syncing the latest official stable tag", async () => {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    language: "en",
  });
  const getStatus = vi.fn(async () => baseStatus);
  const run = vi.fn(async () => ({
    started: true,
    logPath: baseStatus.logPath,
    message: null,
  }));
  using _bridge = installLocalUpgradeBridge({ getStatus, run });

  await using _screen = await render(
    <>
      <LocalUpgradeSettingsSection />
      <ConfirmDialogHost />
    </>,
    { router: "/settings/about" },
  );

  await expect.element(page.getByText(/Branch: custom\/daily/)).toBeVisible();
  await userEvent.click(
    page.getByRole("switch", { name: "Sync latest official stable tag before build" }),
  );
  await expect
    .element(page.getByRole("switch", { name: "Rebuild before installing" }))
    .toBeChecked();

  // Turning off Rebuild also clears Sync, then re-enabling Sync turns both back on.
  await userEvent.click(page.getByRole("switch", { name: "Rebuild before installing" }));
  await expect
    .element(page.getByRole("switch", { name: "Sync latest official stable tag before build" }))
    .not.toBeChecked();

  await userEvent.click(
    page.getByRole("switch", { name: "Sync latest official stable tag before build" }),
  );
  await expect
    .element(page.getByRole("switch", { name: "Rebuild before installing" }))
    .toBeChecked();

  await userEvent.click(page.getByRole("button", { name: "Upgrade & restart" }));
  await expect.element(page.getByRole("alertdialog")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Confirm", exact: true }));

  await vi.waitFor(() =>
    expect(run).toHaveBeenCalledWith({
      target: "custom",
      buildFirst: true,
      syncUpstream: true,
    }),
  );
});

it("disables upstream stable-tag sync when repoBranch is main", async () => {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    language: "en",
  });
  const getStatus = vi.fn(async () => ({ ...baseStatus, repoBranch: "main" }));
  const run = vi.fn(async () => ({
    started: true,
    logPath: baseStatus.logPath,
    message: null,
  }));
  using _bridge = installLocalUpgradeBridge({ getStatus, run });

  await using _screen = await render(<LocalUpgradeSettingsSection />, {
    router: "/settings/about",
  });

  await expect
    .element(page.getByRole("switch", { name: "Sync latest official stable tag before build" }))
    .toBeDisabled();
});

it("keeps the section visible on refresh failure and recovers when upgrade start fails", async () => {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    language: "en",
  });
  let calls = 0;
  const getStatus = vi.fn(async () => {
    calls += 1;
    return calls === 1 ? baseStatus : null;
  });
  const run = vi.fn(async () => ({
    started: false,
    logPath: baseStatus.logPath,
    message: "Another T3 Code upgrade is already running.",
  }));
  using _bridge = installLocalUpgradeBridge({ getStatus, run });

  await using _screen = await render(
    <>
      <LocalUpgradeSettingsSection />
      <ConfirmDialogHost />
    </>,
    { router: "/settings/about" },
  );

  await expect.element(page.getByText("Local upgrade manager")).toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "Check releases" }));
  await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(2));
  await expect.element(page.getByText("Local upgrade manager")).toBeVisible();

  await userEvent.click(page.getByRole("combobox", { name: "Upgrade source" }));
  await userEvent.click(page.getByRole("option", { name: "Saved official backup" }));
  await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();

  await userEvent.click(page.getByRole("button", { name: "Upgrade & restart" }));
  await expect.element(page.getByRole("alertdialog")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Confirm", exact: true }));

  await vi.waitFor(() => expect(run).toHaveBeenCalledWith({ target: "rollback" }));
  await expect.element(page.getByRole("button", { name: "Upgrade & restart" })).toBeEnabled();
});

it("stays hidden when the desktop bridge reports no local upgrade script", async () => {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    language: "en",
  });
  const getStatus = vi.fn(async () => null);
  const run = vi.fn(async () => ({
    started: false,
    logPath: baseStatus.logPath,
    message: "missing",
  }));
  using _bridge = installLocalUpgradeBridge({ getStatus, run });

  await using _screen = await render(<LocalUpgradeSettingsSection />, {
    router: "/settings/about",
  });
  await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));
  expect(page.getByText("Local upgrade manager").query()).toBeNull();
});
