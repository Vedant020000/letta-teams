/**
 * TUI Dashboard entry point
 */

import React from 'react';
import { render } from 'ink';
import App from './App.js';

export interface LaunchTuiOptions {
  includeInternal?: boolean;
}

/**
 * Launch the TUI dashboard
 */
export function launchTui(options: LaunchTuiOptions = {}): void {
  render(<App includeInternal={options.includeInternal || false} />);
}
