## ADDED Requirements

### Requirement: Server Process Spawning
The plugin SHALL spawn the OpenCode server process using the configured executable path, port, and hostname when the user initiates server start.

#### Scenario: Successful server spawn
- **WHEN** the user starts the server
- **THEN** the plugin spawns `opencode serve --port <port> --hostname <hostname> --cors app://obsidian.md`
- **AND** the process runs with the vault directory as the working directory

### Requirement: Server Health Checking
The plugin SHALL verify server availability by polling a health endpoint during startup.

#### Scenario: Health check during startup
- **WHEN** the server process is spawned
- **THEN** the plugin polls `GET /global/health` every 500ms
- **AND** transitions to running state when the endpoint returns HTTP 200
- **AND** transitions to error state if 15 seconds elapse without success

#### Scenario: Existing server detected
- **WHEN** the user starts the server
- **AND** a server is already running on the configured port
- **THEN** the plugin reuses the existing server
- **AND** transitions directly to running state

### Requirement: Server Shutdown
The plugin SHALL gracefully terminate the server process when stopping.

#### Scenario: Graceful shutdown
- **WHEN** the user stops the server
- **THEN** the plugin sends SIGTERM to the process
- **AND** sends SIGKILL after 2 seconds if the process is still running

### Requirement: Process State Management
The plugin SHALL maintain a state machine with states: stopped, starting, running, and error.

#### Scenario: State transitions
- **WHEN** the server is not running
- **THEN** the state is `stopped`
- **WHEN** spawn is initiated
- **THEN** the state transitions to `starting`
- **WHEN** health check succeeds
- **THEN** the state transitions to `running`
- **WHEN** spawn fails or health check times out
- **THEN** the state transitions to `error`

### Requirement: Sidebar View Registration
The plugin SHALL register an ItemView that displays in the Obsidian sidebar.

#### Scenario: View activation
- **WHEN** the user clicks the ribbon icon or runs the toggle command
- **THEN** the OpenCode view opens in the right sidebar
- **AND** if the view already exists, it is revealed

### Requirement: View State Rendering
The plugin SHALL render different UI content based on the current process state.

#### Scenario: Stopped state UI
- **WHEN** the process state is `stopped`
- **THEN** the view displays a "Start OpenCode" button

#### Scenario: Starting state UI
- **WHEN** the process state is `starting`
- **THEN** the view displays a loading spinner with "Starting OpenCode..." message

#### Scenario: Running state UI
- **WHEN** the process state is `running`
- **THEN** the view displays a header with controls and an iframe loading the server URL

#### Scenario: Error state UI
- **WHEN** the process state is `error`
- **THEN** the view displays an error message with "Retry" and "Open Settings" buttons

### Requirement: Iframe Controls
The plugin SHALL provide controls in the view header when the server is running.

#### Scenario: Header controls available
- **WHEN** the server is running
- **THEN** the header displays reload and stop buttons
- **AND** clicking reload refreshes the iframe
- **AND** clicking stop terminates the server

### Requirement: Lazy Server Start
The plugin SHALL start the server automatically when the view is opened if not already running.

#### Scenario: Auto-start on view open
- **WHEN** the user opens the OpenCode view
- **AND** the server is in `stopped` state
- **THEN** the plugin initiates server start

### Requirement: Settings Configuration
The plugin SHALL provide configurable settings for server port, hostname, executable path, project directory, and auto-start behavior.

#### Scenario: Settings persistence
- **WHEN** the user modifies settings
- **THEN** changes are persisted to plugin data
- **AND** the process manager is updated with new settings

### Requirement: Project Directory Validation
The plugin SHALL validate the project directory setting and support tilde expansion.

#### Scenario: Valid absolute path
- **WHEN** the user enters an absolute path or path starting with ~
- **AND** the path exists and is a directory
- **THEN** the setting is saved with the expanded path

#### Scenario: Invalid path rejection
- **WHEN** the user enters a relative path or non-existent path
- **THEN** a notice is displayed explaining the error
- **AND** the setting is not saved

### Requirement: Project Directory Auto-Restart
The plugin SHALL restart the server when the project directory setting changes while running.

#### Scenario: Restart on directory change
- **WHEN** the user changes the project directory
- **AND** the server is currently running
- **THEN** the plugin stops and restarts the server with the new directory

### Requirement: Commands Registration
The plugin SHALL register commands for toggling the view and controlling the server.

#### Scenario: Toggle command
- **WHEN** the user runs "Toggle OpenCode panel" command or presses Mod+Shift+O
- **THEN** the view opens if closed, or closes if open

#### Scenario: Start and stop commands
- **WHEN** the user runs "Start OpenCode server" command
- **THEN** the server starts
- **WHEN** the user runs "Stop OpenCode server" command
- **THEN** the server stops

### Requirement: Ribbon Icon
The plugin SHALL add a ribbon icon that activates the OpenCode view.

#### Scenario: Ribbon icon click
- **WHEN** the user clicks the OpenCode ribbon icon
- **THEN** the OpenCode view is activated in the right sidebar
