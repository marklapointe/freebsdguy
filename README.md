# MDWeb Website

A dynamic blogging platform built with **React**, **Vite**, **Tailwind CSS**, and **Node.js (TypeScript)**. Designed for the MDWeb enthusiast, supporting dynamic posts, themes, and user management.

## Features

- **TypeScript Throughout**: Both frontend and backend are written in TypeScript for enhanced reliability.
- **Dynamic Markdown Posts**: Load posts from a specified directory. Supports frontmatter for metadata (title, summary, date, author).
- **Configurable Site Name**: Customize the blog's title in the configuration file.
- **Dynamic Theming**: Themes are loaded as JSON and applied via CSS variables.
- **Authentication**: RBAC with Admin and Contributor roles.
- **Admin Dashboard**: Create and manage users.
- **Markdown & Images**: Full Markdown rendering support, including images served from the post directory.
- **Searchable Homepage**: Quickly find posts by title or content.
- **Comprehensive Testing**: Unit tests for both backend logic and frontend components using Vitest.
- **Responsive Design**: Built with Tailwind CSS for mobile and desktop support.

## Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm**
- (Optional) **FreeBSD** for running the provided RC script.
- (Optional) **Podman/Docker** for OCI container support.

## Getting Started

### 1. Installation

Install the required dependencies for both frontend and backend:

```bash
npm install
```

### 2. Configuration

User settings and site configuration are stored in `server/config/config.json`.
User credentials (usernames and password hashes) are stored in `server/config/users.json`.

Default Admin credentials (created automatically if `users.json` is missing):
- **Username**: `admin`
- **Password**: `admin`

**Change this password immediately** before any network exposure (`npm run change-password admin <new_password>`). Production also requires a strong `JWT_SECRET` (never the development default).

Posts are stored in `server/posts/` (development) or a configured data directory (package install).
Themes are stored in `server/themes/` or the configured theme directory.

FreeBSD package install (`www/mdweb`) is documented under [FreeBSD package install](#freebsd-package-install) once the port is available.

### 3. Running the Project

#### Development Mode

Start the unified development server:
```bash
npm run dev
```
The application (both frontend and API) will be available at `http://localhost:5173`.

#### Production Mode

Build the project and run the production server:
```bash
npm run build
npm start
```
The site will be served at `http://localhost:5173`.

#### Using Makefile

- Build: `make build`
- Run production: `make run`
- Run development: `make run-dev`
- Clean: `make clean`

### 4. Deployment on FreeBSD

#### FreeBSD package install

When the `www/mdweb` port is available (see `ports/www/mdweb/`):

1. Build and install the package (or install from your package repository).
2. Set a strong `JWT_SECRET` in `/usr/local/etc/mdweb.env` (mode `0600`).
3. Change the admin password before exposing the service.
4. Enable and start: `sysrc mdweb_enable=YES && service mdweb start`.

Writable data lives under `/var/db/mdweb`; config under `/usr/local/etc/mdweb`.

#### Manual RC script

A sample RC script `mdweb.rc` is also provided for development installs:

1. Copy the script to `/usr/local/etc/rc.d/mdweb`.
2. Set the executable permission: `chmod +x /usr/local/etc/rc.d/mdweb`.
3. Enable the service: `sysrc mdweb_enable="YES"`.
4. Start the service: `service mdweb start`.

### 5. OCI Container

Build the container image using the provided `Containerfile`:

```bash
podman build -t mdweb -f Containerfile .
podman run -p 5173:5173 -e JWT_SECRET="$(openssl rand -hex 32)" mdweb
```

Do not use the placeholder `JWT_SECRET` from the Containerfile in production.

### 5b. Environment variables

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Required in production; signs auth tokens |
| `CONFIG_DIR` / `CONFIG_PATH` / `USERS_PATH` | Config locations |
| `PORT` | Listen port (default from config or 5173) |
| `NODE_ENV` | Set `production` for package installs |

### 6. Changing User Passwords

You can change a user's password (including the admin) using the provided CLI tool.

#### Using npm
```bash
npm run change-password <username> <new_password>
```

#### Using Shell Script
```bash
./bin/change-password.sh <username> <new_password>
```

### 7. Testing

The project uses **Vitest** for unit testing.

To run all tests:
```bash
npm test
```

To run tests in watch mode during development:
```bash
npm run test:watch
```

Tests are located in the `tests/` directory.

## Project Structure

- `src/`: React frontend source code.
- `server/`: Express backend source code.
  - `server/lib/`: Core backend logic (config, auth, posts).
  - `server/posts/`: Markdown post files and images.
  - `server/config/`: Configuration files (users, settings).
  - `server/themes/`: Dynamic theme JSON files.
- `tests/`: Unit tests for both frontend and backend.
- `public/`: Static assets for the frontend.
- `dist/`: Built frontend (generated after `npm run build`).

## Contributing

1. Add new posts as `.md` files in `server/posts/`.
2. Add new themes as `.json` files in `server/themes/`.
3. Use the Admin dashboard to create new contributors.

## License

MIT
