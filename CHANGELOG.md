# Changelog

## [0.8.1](https://github.com/Vedant020000/letta-teams/compare/v0.8.0...v0.8.1) (2026-03-21)


### Bug Fixes

* **messaging:** drop duplicate broadcast review options ([e21c1f8](https://github.com/Vedant020000/letta-teams/commit/e21c1f8ab255336aa030d30289d48a0356982d3d))

# [0.8.0](https://github.com/Vedant020000/letta-teams/compare/v0.7.0...v0.8.0) (2026-03-21)


### Features

* **dispatch:** add review gate pipeline ([b323867](https://github.com/Vedant020000/letta-teams/commit/b323867c29390991b2885d271566b064cef587d1))
* **skills:** add built-in fallback and context window option ([35a64c0](https://github.com/Vedant020000/letta-teams/commit/35a64c0324f6778eeb49f830675dea247e01967a))

# [0.7.0](https://github.com/Vedant020000/letta-teams/compare/v0.6.0...v0.7.0) (2026-03-19)


### Features

* **council:** use disposable reviewer agent for final council decisions ([29aed49](https://github.com/Vedant020000/letta-teams/commit/29aed494bf0ca0da2341da049976a0e246b08a36))

# [0.6.0](https://github.com/Vedant020000/letta-teams/compare/v0.5.1...v0.6.0) (2026-03-19)


### Features

* **council:** add daemon-backed council orchestration and CLI flows ([b004ba7](https://github.com/Vedant020000/letta-teams/commit/b004ba7851b584a5f02c59097eb58119d8b6388b))
* **dashboard:** add compact agent-first view with recency filters ([0459e4a](https://github.com/Vedant020000/letta-teams/commit/0459e4a0169024ceadc5b19dbb01bdc490726b5d))
* **init:** finish init state wiring and release trigger ([bc8bb2e](https://github.com/Vedant020000/letta-teams/commit/bc8bb2e6260a473a26421f94ec1eb92470951bbd))
* **memory:** expand teammate memory contracts and memfs scaffolding ([5fcffd0](https://github.com/Vedant020000/letta-teams/commit/5fcffd0c7f1d4ccd757ada232cc8d6537d016dbf))
* **skill:** add scoped skill install command and README primary section ([deb5ac9](https://github.com/Vedant020000/letta-teams/commit/deb5ac9fc8144cd7fb531e0c4c2af0ff3cf4a09b))
* **status:** migrate CLI/TUI/dashboard to TODO+STATUS channels ([1cb9d19](https://github.com/Vedant020000/letta-teams/commit/1cb9d198b526c7376aeb99335ed21cf6e2ee078e))
* **tasks:** add internal task kinds and visibility controls ([5d3b546](https://github.com/Vedant020000/letta-teams/commit/5d3b546866465832eaa12d28bb2a9ab67cb6c640))
* **tasks:** add live watch command for task streaming ([ab920a0](https://github.com/Vedant020000/letta-teams/commit/ab920a0225f4cbfb641005b037c7ad554152cf0d))
* **updater:** add update notifications and manual update command ([a1593ef](https://github.com/Vedant020000/letta-teams/commit/a1593efb68b75e3a285145c3b7688d8b025acd1e))

# [0.6.0](https://github.com/Vedant020000/letta-teams/compare/v0.5.1...v0.6.0) (2026-03-19)


### Features

* **council:** add daemon-backed council orchestration and CLI flows ([b004ba7](https://github.com/Vedant020000/letta-teams/commit/b004ba7851b584a5f02c59097eb58119d8b6388b))
* **dashboard:** add compact agent-first view with recency filters ([0459e4a](https://github.com/Vedant020000/letta-teams/commit/0459e4a0169024ceadc5b19dbb01bdc490726b5d))
* **init:** finish init state wiring and release trigger ([bc8bb2e](https://github.com/Vedant020000/letta-teams/commit/bc8bb2e6260a473a26421f94ec1eb92470951bbd))
* **memory:** expand teammate memory contracts and memfs scaffolding ([5fcffd0](https://github.com/Vedant020000/letta-teams/commit/5fcffd0c7f1d4ccd757ada232cc8d6537d016dbf))
* **skill:** add scoped skill install command and README primary section ([deb5ac9](https://github.com/Vedant020000/letta-teams/commit/deb5ac9fc8144cd7fb531e0c4c2af0ff3cf4a09b))
* **status:** migrate CLI/TUI/dashboard to TODO+STATUS channels ([1cb9d19](https://github.com/Vedant020000/letta-teams/commit/1cb9d198b526c7376aeb99335ed21cf6e2ee078e))
* **tasks:** add internal task kinds and visibility controls ([5d3b546](https://github.com/Vedant020000/letta-teams/commit/5d3b546866465832eaa12d28bb2a9ab67cb6c640))
* **tasks:** add live watch command for task streaming ([ab920a0](https://github.com/Vedant020000/letta-teams/commit/ab920a0225f4cbfb641005b037c7ad554152cf0d))
* **updater:** add update notifications and manual update command ([a1593ef](https://github.com/Vedant020000/letta-teams/commit/a1593efb68b75e3a285145c3b7688d8b025acd1e))

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-03-14

### Fixed
- Updated repository URLs to Vedant020000/letta-teams
- Updated LICENSE copyright holder

## [0.5.0] - 2026-03-14

### Added
- Memfs support for durable agent memory filesystem
- Background memory initialization with `--init-prompt` flag
- `--skip-init` flag to disable memory initialization on spawn
- `--no-memfs` flag to disable memfs for a teammate
- Non-destructive memory reinitialization with `lteams reinit` command
- Conversation forking and multi-target messaging support
- Init conversation stored as a memory target for traceability
- Memfs status display in TUI agent details

### Fixed
- CI release workflow updated to Node 24 with npm cache

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
