/* oxlint-disable t3code/no-untranslated-copy -- personal fork-only local upgrade UI; kept out of upstream i18n catalogs to avoid merge conflicts */
import type { DesktopLocalUpgradeStatus, DesktopLocalUpgradeTarget } from "@t3tools/contracts";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const UPGRADE_POLL_INTERVAL_MS = 6_000;

function isChineseUi(language: string): boolean {
  if (language.toLowerCase().startsWith("zh")) return true;
  if (language !== "auto") return false;
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh");
}

function formatShortTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getLocalUpgradeBridge() {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.localUpgrade ?? null;
}

export function LocalUpgradeSettingsSection() {
  const language = useClientSettings((settings) => settings.language);
  const zh = isChineseUi(language);
  const [status, setStatus] = useState<DesktopLocalUpgradeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<DesktopLocalUpgradeTarget>("custom");
  const [buildFirst, setBuildFirst] = useState(false);
  const [syncUpstream, setSyncUpstream] = useState(false);
  const [launching, setLaunching] = useState(false);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const loadStatus = (checkOfficial: boolean, silentOnFailure = false) => {
    const bridge = getLocalUpgradeBridge();
    if (!bridge) return;
    const requestId = ++requestIdRef.current;
    if (!silentOnFailure) setLoading(true);
    void bridge
      .getStatus({ checkOfficial })
      .then((next) => {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        if (!next) {
          // Keep an already-loaded section visible when a refresh times out or fails transiently.
          if (!silentOnFailure) {
            toastManager.add({
              type: "warning",
              title: zh ? "未能刷新版本信息" : "Could not refresh release info",
              description: zh ? "请检查网络连接后重试。" : "Check your connection and try again.",
            });
          }
          return;
        }
        setStatus((previous) => ({
          ...next,
          officialRelease:
            next.officialRelease ?? (checkOfficial ? null : (previous?.officialRelease ?? null)),
        }));
        if (next.localBuild === null) {
          setBuildFirst(true);
        }
      })
      .catch(() => {
        if (!mountedRef.current || requestId !== requestIdRef.current || silentOnFailure) return;
        toastManager.add({
          type: "warning",
          title: zh ? "未能刷新版本信息" : "Could not refresh release info",
          description: zh ? "请检查网络连接后重试。" : "Check your connection and try again.",
        });
      })
      .finally(() => {
        if (mountedRef.current && requestId === requestIdRef.current && !silentOnFailure) {
          setLoading(false);
        }
      });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks unmount and loads initial macOS local upgrade status once when About settings mounts
  useEffect(() => {
    mountedRef.current = true;
    const bridge = getLocalUpgradeBridge();
    if (!bridge) {
      return () => {
        mountedRef.current = false;
      };
    }
    const requestId = ++requestIdRef.current;
    void bridge
      .getStatus({ checkOfficial: false })
      .then((next) => {
        if (!mountedRef.current || requestId !== requestIdRef.current || !next) return;
        setStatus(next);
        if (next.localBuild === null) {
          setBuildFirst(true);
        }
      })
      .catch(() => undefined);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const upgradeInProgress = status?.upgradeInProgress === true;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls lock state while a background upgrade worker runs so failures recover cleanly in UI
  useEffect(() => {
    if (!upgradeInProgress) return;
    const bridge = getLocalUpgradeBridge();
    if (!bridge) return;
    const timer = window.setInterval(() => {
      const requestId = ++requestIdRef.current;
      void bridge
        .getStatus({ checkOfficial: false })
        .then((next) => {
          if (!mountedRef.current || requestId !== requestIdRef.current || !next) return;
          setStatus((previous) => ({
            ...next,
            officialRelease: next.officialRelease ?? previous?.officialRelease ?? null,
          }));
        })
        .catch(() => undefined);
    }, UPGRADE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [upgradeInProgress]);

  if (status === null) {
    return null;
  }

  const effectiveTarget: DesktopLocalUpgradeTarget =
    target === "rollback" && !status.hasOfficialBackup ? "custom" : target;

  const installedBadgeLabel =
    status.installedKind === "custom"
      ? zh
        ? "定制版"
        : "Custom"
      : status.installedKind === "official"
        ? zh
          ? "官方签名版"
          : "Official"
        : zh
          ? "未安装"
          : "Missing";

  const targetLabel = (value: DesktopLocalUpgradeTarget) => {
    if (value === "custom") {
      return zh ? "本地定制版" : "Custom local build";
    }
    if (value === "official") {
      return zh ? "官方正式版 (GitHub)" : "Official release (GitHub)";
    }
    return zh ? "回退官方备份版" : "Saved official backup";
  };

  const localBuildSummary = status.localBuild
    ? zh
      ? `最新本地包：v${status.localBuild.version ?? "unknown"} (${formatShortTimestamp(status.localBuild.modifiedAt) ?? status.localBuild.kind})`
      : `Latest local build: v${status.localBuild.version ?? "unknown"} (${formatShortTimestamp(status.localBuild.modifiedAt) ?? status.localBuild.kind})`
    : zh
      ? "release/ 目录暂无已打包产物，安装前将先构建 ARM64 安装包。"
      : "No built ARM64 artifact in release/ yet; will build before installing.";

  const officialSummary = status.officialRelease
    ? zh
      ? `最新官方正式版：${status.officialRelease.tag} (${status.officialRelease.assetName})。切到官方版将不含本地定制功能。`
      : `Latest official release: ${status.officialRelease.tag} (${status.officialRelease.assetName}). Switching drops local custom patches.`
    : zh
      ? "点击右侧刷新按钮查询 pingdotgg/t3code 最新官方正式版，下载并验证官方签名后自动安装。"
      : "Refresh to check the latest stable release on pingdotgg/t3code; verifies official signature before installing.";

  const rollbackSummary = zh
    ? `将从隐藏备份目录 ~/.t3/official-backup/T3 Code (Official).app${status.officialBackupVersion ? ` (v${status.officialBackupVersion})` : ""} 恢复原版并重启。`
    : `Restores ~/.t3/official-backup/T3 Code (Official).app${status.officialBackupVersion ? ` (v${status.officialBackupVersion})` : ""} and relaunches.`;

  const canSyncUpstreamBranch =
    !status.repoBranch ||
    status.repoBranch.startsWith("custom/") ||
    status.repoBranch.startsWith("feat/");

  const repoContextLabel = status.repoBranch
    ? zh
      ? `当前分支：${status.repoBranch}${status.repoBaseTag ? ` · 基线 ${status.repoBaseTag}` : ""}`
      : `Branch: ${status.repoBranch}${status.repoBaseTag ? ` · Base ${status.repoBaseTag}` : ""}`
    : null;

  const targetDescription =
    effectiveTarget === "custom"
      ? localBuildSummary
      : effectiveTarget === "official"
        ? officialSummary
        : rollbackSummary;

  const isMigrationCaveatVisible =
    effectiveTarget !== "custom" &&
    status.installedKind === "custom" &&
    status.liveDbMigrationId !== null;

  const handleTargetChange = (nextValue: string | null) => {
    if (nextValue !== "custom" && nextValue !== "official" && nextValue !== "rollback") return;
    setTarget(nextValue);
    if (nextValue === "official" && status.officialRelease === null) {
      loadStatus(true);
    }
  };

  const handleBuildFirstChange = (checked: boolean) => {
    const next = Boolean(checked);
    setBuildFirst(next);
    if (!next) {
      setSyncUpstream(false);
    }
  };

  const handleSyncUpstreamChange = (checked: boolean) => {
    const next = Boolean(checked);
    setSyncUpstream(next);
    if (next) {
      setBuildFirst(true);
    }
  };

  const handleRunUpgrade = async () => {
    const bridge = getLocalUpgradeBridge();
    if (!bridge) return;

    const effectiveSyncUpstream = syncUpstream && canSyncUpstreamBranch;
    const shouldBuildFirst = buildFirst || effectiveSyncUpstream;

    const actionSummary =
      effectiveTarget === "custom"
        ? effectiveSyncUpstream
          ? zh
            ? "先拉取并对齐官方最新稳定 Tag（自动预检冲突与数据库兼容性），再重新构建、安装并重启（不会自动 push 到远端 Fork）"
            : "sync the latest official stable tag (with conflict & DB compatibility checks), rebuild, install, and relaunch (without pushing to remote)"
          : shouldBuildFirst
            ? zh
              ? "先重新构建本地定制版，再退出并自动安装重启"
              : "rebuild the custom build, then quit, install, and relaunch"
            : zh
              ? "退出并自动安装最新本地定制包后重启"
              : "quit, install the latest local custom build, and relaunch"
        : effectiveTarget === "official"
          ? zh
            ? `下载并安装官方正式版${status.officialRelease ? ` ${status.officialRelease.tag}` : ""}（将暂时失去本地定制功能）`
            : `download and install official release${status.officialRelease ? ` ${status.officialRelease.tag}` : ""} (drops local custom patches)`
          : zh
            ? "退出并恢复已隐藏备份的官方原版后重启"
            : "quit, restore the saved official app, and relaunch";

    const migrationCaveat = isMigrationCaveatVisible
      ? zh
        ? `\n\n注意：当前数据库处于 Migration #${status.liveDbMigrationId}；若目标官方版数据库结构更旧，脚本仍会自动冷备 ~/.t3/userdata，必要时可还原备份。`
        : `\n\nNote: live database is at migration #${status.liveDbMigrationId}; if the target official build uses an older schema, an automatic cold backup of ~/.t3/userdata will still be created.`
      : "";

    const confirmMessage = zh
      ? `确认执行「${actionSummary}」？\n\n请确认没有正在运行的后台任务；安装器会自动冷备 ~/.t3/userdata（保留最近 3 份）并在安装完成后自动重新打开 T3 Code。${migrationCaveat}`
      : `Proceed to ${actionSummary}?\n\nMake sure no background agent turns are active. ~/.t3/userdata will be cold-backed up automatically (latest 3 kept), and T3 Code will relaunch when finished.${migrationCaveat}`;

    const confirmed = await ensureLocalApi().dialogs.confirm(confirmMessage, {
      variant: "default",
    });
    if (!confirmed) return;

    setLaunching(true);
    void bridge
      .run({
        target: effectiveTarget,
        ...(effectiveTarget === "custom"
          ? {
              buildFirst: shouldBuildFirst,
              ...(effectiveSyncUpstream ? { syncUpstream: true } : {}),
            }
          : {}),
        ...(effectiveTarget === "official" && status.officialRelease?.tag
          ? { tag: status.officialRelease.tag }
          : {}),
      })
      .then((result) => {
        if (!mountedRef.current) return;
        if (!result.started) {
          toastManager.add({
            type: "error",
            title: zh ? "升级启动失败" : "Upgrade failed to start",
            description: result.message ?? result.logPath,
          });
          return;
        }
        setStatus((previous) => (previous ? { ...previous, upgradeInProgress: true } : previous));
        toastManager.add({
          type: "info",
          title: zh ? "升级安装器已启动" : "Upgrade installer started",
          description:
            effectiveTarget === "custom" && shouldBuildFirst
              ? effectiveSyncUpstream
                ? zh
                  ? `正在后台检查官方稳定 Tag、校验并打包，全部通过后才会自动退出重启。日志：${result.logPath}`
                  : `Syncing latest stable tag, verifying, and building in the background; T3 Code will quit and relaunch only after checks pass. Log: ${result.logPath}`
                : zh
                  ? `正在后台打包，完成后会自动退出并重启。日志：${result.logPath}`
                  : `Building in the background; T3 Code will quit and relaunch automatically. Log: ${result.logPath}`
              : zh
                ? `T3 Code 即将退出、冷备数据并自动安装重启。日志：${result.logPath}`
                : `T3 Code will quit cleanly, back up userdata, install, and relaunch. Log: ${result.logPath}`,
        });
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        toastManager.add({
          type: "error",
          title: zh ? "升级启动失败" : "Upgrade failed to start",
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (mountedRef.current) {
          setLaunching(false);
        }
      });
  };

  const upgrading = launching || status.upgradeInProgress;
  const busy = loading || upgrading;

  return (
    <SettingsSection id="local-upgrade" title={zh ? "本地升级管理" : "Local upgrade manager"}>
      <SettingsRow
        title={
          <span className="inline-flex items-center gap-2">
            <span>{zh ? "当前客户端状态" : "Installed client"}</span>
            <Badge size="sm" variant={status.installedKind === "custom" ? "secondary" : "outline"}>
              {installedBadgeLabel}
            </Badge>
          </span>
        }
        description={
          zh
            ? `版本 v${status.installedVersion ?? "unknown"}${status.liveDbMigrationId !== null ? ` · 数据库 Migration #${status.liveDbMigrationId}` : ""}${status.hasOfficialBackup ? " · 已保留官方备份" : ""}`
            : `Version v${status.installedVersion ?? "unknown"}${status.liveDbMigrationId !== null ? ` · DB migration #${status.liveDbMigrationId}` : ""}${status.hasOfficialBackup ? " · Official backup saved" : ""}`
        }
        control={
          <Button size="sm" variant="outline" disabled={loading} onClick={() => loadStatus(true)}>
            <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            <span>{zh ? "检查版本" : "Check releases"}</span>
          </Button>
        }
      />

      <SettingsRow
        title={zh ? "升级目标" : "Upgrade source"}
        description={
          isMigrationCaveatVisible
            ? `${targetDescription} ${zh ? `（提示：当前数据库位于 Migration #${status.liveDbMigrationId}，较旧官方版可能不兼容，升级时会自动冷备数据。）` : `(Note: live DB is at migration #${status.liveDbMigrationId}; older official builds may not support it, and userdata is backed up automatically.)`}`
            : targetDescription
        }
        control={
          <Select value={effectiveTarget} onValueChange={handleTargetChange}>
            <SelectTrigger
              size="sm"
              className="w-full sm:w-48"
              aria-label={zh ? "升级目标" : "Upgrade source"}
              disabled={upgrading}
            >
              <SelectValue>{targetLabel(effectiveTarget)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="custom">
                {targetLabel("custom")}
              </SelectItem>
              <SelectItem hideIndicator value="official">
                {targetLabel("official")}
              </SelectItem>
              {status.hasOfficialBackup ? (
                <SelectItem hideIndicator value="rollback">
                  {targetLabel("rollback")}
                </SelectItem>
              ) : null}
            </SelectPopup>
          </Select>
        }
      />

      {effectiveTarget === "custom" ? (
        <>
          <SettingsRow
            title={zh ? "安装前重新构建" : "Rebuild before installing"}
            description={
              zh
                ? "先在后台打包最新本地源码（macOS ARM64 zip），成功后才自动退出并替换安装。"
                : "Build a fresh macOS ARM64 package from local source first, then quit and swap automatically."
            }
            control={
              <Switch
                checked={buildFirst || (syncUpstream && canSyncUpstreamBranch)}
                disabled={busy || status.localBuild === null}
                onCheckedChange={handleBuildFirstChange}
                aria-label={zh ? "安装前重新构建" : "Rebuild before installing"}
              />
            }
          />
          <SettingsRow
            title={
              zh ? "构建前同步官方最新稳定 Tag" : "Sync latest official stable tag before build"
            }
            description={
              !canSyncUpstreamBranch
                ? zh
                  ? `当前仓库处于 ${status.repoBranch ?? "非定制"} 分支，为保护主干已禁用自动 Rebase（请切回 custom/* 或 feat/* 分支）。`
                  : `Disabled on branch ${status.repoBranch ?? "detached"}; switch to custom/* or feat/* to enable automatic stable-tag rebase.`
                : zh
                  ? `自动拉取 pingdotgg/t3code 最新稳定版 Tag；仅当新 Tag 领先当前分支且数据库兼容时自动 Rebase 定制提交并跑通校验（冲突或校验失败会自动还原且不关闭当前窗口，验证满意后再手动 push 到远端 Fork）。${repoContextLabel ? ` ${repoContextLabel}。` : ""}`
                  : `Fetches the latest stable tag from pingdotgg/t3code; auto-rebases custom commits and runs checks when ahead and DB-compatible (aborts cleanly on conflict without closing T3 Code or pushing to remote).${repoContextLabel ? ` ${repoContextLabel}.` : ""}`
            }
            control={
              <Switch
                checked={syncUpstream && canSyncUpstreamBranch}
                disabled={busy || !canSyncUpstreamBranch}
                onCheckedChange={handleSyncUpstreamChange}
                aria-label={
                  zh ? "构建前同步官方最新稳定 Tag" : "Sync latest official stable tag before build"
                }
              />
            }
          />
        </>
      ) : null}

      <SettingsRow
        title={zh ? "执行升级" : "Apply upgrade"}
        description={
          status.upgradeInProgress
            ? zh
              ? `升级后台进程运行中，可查看日志：${status.logPath}`
              : `Upgrade worker is running. Log: ${status.logPath}`
            : zh
              ? "自动优雅退出、冷备 ~/.t3/userdata（保留最近 3 份）、替换应用并重新打开。"
              : "Gracefully quits, cold-backs up ~/.t3/userdata (latest 3 kept), swaps the app, and relaunches."
        }
        control={
          <Button size="sm" disabled={busy} onClick={() => void handleRunUpgrade()}>
            {upgrading
              ? zh
                ? "升级进行中…"
                : "Upgrading…"
              : zh
                ? "一键升级并重启"
                : "Upgrade & restart"}
          </Button>
        }
      />
    </SettingsSection>
  );
}
