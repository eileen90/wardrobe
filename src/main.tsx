import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/inter-tight';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { resumePending } from './cleaner';
import { init } from './store';

registerSW({ immediate: true });
createRoot(document.getElementById('root')!).render(<App />);
void init().then(resumePending);
