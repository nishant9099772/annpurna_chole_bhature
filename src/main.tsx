import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installCapacitorApiFetchInterceptor } from './utils/apiClient';

installCapacitorApiFetchInterceptor();

createRoot(document.getElementById('root')!).render(<App />);

