import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyAppearance } from './appearance';
import 'katex/dist/katex.min.css';
import './styles.css';

applyAppearance(window.api.settings.peek());

async function boot() {
  const [data, settings] = await Promise.all([window.api.data.load(), window.api.settings.get()]);
  applyAppearance(settings);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App initialData={data} initialSettings={settings} />
    </React.StrictMode>,
  );
}

void boot();
