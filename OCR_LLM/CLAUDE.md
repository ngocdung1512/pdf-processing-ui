# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

All commands are run from the repo root unless noted.

### Initial Setup
```bash
yarn setup          # Install all dependencies, copy .env files, run Prisma setup
```
After setup, fill in `server/.env.development` with your LLM/DB credentials before starting.

### Running in Development
```bash
yarn dev:server     # Start Express API server (port 3001, hot-reload)
yarn dev:frontend   # Start Vite dev server (port 3000, hot-reload)
yarn dev:collector  # Start document collector server
yarn dev:all        # Start all three concurrently
```

### Production
```bash
yarn prod:server    # Run server in production mode
yarn prod:frontend  # Build frontend (output to frontend/dist)
```

### Linting
```bash
yarn lint                      # Lint all three services with Prettier
cd server && yarn lint         # Lint server only
cd frontend && yarn lint       # Lint frontend only (ESLint --fix)
cd collector && yarn lint      # Lint collector only
```

### Testing
```bash
yarn test                                    # Run all Jest tests from root
cd server && npx jest __tests__/path/to/test.js  # Run a single test file
```
Tests are located in `server/__tests__/` organized by `models/` and `utils/` subdirectories.

### Database (Prisma / SQLite by default)
```bash
yarn prisma:setup     # generate + migrate + seed (use after setup or schema changes)
yarn prisma:generate  # regenerate Prisma client after schema edits
yarn prisma:migrate   # run pending migrations (dev mode)
yarn prisma:seed      # seed the database
yarn prisma:reset     # truncate DB and re-run migrations
```
The database file lives at `server/storage/anythingllm.db`. To switch to PostgreSQL, uncomment the PostgreSQL datasource block in `server/prisma/schema.prisma` and set `DATABASE_URL`.

### Translations
```bash
yarn verify:translations    # Verify all locale files match English
yarn normalize:translations # Normalize locale files and re-lint
```

## Architecture Overview

AnythingLLM is a monorepo with three independent Node.js services that communicate over HTTP:

```
frontend  ←→  server (REST + WebSocket)  ←→  collector
                    ↓
             VectorDB + SQLite + LLM providers
```

### `server/` — Express API (port 3001)
The backend is a CommonJS Express app. Entry point: `server/index.js`.

**Key subsystems:**

- **Endpoints** (`server/endpoints/`): Route handlers grouped by domain — `workspaces.js`, `chat.js`, `admin.js`, `document.js`, `agentWebsocket.js`, `agentFlows.js`, `mcpServers.js`, `embed/`, `api/` (developer API), etc.

- **Models** (`server/models/`): Thin Prisma ORM wrappers for each database table — `workspace.js`, `workspaceChats.js`, `user.js`, `systemSettings.js`, etc.

- **LLM Providers** (`server/utils/AiProviders/`): One directory per provider (e.g., `openai/`, `anthropic/`, `ollama/`, `gemini/`). Provider selection at runtime via `getLLMProvider()` in `server/utils/helpers/index.js`, driven by the `LLM_PROVIDER` env var.

- **Embedding Engines** (`server/utils/EmbeddingEngines/`): Same pattern — `native/`, `openai/`, `ollama/`, `cohere/`, etc. Selected via `getEmbeddingEngineSelection()`.

- **Vector DB Providers** (`server/utils/vectorDbProviders/`): Adapters for LanceDB (default), Pinecone, Chroma, Qdrant, Weaviate, Milvus, PGVector, Astra, Zilliz. Selected via `getVectorDbClass()`.

- **Chat Pipeline** (`server/utils/chats/`): `stream.js` handles the main chat flow — parses slash commands, detects agent invocations, calls `getLLMProvider` + `getVectorDbClass`, manages RAG retrieval, and streams responses. `index.js` exports `grepCommand`, `chatPrompt`, `recentChatHistory`.

- **Agents** (`server/utils/agents/`): Built on a custom "aibitat" framework (`aibitat/`). `ephemeral.js` and `imported.js` orchestrate workspace-scoped and standalone agents. Plugins live in `aibitat/plugins/` (web-browsing, SQL, file I/O, etc.).

- **Agent Flows** (`server/utils/agentFlows/`): No-code flow builder. Flow configs stored as JSON files in `storage/plugins/agent-flows/`. `executor.js` runs them step by step.

- **MCP** (`server/utils/MCP/`): Singleton `MCPCompatibilityLayer` wraps MCP servers and converts their tools into aibitat plugins (`@@mcp_<name>` format).

- **Auth / Multi-user** (`server/utils/middleware/`): `validatedRequest.js` — JWT validation; `multiUserProtected.js` — role-based access (admin / manager / default); `validApiKey.js` — API key auth for the developer API.

- **Prisma schema** (`server/prisma/schema.prisma`): SQLite by default. Core tables: `workspaces`, `workspace_documents`, `workspace_chats`, `workspace_threads`, `users`, `system_settings`, `embed_configs`, `api_keys`.

### `frontend/` — React + Vite (port 3000)
React 18 SPA using React Router v6 with lazy-loaded routes. Styling via Tailwind CSS.

- **Routing** (`frontend/src/main.jsx`): Routes guarded by `PrivateRoute` / `AdminRoute` / `ManagerRoute` components.
- **Pages** (`frontend/src/pages/`): `WorkspaceChat/`, `GeneralSettings/` (LLM, embedding, vector DB, security settings), `Admin/`, `OnboardingFlow/`.
- **Context Providers** (`frontend/src/`): `AuthContext`, `ThemeContext`, `LogoContext`, `PfpContext`, `PWAContext` — wrap the app at the root level.
- **API calls** (`frontend/src/models/`): Each model file (e.g., `workspace.js`, `system.js`) encapsulates REST calls to the server.
- **i18n**: `i18next` with locale files in `frontend/src/locales/`.

### `collector/` — Document Processor (port 8888 by default)
Separate Express service that handles document ingestion. The server calls it via `server/utils/collectorApi/`.

- **`processSingleFile/`**: Converts uploaded files to plain text — `asPDF/`, `asDocx.js`, `asImage.js`, `asAudio.js`, `asEPub.js`, `asXlsx.js`, `asTxt.js`, etc.
- **`processLink/`**: Web scraping via Puppeteer for URL-based content ingestion.
- **`processRawText/`**: Handles plain text and code snippets.
- **`extensions/`**: GitHub repos, YouTube transcripts, Confluence, etc.

## Key Conventions

- **Provider pattern**: All LLM, embedding, and vector DB providers expose a consistent interface defined by JSDoc typedefs in `server/utils/helpers/index.js` (`BaseLLMProvider`, `BaseVectorDatabaseProvider`, `BaseEmbedderProvider`). New providers must implement this interface.

- **Environment-driven configuration**: LLM provider, embedding engine, and vector DB are all switched via `.env` variables (`LLM_PROVIDER`, `EMBEDDING_ENGINE`, `VECTOR_DB`). See `server/.env.example` for all options.

- **Single-user vs. multi-user**: The app has two modes. In single-user mode, auth is bypassed. Multi-user mode (Docker) enables JWT auth, roles, and invite codes. `SystemSettings.isMultiUserMode()` is the runtime check.

- **Storage layout**: `server/storage/` contains the SQLite DB (`anythingllm.db`), uploaded documents (`documents/`), vector cache (`vector-cache/`), models (`models/`), and agent flow configs (`plugins/agent-flows/`).

- **Commit convention**: Use conventional commits — `feat:`, `fix:`, `docs:`, etc. PRs require a linked issue.

- **Linting**: Prettier (not ESLint) is used for server and collector. Frontend uses ESLint + Prettier together.