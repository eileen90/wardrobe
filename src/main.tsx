import '@fontsource-variable/host-grotesk';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';

registerSW({ immediate: true });
createRoot(document.getElementById('root')!).render(<App />);
