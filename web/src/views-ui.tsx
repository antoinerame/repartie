/* Petits utilitaires propres aux vues arbre / entraînement / fiche / trous. */

/** Typographie française : espaces insécables avant : ; ? ! » et après «, pour qu'un signe ne parte jamais seul à la ligne. */
export function fr(text: string): string {
  return text.replace(/ ([:;?!»])/g, ' $1').replace(/« /g, '« ');
}
