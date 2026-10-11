import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'highlight.js/styles/github.css';
import './styles.css';

async function boot() {
  const [data, settings] = await Promise.all([window.api.data.load(), window.api.settings.get()]);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App initialData={data} initialSettings={settings} />
    </React.StrictMode>,
  );
}

void boot();
