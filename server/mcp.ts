import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as repo from './repo.ts';

const INSTRUCTIONS = `Répartie est le site personnel d'arbres de débat de l'utilisateur. Il s'en sert pour s'entraîner aux discussions politiques.

Structure : Sujet (topic) → Sous-partie (subtopic) → arbre d'arguments. Chaque argument répond à son parent.
- side "moi" = le camp que l'utilisateur défend ; side "autre" = le camp d'en face. En général les camps alternent à chaque niveau.
- title = la « phrase choc », courte, telle qu'on la dirait à l'oral (max ~15 mots). body = 2-3 phrases de développement.
- kind : "fait" (vérifiable), "valeur" (désaccord de priorités), "exemple" (cas concret), "sophisme" (argument fallacieux à démasquer).
- strength : solidité de 1 (faible) à 3 (très solide). Sois honnête, y compris pour le camp "moi".
- concede : true sur un argument adverse que l'utilisateur ferait mieux de concéder.
- sources : chiffres et références réels uniquement ; ne jamais inventer de source ni de statistique. Sans source fiable, laisse vide.

Règles :
1. Avant d'écrire, lis l'existant (list_topics puis get_tree) pour placer les arguments au bon endroit et éviter les doublons.
2. Présente toujours le camp adverse sous sa meilleure forme (steelman) : pas d'homme de paille.
3. Pour enregistrer une discussion, préfère add_arguments (plusieurs nœuds en un appel, chaînés avec temp_id / parent_temp_id).
4. Un argument adverse sans réponse "moi" est un « trou » : find_gaps les liste. Propose de les combler.
5. Si un même argument sert à plusieurs endroits, utilise link_argument plutôt que de le recopier.
6. Ne supprime rien sans que l'utilisateur le demande.`;

const sourceSchema = z.object({
  label: z.string().describe('Chiffre ou référence, ex. « COR, rapport annuel 2024 : déficit de 0,4 % du PIB »'),
  url: z.string().optional().describe('Lien http(s) vers la source'),
  date: z.string().optional().describe('Date ou année de la source'),
});

const argFields = {
  side: z.enum(['moi', 'autre']).optional().describe('Camp. Par défaut : le camp opposé à celui du parent (ou "moi" à la racine).'),
  title: z.string().describe('Phrase choc, courte, dite comme à l’oral'),
  body: z.string().optional().describe('Développement en 2-3 phrases'),
  kind: z.enum(['fait', 'valeur', 'exemple', 'sophisme']).optional().describe('Type d’argument (défaut : fait)'),
  strength: z.number().int().min(1).max(3).optional().describe('Solidité de 1 à 3 (défaut : 2)'),
  concede: z.boolean().optional().describe('Point adverse à concéder'),
  sources: z.array(sourceSchema).optional().describe('Sources réelles uniquement'),
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

export function buildMcpServer() {
  const server = new McpServer({ name: 'repartie', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true };

  server.registerTool('list_topics', {
    title: 'Lister les sujets',
    description: 'Liste tous les sujets et leurs sous-parties, avec le nombre d’arguments et de trous (arguments adverses sans réponse).',
    annotations: ro,
  }, safe(() => {
    const topics = repo.overview();
    if (!topics.length) return 'Aucun sujet pour le moment. Crée-en un avec create_topic.';
    return topics.map((t) => {
      const full = repo.getTopic(t.id);
      const subs = full.subtopics.map((s) =>
        `  - ${s.title} (subtopic_id=${s.id}) — ${s.argCount} arguments, ${s.gapCount} trou(s)`).join('\n');
      return `${t.emoji} ${t.title} (topic_id=${t.id})${t.description ? ` — ${t.description}` : ''}\n${subs || '  (aucune sous-partie)'}`;
    }).join('\n\n');
  }));

  server.registerTool('get_tree', {
    title: 'Lire un arbre de débat',
    description: 'Renvoie l’arbre complet d’une sous-partie sous forme de plan indenté, avec l’identifiant de chaque argument. À appeler avant d’ajouter quoi que ce soit.',
    inputSchema: {
      subtopic_id: z.number().int(),
      detail: z.boolean().optional().describe('Inclure le développement et les sources de chaque argument'),
    },
    annotations: ro,
  }, safe(({ subtopic_id, detail }) => repo.outline(subtopic_id, !!detail)));

  server.registerTool('search', {
    title: 'Rechercher',
    description: 'Recherche plein texte dans les sujets, sous-parties et arguments. Utile pour retrouver un argument existant avant de le réutiliser ou d’éviter un doublon.',
    inputSchema: { query: z.string() },
    annotations: ro,
  }, safe(({ query }) => {
    const r: any = repo.search(query);
    const out: string[] = [];
    for (const t of r.topics) out.push(`Sujet : ${t.title} (topic_id=${t.id})`);
    for (const s of r.subtopics) out.push(`Sous-partie : ${s.topicTitle} › ${s.title} (subtopic_id=${s.id})`);
    for (const a of r.arguments) out.push(`Argument #${a.id} [${a.side === 'moi' ? 'MOI' : 'AUTRE'}] « ${a.title} » — ${a.topicTitle} › ${a.subtopicTitle} (subtopic_id=${a.subtopicId})`);
    return out.length ? out.join('\n') : 'Aucun résultat.';
  }));

  server.registerTool('find_gaps', {
    title: 'Trouver les trous',
    description: 'Liste les arguments adverses auxquels l’utilisateur n’a encore aucune réponse (hors points concédés). Filtrable par sujet ou sous-partie.',
    inputSchema: { topic_id: z.number().int().optional(), subtopic_id: z.number().int().optional() },
    annotations: ro,
  }, safe(({ topic_id, subtopic_id }) => {
    const g = repo.gaps({ topicId: topic_id, subtopicId: subtopic_id });
    if (!g.length) return 'Aucun trou : chaque argument adverse a au moins une réponse.';
    return g.map((x) => {
      const chain = x.path.map((p) => `« ${p.title} »`).join(' → ');
      return `#${x.argument.id} « ${x.argument.title} » (solidité ${x.argument.strength}/3) — ${x.topic.title} › ${x.subtopic.title} (subtopic_id=${x.subtopic.id})${chain ? `\n   contexte : ${chain}` : ''}`;
    }).join('\n');
  }));

  server.registerTool('create_topic', {
    title: 'Créer un sujet',
    description: 'Crée un nouveau sujet sur la page d’accueil (ex. « Retraites »). Vérifie d’abord avec list_topics qu’il n’existe pas déjà.',
    inputSchema: {
      title: z.string(),
      description: z.string().optional().describe('Une phrase de présentation'),
      emoji: z.string().optional().describe('Un emoji représentant le sujet'),
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
      ...argFields,
    },
  }, safe(({ subtopic_id, parent_id, ...rest }) => {
    const a = repo.createArgument({ subtopicId: subtopic_id, parentId: parent_id, ...rest });
    return `Argument ajouté : #${a.id} [${a.side === 'moi' ? 'MOI' : 'AUTRE'}] « ${a.title} »`;
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
        ...argFields,
      })).min(1),
    },
  }, safe(({ subtopic_id, arguments: items }) => {
    const created = repo.createArguments(subtopic_id, items.map((i) => ({
      tempId: i.temp_id, parentTempId: i.parent_temp_id, parentId: i.parent_id,
      side: i.side, title: i.title, body: i.body, kind: i.kind, strength: i.strength, concede: i.concede, sources: i.sources,
    })));
    return `${created.length} argument(s) ajouté(s) :\n` +
      created.map((a) => `#${a.id} [${a.side === 'moi' ? 'MOI' : 'AUTRE'}] « ${a.title} »`).join('\n');
  }));

  server.registerTool('link_argument', {
    title: 'Réutiliser un argument',
    description: 'Place dans un arbre un lien vers un argument existant (même contenu, mis à jour partout à la fois). Utile quand un argument — « la dette », par exemple — revient dans plusieurs débats.',
    inputSchema: {
      source_id: z.number().int().describe('Argument existant à réutiliser'),
      subtopic_id: z.number().int().optional(),
      parent_id: z.number().int().optional(),
      side: z.enum(['moi', 'autre']).optional(),
    },
  }, safe(({ source_id, subtopic_id, parent_id, side }) => {
    const a = repo.createArgument({ refId: source_id, subtopicId: subtopic_id, parentId: parent_id, side });
    return `Lien créé : #${a.id} réutilise #${a.refId} « ${a.title} »`;
  }));

  server.registerTool('update_argument', {
    title: 'Modifier un argument',
    description: 'Modifie un argument existant. Seuls les champs fournis changent.',
    inputSchema: {
      id: z.number().int(),
      ...argFields,
      title: z.string().optional(),
    },
  }, safe(({ id, ...patch }) => {
    const a = repo.updateArgument(id, patch);
    return `Argument #${a.id} mis à jour : « ${a.title} »`;
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
    return `Argument #${a.id} déplacé.`;
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
        text: `Entraîne-moi sur « ${sujet} ». Retrouve l'arbre correspondant dans Répartie (list_topics, get_tree avec detail). Joue ensuite le camp adverse, un argument à la fois, sous sa forme la plus solide, et attends ma réponse. Après chaque échange, dis-moi brièvement ce qui était bon ou faible dans ma réponse. À la fin, propose-moi d'enregistrer dans l'arbre les nouveaux arguments et réponses qu'on a découverts.`,
      },
    }],
  }));

  return server;
}
