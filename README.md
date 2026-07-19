# UniScheduler

University course, timetable, and exam scheduling desktop app — built with **React + Vite** on the front end and **Electron** wrapping an embedded **Express** backend for a self-contained Windows install.

## Features

- Course, room, teacher, department, term, and exam management
- Automated timetable scheduling with conflict detection
- Student enrollment, attendance, grades, and gradebook
- Admissions applications workflow
- Reports, audit log, and backups
- Role-based access (admin / faculty / student)
- Multi-language UI: English, Pashto (ps), and Dari (prs) with RTL support
- Licensed activation and auto-update

## Tech stack

| Layer     | Tech                                          |
|-----------|-----------------------------------------------|
| Frontend  | React 19, Vite, Recharts, i18next             |
| Desktop   | Electron, electron-builder, electron-updater  |
| Backend   | Express, JWT auth, bcrypt, Multer, SQLite     |

## Getting started

```bash
npm install        # install dependencies
npm run dev        # run the Vite dev server (browser, front end only)
```

### Running the full desktop app

```bash
npm run electron       # build the front end, copy the backend, launch Electron
npm run electron:dev   # launch Electron against an existing build (faster)
```

The database is created automatically in the OS app-data directory on first run.

## Building a release

```bash
npm run dist       # build an unsigned Windows installer (NSIS)
npm run release    # build and publish to the GitHub releases repo
```

Installer output goes to `C:/UniScheduler-release`.

## Scripts

| Script            | Purpose                                            |
|-------------------|----------------------------------------------------|
| `npm run dev`     | Vite dev server                                    |
| `npm run build`   | Production front-end build                          |
| `npm run lint`    | Run Oxlint                                          |
| `npm run electron`| Full build + launch Electron                       |
| `npm run dist`    | Package a Windows installer                         |
| `npm run release` | Package and publish an auto-update release          |

## Project layout

```
src/            React front end (pages, components, contexts, hooks, i18n)
electron/       Electron main process + embedded Express backend
scripts/        Build, icon, and license tooling
build/          App icons
```

## Security notes

- The license-signing **private key** (`license-keys/`) is git-ignored and must never be committed.
- This is a private, commercially licensed project. Keep the repository private.

---

© LEMON_Soft. All rights reserved.
