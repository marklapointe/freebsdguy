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

Default Admin credentials (stored in `users.json`):
- **Username**: `admin`
- **Password**: `admin123`

Posts are stored in `server/posts/`.
Themes are stored in `server/themes/`.

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

A sample RC script `mdweb.rc` is provided. To use it:

1. Copy the script to `/usr/local/etc/rc.d/mdweb`.
2. Set the executable permission: `chmod +x /usr/local/etc/rc.d/mdweb`.
3. Enable the service: `sysrc mdweb_enable="YES"`.
4. Start the service: `service mdweb start`.

### 5. OCI Container

Build the container image using the provided `Containerfile`:

```bash
podman build -t mdweb -f Containerfile .
podman run -p 5173:5173 mdweb
```

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
