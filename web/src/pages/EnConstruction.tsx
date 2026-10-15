// Page provisoire (lots F3 et F4) : titre + mention « en construction ».

export function EnConstruction( { titre }: { titre: string } ) {

	return (
		<section className="page-vide">
			<h1>{ titre }</h1>
			<p className="muet">en construction</p>
		</section>
	);

}
