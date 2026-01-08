# Change: Document MVP Capabilities

## Why
The Obsidian OpenCode plugin MVP has been implemented but lacks formal specification. This change retroactively documents the existing functionality to establish a baseline specification that can be expanded as the MVP is polished.

## What Changes
- **ADDED** `001-mvp-opencode-embed` capability spec covering:
  - Server process management (spawn, health check, shutdown, state machine)
  - Sidebar view with iframe embedding and state-reactive UI
  - Plugin settings with validation
  - Commands and ribbon icon integration

## Impact
- Affected specs: None (new spec)
- Affected code: None (documentation only)
- This is a retroactive documentation effort with no code changes
