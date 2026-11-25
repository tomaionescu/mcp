// Placeholder so the server can register `ui://supabase/show-issues` before
// the issues view is built. The real view replaces this file.
import '../../shared/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <p>Issues</p>
  </StrictMode>
);
