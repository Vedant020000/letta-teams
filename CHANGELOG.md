# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2025-03-12

### Added
- Auto-update functionality - checks npm for updates on startup
- Support for npm, bun, and pnpm package managers
- `DISABLE_LETTA_TEAMS_AUTOUPDATE=1` to disable auto-updates

## [0.2.0] - 2025-03-12

### Added
- Interactive TUI dashboard with `--tui` flag
- 4 tabs: Agents, Tasks, Activity, Details
- Real-time polling every 3 seconds
- Keyboard navigation (1-4, Tab, arrows, r, q)

### Changed
- Releases now trigger on version tags instead of every push to master

## [0.1.0] - 2025-03-10

### Added
- Initial release
- Spawn teammates with specialized roles
- Message, broadcast, and dispatch commands
- Background daemon for async task execution
- Task tracking and progress monitoring
- Dashboard for team activity overview
