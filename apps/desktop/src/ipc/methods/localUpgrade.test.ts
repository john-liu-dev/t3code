import { DesktopLocalUpgradeStartResultSchema } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { getLocalUpgradeStatus, runLocalUpgrade } from "./localUpgrade.ts";

const decodeStartResult = Schema.decodeUnknownSync(DesktopLocalUpgradeStartResultSchema);

const sampleStatus = {
  installedKind: "official" as const,
  installedVersion: "0.1.11",
  hasOfficialBackup: true,
  officialBackupVersion: "0.1.11",
  localBuild: {
    kind: "zip" as const,
    path: "/repo/release/T3-Code-0.1.11-arm64.zip",
    version: "0.1.11",
    modifiedAt: "2026-11-24T07:27:25.000Z",
  },
  officialRelease: {
    tag: "v0.1.12",
    version: "0.1.12",
    publishedAt: "2026-11-24T08:00:00Z",
    assetKind: "zip" as const,
    assetName: "T3-Code-0.1.12-arm64.zip",
    assetUrl:
      "https://github.com/pingdotgg/t3code/releases/download/v0.1.12/T3-Code-0.1.12-arm64.zip",
  },
  liveDbMigrationId: 102,
  logPath: "/Users/alice/Library/Caches/t3code-local-upgrade/upgrade.log",
  repoDir: "/repo",
  repoBranch: "custom/daily",
  repoBaseTag: "v0.1.11",
  upgradeInProgress: false,
};

function makeTestLayer(input: {
  readonly platform?: NodeJS.Platform;
  readonly scriptExists?: boolean;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly neverExit?: boolean;
  readonly spawned?: Array<readonly [string, readonly string[]]>;
}) {
  const spawner = ChildProcessSpawner.make((command) => {
    if (ChildProcess.isStandardCommand(command)) {
      input.spawned?.push([command.command, command.args.map(String)]);
    }
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(42),
        stdin: undefined as never,
        stdout: input.neverExit
          ? Stream.never
          : Stream.make(new TextEncoder().encode(input.stdout ?? "")),
        stderr: input.neverExit
          ? Stream.never
          : Stream.make(new TextEncoder().encode(input.stderr ?? "")),
        all: Stream.empty,
        exitCode: input.neverExit
          ? Effect.never
          : Effect.succeed(ChildProcessSpawner.ExitCode(input.exitCode ?? 0)),
        isRunning: Effect.succeed(input.neverExit === true),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        getInputFd: () => undefined as never,
        getOutputFd: () => Stream.empty,
      }),
    );
  });

  return Layer.mergeAll(
    Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
      platform: input.platform ?? "darwin",
    } as DesktopEnvironment.DesktopEnvironment["Service"]),
    Layer.succeed(HostProcess.HomeDirectory, "/Users/alice"),
    Layer.succeed(HostProcess.Environment, {}),
    Path.layer,
    Layer.succeed(FileSystem.FileSystem, {
      exists: () => Effect.succeed(input.scriptExists ?? true),
    } as unknown as FileSystem.FileSystem),
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Layer.succeed(ElectronWindow.ElectronWindow, {
      main: Effect.succeedSome({ webContents: { id: 1 } }),
      settings: Effect.succeedSome({ webContents: { id: 2 } }),
    } as ElectronWindow.ElectronWindow["Service"]),
  );
}

describe("localUpgrade IPC", () => {
  it.effect("reads status from the standalone settings window and forwards --check-official", () =>
    Effect.gen(function* () {
      const spawned: Array<readonly [string, readonly string[]]> = [];
      const status = yield* getLocalUpgradeStatus
        .handler({ checkOfficial: true }, { sender: { id: 2 } })
        .pipe(
          Effect.provide(
            makeTestLayer({
              stdout: JSON.stringify(sampleStatus),
              spawned,
            }),
          ),
        );

      assert.deepEqual(status, sampleStatus);
      assert.deepEqual(spawned, [
        [
          "/Users/alice/.agents/skills/t3code-release-manager/scripts/install-local-build.sh",
          ["status", "--json", "--check-official"],
        ],
      ]);
    }),
  );

  it.effect("rejects untrusted senders and returns null on non-macOS or missing scripts", () =>
    Effect.gen(function* () {
      const spawned: Array<readonly [string, readonly string[]]> = [];
      const untrusted = yield* getLocalUpgradeStatus
        .handler(undefined, { sender: { id: 99 } })
        .pipe(Effect.provide(makeTestLayer({ stdout: JSON.stringify(sampleStatus), spawned })));
      assert.isNull(untrusted);

      const missing = yield* getLocalUpgradeStatus
        .handler(undefined, { sender: { id: 1 } })
        .pipe(Effect.provide(makeTestLayer({ scriptExists: false, spawned })));
      assert.isNull(missing);

      const linux = yield* getLocalUpgradeStatus
        .handler(undefined, { sender: { id: 1 } })
        .pipe(Effect.provide(makeTestLayer({ platform: "linux", spawned })));
      assert.isNull(linux);
      assert.deepEqual(spawned, []);
    }),
  );

  it.effect(
    "invokes custom --build, official --tag, and rollback modes and blocks invalid tags",
    () =>
      Effect.gen(function* () {
        const spawned: Array<readonly [string, readonly string[]]> = [];
        const layer = makeTestLayer({ spawned });

        const customResult = decodeStartResult(
          yield* runLocalUpgrade
            .handler({ target: "custom", buildFirst: true }, { sender: { id: 2 } })
            .pipe(Effect.provide(layer)),
        );
        assert.isTrue(customResult.started);
        assert.equal(
          customResult.logPath,
          "/Users/alice/Library/Caches/t3code-local-upgrade/upgrade.log",
        );

        const syncCustomResult = decodeStartResult(
          yield* runLocalUpgrade
            .handler({ target: "custom", syncUpstream: true }, { sender: { id: 2 } })
            .pipe(Effect.provide(layer)),
        );
        assert.isTrue(syncCustomResult.started);

        const officialResult = decodeStartResult(
          yield* runLocalUpgrade
            .handler(
              { target: "official", tag: "v0.1.12", syncUpstream: true },
              { sender: { id: 2 } },
            )
            .pipe(Effect.provide(layer)),
        );
        assert.isTrue(officialResult.started);

        const rollbackResult = decodeStartResult(
          yield* runLocalUpgrade
            .handler({ target: "rollback", syncUpstream: true }, { sender: { id: 1 } })
            .pipe(Effect.provide(layer)),
        );
        assert.isTrue(rollbackResult.started);

        const badTag = decodeStartResult(
          yield* runLocalUpgrade
            .handler({ target: "official", tag: "v0.1.12; rm -rf /" }, { sender: { id: 2 } })
            .pipe(Effect.provide(layer)),
        );
        assert.isFalse(badTag.started);
        assert.equal(badTag.message, "Invalid release tag format.");

        assert.deepEqual(
          spawned.map(([, args]) => args),
          [
            ["install", "--build"],
            ["install", "--build", "--sync-upstream"],
            ["official", "--tag", "v0.1.12"],
            ["rollback"],
          ],
        );
      }),
  );

  it.effect("surfaces stderr on non-zero launcher exit and reports timeouts cleanly", () =>
    Effect.gen(function* () {
      const failed = decodeStartResult(
        yield* runLocalUpgrade.handler({ target: "custom" }, { sender: { id: 2 } }).pipe(
          Effect.provide(
            makeTestLayer({
              exitCode: 1,
              stderr: "Another T3 Code upgrade is already running.",
            }),
          ),
        ),
      );
      assert.isFalse(failed.started);
      assert.equal(failed.message, "Another T3 Code upgrade is already running.");

      const timedOutFiber = yield* runLocalUpgrade
        .handler({ target: "official" }, { sender: { id: 2 } })
        .pipe(Effect.provide(makeTestLayer({ neverExit: true })), Effect.forkChild);
      yield* TestClock.adjust("61 seconds");
      const timedOut = decodeStartResult(yield* Fiber.join(timedOutFiber));
      assert.isFalse(timedOut.started);
      assert.equal(timedOut.message, "Timed out while starting the local upgrade worker.");
    }),
  );
});
