# Launcher port cleanup design

## Goal

Every supported launcher (`start.command`, `start.sh`, and `start.bat`) must start one fresh local application session by clearing only the application's API and web ports before it invokes the development command.

## Scope

The launchers manage only TCP ports `4317` (Express API) and `5173` (Vite web server). They never terminate processes based on a broad executable name such as `node`, so unrelated projects are not affected.

## Startup flow

For each managed port, the launcher will:

1. Find the process IDs currently listening on that port.
2. Send a normal termination signal to those processes and wait for the port to become free.
3. If the port remains occupied after a short bounded wait, forcibly terminate only the remaining listeners.
4. Verify the port is free. If it is not, print a clear error and exit without starting a second session.
5. Start `npm run dev` only after both managed ports are free.

The Unix launchers share equivalent shell logic. The Windows batch launcher uses the native `netstat` and `taskkill` tools to implement the same behavior.

## Error handling

Failures to discover a listener are treated as an already-free port. A port that cannot be released is a startup failure, not a reason to run another server. The terminal stays open in the desktop launchers so the user can read the error.

## Testing

The port-cleanup behavior will be extracted into testable Unix shell helpers. Automated tests will cover: no listener, graceful termination, forced termination after timeout, and an unreleased port preventing startup. Windows logic will be reviewed for parity and syntax because the project test runner executes on Node rather than Windows.

## Non-goals

This change does not manage processes on any other ports, alter the `npm run dev` command, or attempt to detect all Node.js processes on the computer.
