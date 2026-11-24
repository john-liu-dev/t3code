import { workspaceAreaProps } from "../lib/workspaceFocus";
import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { T, useGT, useMessages, Var } from "gt-react";
import { RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useSettingsRestore } from "../components/settings/SettingsPanels";
import { cn } from "../lib/utils";
import { getAppModalReturnHref } from "../components/sidebar/mainAppLocation";
import {
  canOpenStandaloneSettingsWindow,
  isRouterPreloadLocation,
  isStandaloneSettingsWindow,
  openStandaloneSettingsWindow,
  parseInternalRedirectTarget,
  setLastStandaloneSettingsHref,
} from "../lib/standaloneSettingsWindow";

import { AppRouteModal, AppRouteModalClose } from "../components/AppRouteModal";
import { SettingsBreadcrumb } from "../components/settings/SettingsBreadcrumb";
import { SettingsSidebarNav } from "../components/settings/SettingsSidebarNav";
import {
  SettingsScopeProvider,
  useSettingsScope,
} from "../components/settings/SettingsScopeContext";
import { useEnvironments } from "../state/environments";
import { SettingsScopeNotice } from "../components/settings/SettingsScopeNotice";
import { SETTINGS_DEVICE_ONLY_PATHS } from "../components/settings/SettingsScopeSentence";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import {
  retainSettingsScope,
  validateSettingsRouteSearch,
} from "../components/settings/settingsScopeNavigation";
import {
  getSettingsSearchTargetScope,
  getThreadAutoSettlementSearchAvailability,
  isSettingsSearchScopeAvailable,
  movedSettingsPath,
} from "../components/settings/settingsSearch";

function RestoreDeviceDefaultsButton({ onRestored }: { onRestored: () => void }) {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(onRestored);
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={changedSettingLabels.length === 0}
      onClick={() => void restoreDefaults()}
    >
      <RotateCcwIcon className="size-3.5" />
      <span className="max-sm:sr-only">
        <T>Restore device defaults</T>
      </span>
    </Button>
  );
}

function SettingsScopeBoundary({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { scope, connectedEnvironments } = useSettingsScope();
  const { environments } = useEnvironments();
  const gt = useGT();
  const m = useMessages();
  const hash = useLocation({ select: (location) => location.hash });
  const searchTarget = getSettingsSearchTargetScope(hash);
  const agentFeedbackAvailability = searchTarget?.agentFeedbackOnly
    ? {
        eligibleEnvironmentIds: environments
          .filter(
            (environment) =>
              environment.connection.phase === "connected" &&
              environment.serverConfig?.environment.capabilities.agentFeedback === true,
          )
          .map((environment) => environment.environmentId),
        isTargetAvailable:
          connectedEnvironments.length > 0 &&
          connectedEnvironments.every(
            (environment) =>
              environment.serverConfig?.environment.capabilities.agentFeedback === true,
          ),
      }
    : null;
  const targetAvailability =
    agentFeedbackAvailability ??
    (searchTarget?.requiresThreadAutoSettlement
      ? getThreadAutoSettlementSearchAvailability(environments, scope)
      : null);
  if (
    scope.kind !== "unavailable" &&
    searchTarget &&
    targetAvailability &&
    !targetAvailability.isTargetAvailable
  ) {
    return (
      <SettingsScopeNotice
        target="environment"
        targetId={hash}
        eligibleEnvironmentIds={targetAvailability.eligibleEnvironmentIds}
      >
        {targetAvailability.eligibleEnvironmentIds.length > 0
          ? gt("{title} requires a supporting environment. Choose one to continue.", {
              title: m(searchTarget.title),
            })
          : gt(
              "{title} requires a supporting environment. Connect or update an environment to continue.",
              { title: m(searchTarget.title) },
            )}
      </SettingsScopeNotice>
    );
  }
  if (
    scope.kind !== "unavailable" &&
    searchTarget &&
    !isSettingsSearchScopeAvailable(searchTarget.scope, scope.kind)
  ) {
    const target =
      searchTarget.scope === "environment" ||
      searchTarget.scope === "project" ||
      searchTarget.scope === "checkout"
        ? searchTarget.scope
        : "all";
    return (
      <SettingsScopeNotice target={target} targetId={hash}>
        {gt(
          "{title} is not available for the selected target. Choose its owning scope to continue.",
          { title: m(searchTarget.title) },
        )}
      </SettingsScopeNotice>
    );
  }
  if (SETTINGS_DEVICE_ONLY_PATHS.has(pathname) || pathname === "/settings/projects") {
    return children;
  }
  if (scope.kind === "unavailable")
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">{scope.message}</p>
      </SettingsPageContainer>
    );
  if (scope.kind === "environment" && connectedEnvironments.length === 0) {
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">
          <T>
            Reconnect <Var>{scope.label}</Var> to change its settings.
          </T>
        </p>
      </SettingsPageContainer>
    );
  }
  return children;
}

const STANDALONE_ESCAPE_BLOCKING_OVERLAY_SELECTOR = [
  '[role="dialog"]:not([data-app-modal])',
  '[aria-modal="true"]:not([data-app-modal])',
  '[data-open][data-slot="select-popup"]',
  '[data-open][data-slot="combobox-popup"]',
  '[data-open][data-slot="autocomplete-popup"]',
  '[data-open][data-slot="menu-popup"]',
  '[data-open][data-slot="popover-popup"]',
  '[data-open][data-slot="dialog-popup"]:not([data-app-modal])',
  '[data-open][data-slot="alert-dialog-popup"]',
  '[data-open][data-slot="command-dialog-popup"]',
  '[data-open][data-slot="sheet-popup"]',
].join(", ");

function StandaloneSettingsWindowSurface({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Escape closes the standalone settings window when no inner popup owns focus
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== "Escape") return;
      const target = event.target;
      if (
        (target instanceof HTMLElement &&
          (target.closest('[data-keybinding-capture], [aria-expanded="true"]') !== null ||
            target.closest(STANDALONE_ESCAPE_BLOCKING_OVERLAY_SELECTOR) !== null)) ||
        document.querySelector(STANDALONE_ESCAPE_BLOCKING_OVERLAY_SELECTOR) !== null
      ) {
        return;
      }
      event.preventDefault();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && surfaceRef.current?.contains(focused)) {
        focused.blur();
      }
      window.close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      ref={surfaceRef}
      role="region"
      aria-label={label}
      data-app-modal=""
      className="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground outline-none"
    >
      {children}
    </div>
  );
}

function StandaloneSettingsCloseButton() {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            className="wco:hidden"
            aria-label={gt("Close")}
            onClick={() => {
              const focused = document.activeElement;
              if (focused instanceof HTMLElement) focused.blur();
              window.close();
            }}
          />
        }
      >
        <XIcon />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <T>Close (Esc)</T>
      </TooltipPopup>
    </Tooltip>
  );
}

function SettingsContentLayout() {
  const gt = useGT();
  const contentArea = workspaceAreaProps("settings", 1, gt("Settings content"));
  const location = useLocation();
  const { search, environment } = useSettingsScope();
  const contentScopeKey =
    location.pathname === "/settings/diagnostics" || location.pathname === "/settings/providers"
      ? environment?.environmentId
      : JSON.stringify(search);
  const [restoreSignal, setRestoreSignal] = useState(0);
  const standaloneWindow = isStandaloneSettingsWindow();

  const content = (
    <div className="relative flex min-h-0 flex-1">
      <SettingsSidebarNav pathname={location.pathname} />
      <div {...contentArea} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2",
            standaloneWindow &&
              "select-none [-webkit-app-region:drag] wco:pe-(--workspace-native-controls-inset)",
          )}
        >
          <SettingsBreadcrumb pathname={location.pathname} />
          <div
            className={cn(
              "ms-auto flex shrink-0 items-center gap-1",
              standaloneWindow && "[-webkit-app-region:no-drag]",
            )}
          >
            {location.pathname === "/settings/general" ? (
              <RestoreDeviceDefaultsButton
                onRestored={() => setRestoreSignal((value) => value + 1)}
              />
            ) : null}
            {standaloneWindow ? <StandaloneSettingsCloseButton /> : <AppRouteModalClose />}
          </div>
        </header>
        <div key={`${contentScopeKey}:${restoreSignal}`} className="min-h-0 flex flex-1 flex-col">
          <SettingsScopeBoundary pathname={location.pathname}>
            <Outlet />
          </SettingsScopeBoundary>
        </div>
      </div>
    </div>
  );

  if (standaloneWindow) {
    return (
      <StandaloneSettingsWindowSurface label={gt("Settings")}>
        {content}
      </StandaloneSettingsWindowSurface>
    );
  }

  return <AppRouteModal label={gt("Settings")}>{content}</AppRouteModal>;
}

function SettingsRouteLayout() {
  const rawSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <SettingsScopeProvider
      search={rawSearch}
      singleEnvironment={pathname === "/settings/providers" || pathname === "/settings/secrets"}
      deviceOnly={SETTINGS_DEVICE_ONLY_PATHS.has(pathname)}
      onChange={(next) => {
        // Send every axis so retain middleware recognizes "all" as an explicit target.
        void navigate({
          to: pathname,
          search: () => ({
            project: next.project,
            machine: next.machine,
            checkout: next.checkout,
          }),
          hash: "",
          resetScroll: false,
        });
      }}
    >
      <SettingsContentLayout />
    </SettingsScopeProvider>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  validateSearch: validateSettingsRouteSearch,
  search: { middlewares: [retainSettingsScope] },
  beforeLoad: async ({ location, preload }) => {
    const isPreload = isRouterPreloadLocation(location, preload);
    const moved = movedSettingsPath(location.pathname, location.hash);
    if (canOpenStandaloneSettingsWindow()) {
      // Hover/focus intent preloads must never pop open the standalone settings window.
      if (isPreload) return;
      const resolvedPath =
        moved ?? (location.pathname === "/settings" ? "/settings/general" : location.pathname);
      const searchSuffix = location.searchStr
        ? location.searchStr.startsWith("?")
          ? location.searchStr
          : `?${location.searchStr}`
        : "";
      const hashSuffix = location.hash
        ? location.hash.startsWith("#")
          ? location.hash
          : `#${location.hash}`
        : "";
      openStandaloneSettingsWindow(`${resolvedPath}${searchSuffix}${hashSuffix}`);
      throw redirect({
        ...parseInternalRedirectTarget(getAppModalReturnHref()),
        replace: true,
      });
    }
    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/general", replace: true });
    }
    if (moved) throw redirect({ to: moved, search: true, hash: true, replace: true });
    if (isStandaloneSettingsWindow() && !isPreload && location.pathname.startsWith("/settings/")) {
      setLastStandaloneSettingsHref(location.href);
    }
  },
  component: SettingsRouteLayout,
});
