import {
  DesktopLocalUpgradeRequestSchema,
  DesktopLocalUpgradeStartResultSchema,
  DesktopLocalUpgradeStatusRequestSchema,
  DesktopLocalUpgradeStatusSchema,
  type DesktopLocalUpgradeStartResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const RELEASE_TAG_PATTERN = /^v?[0-9A-Za-z._-]+$/;
const STATUS_TIMEOUT = Duration.seconds(30);
const RUN_TIMEOUT = Duration.seconds(60);

const decodeStatusJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(DesktopLocalUpgradeStatusSchema),
);

const resolveDefaultLogPath = Effect.fn("desktop.ipc.localUpgrade.resolveDefaultLogPath")(
  function* () {
    const homeDir = yield* HostProcess.HomeDirectory;
    const path = yield* Path.Path;
    return path.join(homeDir, "Library", "Caches", "t3code-local-upgrade", "upgrade.log");
  },
);

const resolveUpgradeScriptPath = Effect.fn("desktop.ipc.localUpgrade.resolveScriptPath")(
  function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    if (environment.platform !== "darwin") {
      return Option.none<string>();
    }
    const hostEnv = yield* HostProcess.Environment;
    const homeDir = yield* HostProcess.HomeDirectory;
    const path = yield* Path.Path;
    const fileSystem = yield* FileSystem.FileSystem;
    const configured = hostEnv.T3CODE_LOCAL_UPGRADE_SCRIPT?.trim();
    const candidate =
      configured && configured.length > 0
        ? configured
        : path.join(
            homeDir,
            ".agents",
            "skills",
            "t3code-release-manager",
            "scripts",
            "install-local-build.sh",
          );
    const exists = yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false));
    return exists ? Option.some(candidate) : Option.none<string>();
  },
);

const ensureTrustedAppSender = Effect.fn("desktop.ipc.localUpgrade.ensureTrustedSender")(function* (
  event: DesktopIpc.DesktopIpcInvokeEvent | undefined,
) {
  if (event === undefined) return false;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const senderWindow = yield* ElectronWindow.resolveAppWindowForWebContentsId(
    electronWindow,
    event.sender.id,
  );
  return Option.isSome(senderWindow);
});

const runUpgradeScript = Effect.fn("desktop.ipc.localUpgrade.runScript")(function* (
  scriptPath: string,
  args: readonly string[],
  timeout: Duration.Input,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const hostEnv = yield* HostProcess.Environment;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(scriptPath, args, {
          stdin: "ignore",
          env: hostEnv,
        }),
      );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return { stdout, stderr, exitCode: Number(exitCode) };
    }),
  ).pipe(Effect.timeoutOption(timeout));
});

export const getLocalUpgradeStatus = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOCAL_UPGRADE_GET_STATUS_CHANNEL,
  payload: Schema.UndefinedOr(DesktopLocalUpgradeStatusRequestSchema),
  result: Schema.NullOr(DesktopLocalUpgradeStatusSchema),
  handler: Effect.fn("desktop.ipc.localUpgrade.getStatus")(function* (options, event) {
    if (!(yield* ensureTrustedAppSender(event))) {
      return null;
    }
    const scriptPath = yield* resolveUpgradeScriptPath();
    if (Option.isNone(scriptPath)) {
      return null;
    }
    const args = [
      "status",
      "--json",
      ...(options?.checkOfficial === true ? ["--check-official"] : []),
    ];
    const outcome = yield* runUpgradeScript(scriptPath.value, args, STATUS_TIMEOUT).pipe(
      Effect.orElseSucceed(() => Option.none()),
    );
    if (Option.isNone(outcome) || outcome.value.exitCode !== 0) {
      return null;
    }
    return yield* decodeStatusJson(outcome.value.stdout.trim()).pipe(
      Effect.orElseSucceed(() => null),
    );
  }),
});

function startResult(
  started: boolean,
  logPath: string,
  message: string | null,
): DesktopLocalUpgradeStartResult {
  return {
    started,
    logPath,
    message,
  };
}

export const runLocalUpgrade = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOCAL_UPGRADE_RUN_CHANNEL,
  payload: DesktopLocalUpgradeRequestSchema,
  result: DesktopLocalUpgradeStartResultSchema,
  handler: Effect.fn("desktop.ipc.localUpgrade.run")(function* (request, event) {
    const defaultLogPath = yield* resolveDefaultLogPath();
    if (!(yield* ensureTrustedAppSender(event))) {
      return startResult(false, defaultLogPath, "Upgrade request was rejected for this window.");
    }
    const scriptPath = yield* resolveUpgradeScriptPath();
    if (Option.isNone(scriptPath)) {
      return startResult(
        false,
        defaultLogPath,
        "Local upgrade script is not installed on this machine.",
      );
    }

    const args: string[] = [];
    if (request.target === "custom") {
      args.push("install");
      if (request.buildFirst === true || request.syncUpstream === true) {
        args.push("--build");
      }
      if (request.syncUpstream === true) {
        args.push("--sync-upstream");
      }
    } else if (request.target === "official") {
      args.push("official");
      const trimmedTag = request.tag?.trim();
      if (trimmedTag && trimmedTag.length > 0) {
        if (!RELEASE_TAG_PATTERN.test(trimmedTag)) {
          return startResult(false, defaultLogPath, "Invalid release tag format.");
        }
        args.push("--tag", trimmedTag);
      }
    } else {
      args.push("rollback");
    }

    const outcome = yield* runUpgradeScript(scriptPath.value, args, RUN_TIMEOUT).pipe(
      Effect.orElseSucceed(() => Option.none()),
    );
    if (Option.isNone(outcome)) {
      return startResult(
        false,
        defaultLogPath,
        "Timed out while starting the local upgrade worker.",
      );
    }
    if (outcome.value.exitCode !== 0) {
      const detail = outcome.value.stderr.trim() || outcome.value.stdout.trim();
      return startResult(
        false,
        defaultLogPath,
        detail || `Upgrade launcher exited with code ${outcome.value.exitCode}.`,
      );
    }
    return startResult(true, defaultLogPath, null);
  }),
});
