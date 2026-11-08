import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from './module_bindings/index.ts';
import App from './App.tsx';
import './styles.css';

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'next-move';

// Each role gets its own identity, so one laptop can test both screens in two tabs.
const role = window.location.hash.startsWith('#/rep') ? 'rep' : 'customer';
const TOKEN_KEY = `${HOST}/${DB_NAME}/${role}/auth_token`;

function readToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

const connectionBuilder = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .withToken(readToken())
  .onConnect((_conn, identity, token) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode: fine, we just get a new identity next time */
    }
    console.log(`Connected as ${role}:`, identity.toHexString());
  })
  .onConnectError((_ctx, err) => console.error('SpacetimeDB connection error:', err));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>
);
