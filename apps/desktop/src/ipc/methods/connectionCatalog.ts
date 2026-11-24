import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopConnectionCatalogStore from "../../app/DesktopConnectionCatalogStore.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getConnectionCatalog = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_CONNECTION_CATALOG_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.connectionCatalog.get")(function* () {
    const store = yield* DesktopConnectionCatalogStore.DesktopConnectionCatalogStore;
    return Option.getOrNull(yield* store.get);
  }),
});

export const setConnectionCatalog = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_CONNECTION_CATALOG_CHANNEL,
  payload: Schema.String,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.connectionCatalog.set")(function* (catalog, event) {
    const store = yield* DesktopConnectionCatalogStore.DesktopConnectionCatalogStore;
    const electronWindow = yield* Effect.serviceOption(ElectronWindow.ElectronWindow);
    const stored = yield* store.set(catalog);
    if (stored && Option.isSome(electronWindow)) {
      if (event !== undefined && electronWindow.value.sendOthers !== undefined) {
        yield* electronWindow.value
          .sendOthers(event.sender.id, IpcChannels.CONNECTION_CATALOG_CHANGED_CHANNEL)
          .pipe(Effect.ignoreCause);
      } else if (event === undefined) {
        yield* electronWindow.value
          .sendAll(IpcChannels.CONNECTION_CATALOG_CHANGED_CHANNEL)
          .pipe(Effect.ignoreCause);
      }
    }
    return stored;
  }),
});
