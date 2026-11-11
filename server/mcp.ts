import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as repo from './repo.ts';

const INSTRUCTIONS = `Répartie est le site personnel d'arbres de débat de l'utilisateur. Il s'en sert pour s'entraîner aux discussions politiques.

Structure : Sujet (topic) → Sous-partie (subtopic) → arbre d'arguments. Chaque argument répond à son parent.
- side = QUI PARLE : "moi" (l'utilisateur) ou "autre" (le camp d'en face).
- relation = rapport au parent : "refute" (le contredit), "renforce" (va dans son sens), "nuance" (le tempère sans le contredire). Défaut : camp opposé au parent = refute, même camp = renforce. Un argument du camp d'en face qui va pourtant dans le sens de l'utilisateur se note side "autre" + la relation qui convient.
- Le site en déduit si chaque argument va POUR ou CONTRE l'utilisateur, et les « trous » : arguments contre lui auxquels rien ne répond.
- title = la « phrase choc », courte, telle qu'on la dirait à l'oral (max ~15 mots). body = 2-3 phrases de développement.
- kind : "fait" (vérifiable), "valeur" (désaccord de priorités), "exemple" (cas concret), "sophisme" (argument fallacieux à démasquer ; précise lequel dans fallacy).
- strength = force du RAISONNEMENT de 1 à 3, honnêtement, y compris pour le camp "moi". La fiabilité des faits se gère à part : sources, et verify = true en cas de doute.
- closure : "concede" (point que l'utilisateur a intérêt à concéder) ou "valeurs" (désaccord de valeurs assumé : on le nomme et on s'arrête). Une branche close ne compte plus comme trou. rebound = la phrase « et pourtant » qui permet de rebondir après la concession.
- backers = qui défend cette idée (parti, personnalité, think tank). RÈGLE STRICTE : ne jamais attribuer une position sans source (déclaration, programme, vote, article daté). Les positions changent et se caricaturent vite ; une attribution sans source s'affiche « à vérifier ». Dans le doute, n'attribue pas.
- principles = principes de l'utilisateur mobilisés par l'argument (ex. « Tyrannie de la majorité », « Qui paie le coût »). Réutilise les principes existants (list_principles) plutôt que d'en créer des variantes.
- sources : chiffres et références réels uniquement ; ne jamais inventer de source ni de statistique. Sans source fiable, laisse vide et mets verify = true si l'argument repose sur un fait.

Règles :
1. Avant d'écrire, lis l'existant (list_topics puis get_tree) pour placer les arguments au bon endroit et éviter les doublons.
2. Présente toujours le camp adverse sous sa meilleure forme (steelman) : pas d'homme de paille.
3. Pour enregistrer une discussion, préfère add_arguments (plusieurs nœuds en un appel, chaînés avec temp_id / parent_temp_id).
4. find_gaps liste ce que l'utilisateur ne sait pas encore contrer ; find_unsourced ce qu'il affirme sans preuve. Propose de les traiter.
5. Si un même argument sert à plusieurs endroits, utilise link_argument plutôt que de le recopier.
6. Ne supprime rien sans que l'utilisateur le demande.`;

const sourceSchema = z.object({
  label: z.string().describe('Chiffre ou référence, ex. « COR, rapport annuel 2024 : déficit de 0,4 % du PIB »'),
  url: z.string().optional().describe('Lien http(s) vers la source'),
  date: z.string().optional().describe('Date ou année de la source'),
});

const backerSchema = z.object({
  name: z.string().describe('Parti, personnalité ou organisation, ex. « RN », « LFI », « Institut Montaigne »'),
  source: z.string().optional().describe('Preuve de l’attribution : programme, déclaration, vote, article (obligatoire en pratique)'),
  url: z.string().optional(),
  date: z.string().optional(),
});

const contentFields = {
  side: z.enum(['moi', 'autre']).optional().describe('Qui parle. Défaut : le camp opposé à celui du parent (ou "moi" à la racine).'),
  relation: z.enum(['refute', 'renforce', 'nuance']).optional().describe('Rapport au parent. Défaut : refute si camp opposé, renforce si même camp.'),
  title: z.string().describe('Phrase choc, courte, dite comme à l’oral'),
  body: z.string().optional().describe('Développement en 2-3 phrases'),
  kind: z.enum(['fait', 'valeur', 'exemple', 'sophisme']).optional().describe('Type d’argument (défaut : fait)'),
  fallacy: z.string().optional().describe(`Si kind = sophisme, lequel. Valeurs usuelles : ${repo.FALLACIES.join(', ')}.`),
  strength: z.number().int().min(1).max(3).optional().describe('Force du raisonnement de 1 à 3 (défaut : 2)'),
  verify: z.boolean().optional().describe('À vérifier : un fait ou une attribution douteux'),
  sources: z.array(sourceSchema).optional().describe('Sources réelles uniquement'),
  backers: z.array(backerSchema).optional().describe('Qui défend cette idée, avec source. Remplace la liste existante.'),
  principles: z.array(z.string()).optional().describe('Noms des principes mobilisés. Remplace la liste existante.'),
  closure: z.enum(['', 'concede', 'valeurs']).optional().describe('Clôture : concede (point à concéder) ou valeurs (désaccord de valeurs assumé)'),
  rebound: z.string().optional().describe('Phrase « et pourtant » pour rebondir après la clôture'),
};

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}
function fail(e: unknown) {
  return { content: [{ type: 'text' as const, text: `Erreur : ${e instanceof Error ? e.message : String(e)}` }], isError: true };
}
function safe<A>(fn: (a: A) => string) {
  return async (a: A) => {
    try { return text(fn(a)); } catch (e) { return fail(e); }
  };
}
const tag = (a: repo.Arg) => `#${a.id} [${a.side === 'moi' ? 'MOI' : 'AUTRE'}${a.stance === 'pour' ? ', pour moi' : ', contre moi'}] « ${a.title} »`;

export function buildMcpServer() {
  const server = new McpServer({ name: 'repartie', version: '1.1.0' }, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true };

  server.registerTool('list_topics', {
    title: 'Lister les sujets',
    description: 'Liste tous les sujets et leurs sous-parties, avec le nombre d’arguments, de trous et d’éléments à vérifier.',
    annotations: ro,
  }, safe(() => {
    const topics = repo.overview();
    if (!topics.length) return 'Aucun sujet pour le moment. Crée-en un avec create_topic.';
    return topics.map((t) => {
      const full = repo.getTopic(t.id);
      const subs = full.subtopics.map((s) =>
        `  - ${s.title} (subtopic_id=${s.id}) — ${s.argCount} arguments, ${s.gapCount} trou(s), ${s.checkCount} à vérifier`).join('\n');
      return `${t.title} (topic_id=${t.id})${t.description ? ` — ${t.description}` : ''}\n${subs || '  (aucune sous-partie)'}`;
    }).join('\n\n');
  }));

  server.registerTool('get_tree', {
    title: 'Lire un arbre de débat',
    description: 'Renvoie l’arbre complet d’une sous-partie sous forme de plan indenté, avec l’identifiant, la relation au parent et la position (pour / contre moi) de chaque argument. À appeler avant d’ajouter quoi que ce soit.',
    inputSchema: {
      subtopic_id: z.number().int(),
      detail: z.boolean().optional().describe('Inclure le développement, les sources et les sources d’attribution'),
    },
    annotations: ro,
  }, safe(({ subtopic_id, detail }) => repo.outline(subtopic_id, !!detail)));

  server.registerTool('search', {
    title: 'Rechercher',
    description: 'Recherche plein texte dans les sujets, sous-parties, principes et arguments (y compris sources et partis). Utile pour retrouver un argument avant de le réutiliser ou d’éviter un doublon.',
    inputSchema: { query: z.string() },
    annotations: ro,
  }, safe(({ query }) => {
    const r: any = repo.search(query);
    const out: string[] = [];
    for (const t of r.topics) out.push(`Sujet : ${t.title} (topic_id=${t.id})`);
    for (const s of r.subtopics) out.push(`Sous-partie : ${s.topicTitle} › ${s.title} (subtopic_id=${s.id})`);
    for (const p of r.principles) out.push(`Principe : ${p.title} (principle_id=${p.id})`);
    for (const a of r.arguments) out.push(`Argument #${a.id} [${a.side === 'moi' ? 'MOI' : 'AUTRE'}] « ${a.title} » — ${a.topicTitle} › ${a.subtopicTitle} (subtopic_id=${a.subtopicId})`);
    return out.length ? out.join('\n') : 'Aucun résultat.';
  }));

  server.registerTool('find_gaps', {
    title: 'Trouver les trous',
    description: 'Liste les arguments qui vont contre l’utilisateur et auxquels il n’a encore aucune réponse (hors branches closes : points concédés et désaccords de valeurs). Filtrable par sujet ou sous-partie.',
    inputSchema: { topic_id: z.number().int().optional(), subtopic_id: z.number().int().optional() },
    annotations: ro,
  }, safe(({ topic_id, subtopic_id }) => {
    const g = repo.gaps({ topicId: topic_id, subtopicId: subtopic_id });
    if (!g.length) return 'Aucun trou : chaque argument contre l’utilisateur a une réponse ou est dans une branche close.';
    return g.map((x) => {
      const chain = x.path.map((p) => `« ${p.title} »`).join(' → ');
      return `#${x.argument.id} « ${x.argument.title} » (solidité ${x.argument.strength}/3) — ${x.topic.title} › ${x.subtopic.title} (subtopic_id=${x.subtopic.id})${chain ? `\n   contexte : ${chain}` : ''}`;
    }).join('\n');
  }));

  server.registerTool('find_unsourced', {
    title: 'Trouver ce qui est à vérifier',
    description: 'Liste ce qui est affirmé sans preuve : arguments marqués « à vérifier », faits sans source, attributions à un parti sans source. Complément de find_gaps.',
    inputSchema: { topic_id: z.number().int().optional(), subtopic_id: z.number().int().optional() },
    annotations: ro,
  }, safe(({ topic_id, subtopic_id }) => {
    const list = repo.unsourced({ topicId: topic_id, subtopicId: subtopic_id });
    if (!list.length) return 'Rien à vérifier.';
    return list.map((x) =>
      `${tag(x.argument)} — ${x.topic.title} › ${x.subtopic.title} (subtopic_id=${x.subtopic.id})\n   ${x.argument.checks.join(' ; ')}`).join('\n');
  }));

  server.registerTool('list_principles', {
    title: 'Lister les principes',
    description: 'Liste les principes de l’utilisateur (critères qui reviennent d’un sujet à l’autre) et le nombre d’arguments qui s’en servent.',
    annotations: ro,
  }, safe(() => {
    const list = repo.listPrinciples();
    if (!list.length) return 'Aucun principe pour le moment.';
    return list.map((p) => `${p.title} (principle_id=${p.id}) — ${p.useCount} argument(s)${p.description ? `\n   ${p.description}` : ''}`).join('\n');
  }));

  server.registerTool('get_principle', {
    title: 'Lire un principe',
    description: 'Montre tous les arguments qui mobilisent un principe, avec leur position (pour / contre l’utilisateur). Sert au test d’inversion : l’utilisateur applique-t-il ce principe de façon cohérente d’un sujet à l’autre ?',
    inputSchema: { principle_id: z.number().int() },
    annotations: ro,
  }, safe(({ principle_id }) => {
    const p = repo.getPrinciple(principle_id);
    const lines = [`Principe : ${p.title} (principle_id=${p.id})`];
    if (p.description) lines.push(p.description);
    lines.push('');
    if (!p.uses.length) lines.push('(aucun argument ne s’en sert)');
    for (const u of p.uses) lines.push(`${tag(u.argument)} — ${u.topic.title} › ${u.subtopic.title}`);
    return lines.join('\n');
  }));

  server.registerTool('create_principle', {
    title: 'Créer un principe',
    description: 'Crée un principe (ex. « Non-nuisance », « Tyrannie de la majorité »). On peut aussi en créer à la volée via le champ principles des arguments.',
    inputSchema: { title: z.string(), description: z.string().optional() },
  }, safe((a) => {
    const p = repo.createPrinciple(a);
    return `Principe créé : ${p.title} (principle_id=${p.id})`;
  }));

  server.registerTool('create_topic', {
    title: 'Créer un sujet',
    description: 'Crée un nouveau sujet sur la page d’accueil (ex. « Retraites »). Vérifie d’abord avec list_topics qu’il n’existe pas déjà.',
    inputSchema: {
      title: z.string(),
      description: z.string().optional().describe('Une phrase de présentation'),
    },
  }, safe((a) => {
    const t = repo.createTopic(a);
    return `Sujet créé : ${t.title} (topic_id=${t.id})`;
  }));

  server.registerTool('create_subtopic', {
    title: 'Créer une sous-partie',
    description: 'Crée une sous-partie dans un sujet. Son titre est la question ou la thèse débattue (ex. « Faut-il reculer l’âge légal ? »). Elle contient un arbre de débat.',
    inputSchema: {
      topic_id: z.number().int(),
      title: z.string(),
      description: z.string().optional(),
    },
  }, safe(({ topic_id, title, description }) => {
    const s = repo.createSubtopic({ topicId: topic_id, title, description });
    return `Sous-partie créée : ${s.title} (subtopic_id=${s.id})`;
  }));

  server.registerTool('add_argument', {
    title: 'Ajouter un argument',
    description: 'Ajoute un argument à un arbre. Avec parent_id, il répond à cet argument ; sinon il est posé à la racine de subtopic_id (argument d’ouverture).',
    inputSchema: {
      subtopic_id: z.number().int().optional().describe('Obligatoire si parent_id est absent'),
      parent_id: z.number().int().optional().describe('Argument auquel celui-ci répond'),
      ...contentFields,
    },
  }, safe(({ subtopic_id, parent_id, ...rest }) => {
    const a = repo.createArgument({ subtopicId: subtopic_id, parentId: parent_id, ...rest });
    return `Argument ajouté : ${tag(a)}`;
  }));

  server.registerTool('add_arguments', {
    title: 'Ajouter plusieurs arguments',
    description: 'Ajoute tout un morceau d’arbre en un seul appel. Chaque élément se rattache soit à un argument existant (parent_id), soit à un élément précédent de la même liste (parent_temp_id → son temp_id), soit à la racine. Les parents doivent précéder leurs enfants dans la liste.',
    inputSchema: {
      subtopic_id: z.number().int().describe('Sous-partie cible'),
      arguments: z.array(z.object({
        temp_id: z.string().optional().describe('Identifiant temporaire pour que d’autres éléments de la liste s’y rattachent'),
        parent_temp_id: z.string().optional().describe('temp_id d’un élément précédent de cette liste'),
        parent_id: z.number().int().optional().describe('Identifiant d’un argument déjà existant'),
        ...contentFields,
      })).min(1),
    },
  }, safe(({ subtopic_id, arguments: items }) => {
    const created = repo.createArguments(subtopic_id, items.map(({ temp_id, parent_temp_id, parent_id, ...rest }) => ({
      tempId: temp_id, parentTempId: parent_temp_id, parentId: parent_id, ...rest,
    })));
    return `${created.length} argument(s) ajouté(s) :\n` + created.map(tag).join('\n');
  }));

  server.registerTool('link_argument', {
    title: 'Réutiliser un argument',
    description: 'Place dans un arbre un lien vers un argument existant (même contenu, mis à jour partout à la fois). Utile quand un argument — « la dette », par exemple — revient dans plusieurs débats.',
    inputSchema: {
      source_id: z.number().int().describe('Argument existant à réutiliser'),
      subtopic_id: z.number().int().optional(),
      parent_id: z.number().int().optional(),
      side: z.enum(['moi', 'autre']).optional(),
      relation: z.enum(['refute', 'renforce', 'nuance']).optional(),
    },
  }, safe(({ source_id, subtopic_id, parent_id, side, relation }) => {
    const a = repo.createArgument({ refId: source_id, subtopicId: subtopic_id, parentId: parent_id, side, relation });
    return `Lien créé : ${tag(a)} réutilise #${a.refId}`;
  }));

  server.registerTool('update_argument', {
    title: 'Modifier un argument',
    description: 'Modifie un argument existant. Seuls les champs fournis changent (backers et principles remplacent la liste entière).',
    inputSchema: {
      id: z.number().int(),
      ...contentFields,
      title: z.string().optional(),
    },
  }, safe(({ id, ...patch }) => {
    const a = repo.updateArgument(id, patch);
    return `Argument mis à jour : ${tag(a)}`;
  }));

  server.registerTool('move_argument', {
    title: 'Déplacer un argument',
    description: 'Déplace un argument (et toutes ses réponses) sous un autre parent, ou à la racine d’une sous-partie.',
    inputSchema: {
      id: z.number().int(),
      new_parent_id: z.number().int().optional().describe('Nouveau parent. Absent = racine.'),
      subtopic_id: z.number().int().optional().describe('Sous-partie cible si déplacement à la racine d’un autre arbre'),
    },
  }, safe(({ id, new_parent_id, subtopic_id }) => {
    const a = repo.moveArgument(id, { parentId: new_parent_id ?? null, subtopicId: subtopic_id });
    return `Argument #${a.id} déplacé. Vérifie sa relation au nouveau parent (update_argument relation) si besoin.`;
  }));

  server.registerTool('delete_argument', {
    title: 'Supprimer un argument',
    description: 'Supprime un argument ET toutes les réponses situées en dessous. Irréversible : à n’utiliser que sur demande explicite de l’utilisateur.',
    inputSchema: { id: z.number().int() },
    annotations: { destructiveHint: true },
  }, safe(({ id }) => {
    const r = repo.deleteArgument(id);
    return `${r.deleted} argument(s) supprimé(s).`;
  }));

  server.registerPrompt('sparring', {
    title: 'Sparring sur un sujet',
    description: 'Claude joue le camp adverse sur une sous-partie et enrichit l’arbre au fil de l’échange.',
    argsSchema: { sujet: z.string().describe('Sujet ou sous-partie à travailler') },
  }, ({ sujet }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Entraîne-moi sur « ${sujet} ». Retrouve l'arbre correspondant dans Répartie (list_topics, get_tree avec detail). Joue ensuite le camp adverse, un argument à la fois, sous sa forme la plus solide, en privilégiant les trous (find_gaps), et attends ma réponse. Après chaque échange, dis-moi brièvement ce qui était bon ou faible dans ma réponse. À la fin, propose-moi d'enregistrer dans l'arbre les nouveaux arguments et réponses qu'on a découverts.`,
      },
    }],
  }));

  return server;
}
