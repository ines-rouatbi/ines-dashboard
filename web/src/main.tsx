import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { installerCrochet } from './scene/hook';
import './ui/theme.css';

// Le crochet de test existe dès le chargement ; `ready` se résout au premier rendu 3D.
installerCrochet();

createRoot( document.getElementById( 'root' )! ).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
