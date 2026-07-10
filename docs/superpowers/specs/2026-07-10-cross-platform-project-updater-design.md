# Cross-platform project updater design

## Goal

Provide double-click update launchers for Windows and macOS that bring a local checkout to the latest compatible Git revision, install current npm dependencies, and start the project.

## Deliverables

- `update.bat` for Windows.
- `update.command` for macOS, marked executable.
- README instructions for both update launchers.
- A GitHub patch release `v0.2.1` describing the new update workflow.

## Behaviour

Each updater resolves the project directory, verifies that Git, Node.js, and npm are available, then runs `git pull --ff-only` followed by `npm install` and `npm run dev` in the visible terminal. The foreground development command opens the local site through the existing Vite configuration.

`git pull --ff-only` intentionally stops if the local checkout has diverged from the remote, so an updater never creates an automatic merge commit. A failed prerequisite, pull, or dependency install shows a clear message and leaves the terminal open for the user to read it.

The updaters do not forcibly terminate local processes. If an application port is occupied, the existing development command reports that in the visible terminal.

## Platform details

- `update.bat` uses Command Prompt built-ins, `where`, and `pause`.
- `update.command` uses Bash, `command -v`, and an Enter prompt before closing after both failure and server exit.
- Both wrappers invoke `npm install` after every successful update so lockfile changes are reflected locally.

## Documentation and release

The README's Update section lists `update.bat` and `update.command` as the double-click entry points, while keeping `./update.sh` as a terminal alternative for existing users. The GitHub release `v0.2.1` identifies this as a usability patch and explains that the updaters safely fast-forward the project, install dependencies, and start the local studio.

## Validation

- Automated launcher-contract tests inspect the two files for prerequisites, safe fast-forward pulling, dependency installation, and foreground startup.
- `bash -n update.command` checks macOS shell syntax.
- `npm run check` verifies the complete test suite and production build.
