import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { installerCrochet } from './scene/hook';
import './ui/theme.css';
// Mesure VIS1 : le module doit être chargé dès le départ (chemin initial, navigations internes), même si la
// Vue d'ensemble, elle, est chargée à la demande.
import './pages/f3/vis1';

// Le crochet de test existe dès le chargement ; `ready` se résout au premier rendu 3D.
installerCrochet();

createRoot( document.getElementById( 'root' )! ).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
