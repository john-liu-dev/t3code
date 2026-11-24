import { createRouter, RouterHistory } from "@tanstack/react-router";

import {
  bindStandaloneSettingsRouter,
  isStandaloneSettingsWindow,
  setLastStandaloneSettingsHref,
} from "./lib/standaloneSettingsWindow";
import { routeTree } from "./routeTree.gen";

export function getRouter(history: RouterHistory) {
  const router = createRouter({
    routeTree,
    history,
    context: {},
    defaultPreload: "intent",
  });
  bindStandaloneSettingsRouter(router);
  router.subscribe("onResolved", ({ toLocation }) => {
    if (isStandaloneSettingsWindow() && toLocation.pathname.startsWith("/settings/")) {
      setLastStandaloneSettingsHref(toLocation.href);
    }
  });
  return router;
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
