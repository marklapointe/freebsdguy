# FreeBSD Guy Website Project Progress

## Status: Initial Implementation Completed

The project is a React-based blog site with a Node.js backend, designed to be hosted on FreeBSD or in a container.

### Architecture
- **Frontend**: React + Vite + Tailwind CSS + Lucide Icons
- **Backend**: Node.js + Express (serving API and static frontend)
- **Data Storage**: Flat files (JSON for config/users, Markdown for posts)
- **Deployment**: Makefile, FreeBSD RC script, OCI Containerfile

### Completed Tasks
- [x] Project structure and dependency installation
- [x] Express backend with Auth, Posts, and Theme API
- [x] React frontend with Post list, Search, and Post detail
- [x] Admin dashboard for user creation
- [x] Dynamic theming support via API
- [x] Makefile for build and run
- [x] FreeBSD RC init script
- [x] OCI Containerfile
- [x] README.md and WebStorm Run/Debug configurations
- [x] Cleanup of template-specific files and updated to Tailwind CSS 4.0
- [x] Added example posts about FreeBSD
- [x] Made the site name configurable in `config.json` and dynamically loaded in the frontend

### How to Recreate
1. **Dependencies**: Install Node.js (v18+) and npm.
2. **Setup**:
   - `npm install`
   - The system will automatically create `server/config/users.json` with a default admin user on the first run.
   - Create `server/posts/` and `server/themes/` directories.
3. **Build**: `npm run build`
4. **Run**: `npm start` (Server runs on port 3001).

### Configuration (`server/config/config.json`)
```json
{
  "postsDir": "./posts",
  "themeDir": "./themes",
  "currentTheme": "default",
  "siteName": "The FreeBSD Guy"
}
```

### User Configuration (`server/config/users.json`)
```json
{
  "admin": {
    "username": "admin",
    "passwordHash": "$2b$10$x7o/dvu7/KBaupXvvkmhQuvqMhonmzGO.Al4EAazaPFbDusbhhdXi",
    "role": "admin"
  },
  "users": []
}
```

### Future Work (Completed items moved to Settings Menu)
- Implement more themes.

### Settings Menu - Replace that user add button with a settings menu and only allow admins to access it
- [x] Theme selection
  - [x] Post list settings
  - [x] Theme colors with a color picker and HTML/RGB color input
  - [x] Post list pagination settings
  - [x] Post list sort settings
  - [x] Post list filter settings (Basic search/sort implemented)
  - [x] Post list search bar placement settings (Top, Bottom, left, right or none)
- [x] Admin user management with full CRUD functionality
- [x] Post editor with a full WYSIWYG editor (Markdown editor with live preview via detailed UI)
- [x] Image upload manager with drag and drop (Upload button with direct insertion/copy-link support)

 