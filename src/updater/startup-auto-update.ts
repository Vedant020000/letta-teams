import type { AutoUpdateResult } from "./auto-update.js";

export interface UpdateNotification {
  latestVersion: string;
}

/**
 * Start background auto-update check on startup
 * Returns a notification if an update was applied
 */
export function startStartupAutoUpdateCheck(
  checkAndAutoUpdate: () => Promise<AutoUpdateResult | undefined>,
  logError: (...args: unknown[]) => void = console.error,
): Promise<UpdateNotification | undefined> {
  return checkAndAutoUpdate()
    .then((result) => {
      if (result?.enotemptyFailed) {
        logError("\n⚠️  Auto-update failed (ENOTEMPTY).");
        logError("Fix: rm -rf $(npm prefix -g)/lib/node_modules/letta-teams && npm i -g letta-teams\n");
      }

      if (result?.updateApplied && result.latestVersion) {
        return { latestVersion: result.latestVersion };
      }

      return undefined;
    })
    .catch(() => undefined);
}
