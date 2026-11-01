import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(
  <StrictMode><main><h1>LeagueLab</h1><p>Local league modelling.</p></main></StrictMode>,
);
