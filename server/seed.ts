import { get } from './db.ts';
import * as repo from './repo.ts';

/** Au premier lancement, crée un sujet d'exemple pour montrer à quoi ressemble un arbre. Supprimable d'un clic. */
export function seedIfEmpty() {
  if (process.env.SEED_DEMO === '0') return;
  if ((get<any>(`SELECT COUNT(*) AS n FROM topics`)!).n > 0) return;

  const topic = repo.createTopic({
    title: 'Travail (exemple)',
    emoji: '💼',
    description: "Sujet de démonstration : supprime-le quand tu veux. Les camps sont attribués au hasard, le bouton « Inverser les camps » les échange.",
  });
  const sub = repo.createSubtopic({
    topicId: topic.id,
    title: 'Faut-il passer à la semaine de 4 jours ?',
    description: 'Réduire la semaine de travail à quatre jours, avec ou sans baisse du temps de travail total.',
  });

  repo.createArguments(sub.id, [
    {
      tempId: 'essais', side: 'moi', kind: 'fait', strength: 3,
      title: 'Les essais grandeur nature montrent une productivité maintenue',
      body: "Là où la semaine a été raccourcie sans baisse de salaire, les services ont continué à tourner et le bien-être des salariés a nettement progressé.",
      sources: [
        { label: 'Islande, essais 2015-2019 : environ 2 500 salariés du secteur public, productivité maintenue ou améliorée dans la majorité des services (rapport Autonomy / Alda)', date: '2021' },
        { label: 'Royaume-Uni, pilote 2022 : 61 entreprises, 56 ont poursuivi après six mois (4 Day Week Global / Autonomy)', date: '2023' },
      ],
    },
    {
      tempId: 'volontaires', parentTempId: 'essais', side: 'autre', kind: 'fait', strength: 3,
      title: "Ce sont des entreprises volontaires : ça ne se généralise pas",
      body: "Les structures qui se portent candidates sont celles qui pensent déjà pouvoir y arriver. C'est un biais de sélection : on ne peut rien en conclure pour l'ensemble de l'économie.",
    },
    {
      tempId: 'droit', parentTempId: 'volontaires', side: 'moi', kind: 'valeur', strength: 2,
      title: "Personne ne veut l'imposer partout : il s'agit d'ouvrir un droit à l'essayer",
      body: "L'objectif n'est pas une loi uniforme mais de permettre aux entreprises et aux salariés qui le souhaitent de négocier ce cadre.",
    },
    {
      parentTempId: 'droit', side: 'autre', kind: 'valeur', strength: 2,
      title: "Alors c'est un avantage de plus pour les cadres de bureau",
      body: "Si seuls les métiers de bureau peuvent en profiter, on creuse l'écart avec les ouvriers, les soignants ou les commerçants.",
    },
    {
      parentTempId: 'volontaires', side: 'moi', kind: 'exemple', strength: 2,
      title: "En Islande, c'était des hôpitaux et des services municipaux, pas des start-up",
      body: "L'essai islandais portait sur le secteur public : crèches, services sociaux, hôpitaux. Pas vraiment des entreprises triées sur le volet.",
    },
    {
      tempId: 'temps', side: 'moi', kind: 'valeur', strength: 2,
      title: 'Le temps libre est une richesse que le PIB ne mesure pas',
      body: "Famille, engagement associatif, santé : une société peut choisir de convertir ses gains de productivité en temps plutôt qu'en consommation.",
    },
    {
      tempId: 'modele', parentTempId: 'temps', side: 'autre', kind: 'valeur', strength: 2,
      title: "C'est le travail qui finance notre modèle social",
      body: "Moins d'heures travaillées, c'est moins de cotisations pour les retraites et la santé, au moment où la population vieillit.",
    },
    {
      parentTempId: 'modele', side: 'moi', kind: 'fait', strength: 2,
      title: "Des salariés moins épuisés, c'est moins d'arrêts maladie et de turn-over",
      body: "Une partie du coût est compensée par la baisse de l'absentéisme et des démissions, observée dans les essais.",
    },
    {
      tempId: 'paresse', parentTempId: 'temps', side: 'autre', kind: 'sophisme', strength: 1,
      title: 'Les gens ne veulent plus travailler',
      body: "Généralisation abusive : on prête une intention à tout un groupe au lieu de discuter la mesure.",
    },
    {
      parentTempId: 'paresse', side: 'moi', kind: 'fait', strength: 2,
      title: "Ce n'est pas un argument : la question est l'organisation, pas l'envie",
      body: "Ramener le débat à ce qui est mesurable : production, santé, recrutement. Le reste est un procès d'intention.",
    },
    {
      side: 'autre', kind: 'fait', strength: 3,
      title: "Compresser 35 h en 4 jours, c'est des journées de près de 9 h",
      body: "Sans baisse du temps de travail, on concentre la fatigue : journées plus longues, garde d'enfants plus compliquée, risque d'accident accru en fin de poste.",
    },
    {
      side: 'autre', kind: 'fait', strength: 3, closure: 'concede',
      rebound: "Et justement : on peut l'ouvrir là où ça marche sans l'imposer là où ça ne marche pas.",
      title: "Tous les métiers ne s'y prêtent pas de la même façon",
      body: "Travail posté, soins, commerce : là où la présence compte, moins d'heures par personne veut dire embaucher. Mieux vaut le reconnaître d'emblée.",
    },
  ]);
}
