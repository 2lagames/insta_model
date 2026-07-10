# Cross-platform project launcher design

## Goal

Provide double-click launchers for Windows and macOS that start the local project and open it in a browser. The running terminal window is the visible server lifecycle: closing that window stops the server.

## Deliverables

- `start.bat` for Windows.
- `start.command` for macOS.

## Behaviour

Each launcher resolves the project directory, installs dependencies when required, starts the existing `npm run dev` command, and opens `http://localhost:5173` after the web server is available.

The launcher keeps its own terminal window open while the development server runs. Closing that terminal window terminates the launcher and its child processes; no separate Stop command or UI control is added.

Neither launcher terminates processes that it did not start. If the required local port is occupied, the existing development command reports the issue in the visible terminal.

## Platform details

- The Windows launcher uses `cmd.exe` built-ins and `start` to open the default browser.
- The macOS launcher uses Bash and `open` to open the default browser. It is marked executable.
- Both depend on Node.js and npm being installed; missing prerequisites produce a clear terminal message.

## Validation

- Static checks confirm the two launchers call `npm run dev` and target `http://localhost:5173`.
- `npm run check` confirms the existing application remains healthy.
