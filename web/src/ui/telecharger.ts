// Téléchargement d'un fichier généré dans le navigateur (export CSV du lot F6) : aucun aller-retour serveur.

/** Propose `contenu` au téléchargement sous `nom` (UTF-8 avec BOM : accents lisibles dans un tableur). */
export function telechargerTexte( nom: string, contenu: string, type = 'text/csv;charset=utf-8' ): void {

	const blob = new Blob( [ '﻿', contenu ], { type } );
	const url = URL.createObjectURL( blob );
	const a = document.createElement( 'a' );
	a.href = url;
	a.download = nom;
	a.rel = 'noopener';
	document.body.appendChild( a );
	a.click();
	a.remove();
	// Laisse au navigateur le temps de lire l'objet avant de le libérer.
	setTimeout( () => URL.revokeObjectURL( url ), 30_000 );

}
