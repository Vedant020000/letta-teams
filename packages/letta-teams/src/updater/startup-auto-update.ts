import type { UpdateCheckResult } from './auto-update.js';

export interface UpdateNotification {
  currentVersion: string;
  latestVersion: string;
}

/**
 * Start background auto-update check on startup
 * Returns a notification if an update was applied
 */
export function startStartupAutoUpdateCheck(
  checkForNotification: () => Promise<UpdateCheckResult | undefined>,
  _logError: (...args: unknown[]) => void = console.error,
): Promise<UpdateNotification | undefined> {
  return checkForNotification()
    .then((result) => {
      if (result?.updateAvailable && result.latestVersion) {
        return { currentVersion: result.currentVersion, latestVersion: result.latestVersion };
      }

      return undefined;
    })
    .catch(() => undefined);
}

