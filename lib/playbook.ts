/**
 * FLUGIA positioning playbook (global — one company, all users share it).
 *
 * Three matrices from the strategy sheet:
 *  1. AXES     — StoryBrand framing per strategic axis (pain / feeling / success).
 *  2. PERSONA  — company-size × persona → priority axes.
 *  3. SECTORS  — industry sector → the most relevant FLUGIA features.
 *
 * `selectStrategy(lead)` is a keyed lookup (retrieve-by-key): given a lead's
 * title / industry / company size it returns only the matched slice, which is
 * injected into the generation prompt — instead of stuffing the whole playbook.
 */

export type AxisKey = 'Productivité' | 'Pilotage' | 'Expertise' | 'Rentabilité' | 'Croissance';

export interface AxisAngle {
  axis: AxisKey;
  keyword: string;
  pain: string; // external problem (their words)
  feeling: string; // internal sentiment
  success: string; // what success looks like
}

// --- 1. Axis framing (StoryBrand) — from tab "Axes stratégiques" -------------
export const ANGLES: AxisAngle[] = [
  {
    axis: 'Productivité',
    keyword: 'Tâches chronophages',
    pain: "Trop de temps perdu sur des tâches répétitives, au détriment des actions vraiment importantes.",
    feeling: "Le sentiment d'être occupé en permanence sans créer de valeur concrète ; l'important passe après l'urgent.",
    success: "Plus de temps pour les tâches stratégiques, créatives ou commerciales qui génèrent une vraie valeur.",
  },
  {
    axis: 'Productivité',
    keyword: "Capacité d'exécution limitée",
    pain: "Les équipes manquent de capacité opérationnelle ; des projets prennent du retard ou ne sont jamais lancés.",
    feeling: "Une pression constante : on sait ce qu'il faudrait faire, mais le manque de temps freine tout le monde.",
    success: "Une meilleure capacité d'exécution, moins de retard, plus d'actions concrètes menées au quotidien.",
  },
  {
    axis: 'Pilotage',
    keyword: 'Organisation en silos',
    pain: "Des départements en silos, une information qui circule mal, ce qui ralentit l'exécution et crée des incompréhensions.",
    feeling: "La crainte de mauvaises décisions par manque de visibilité ; chacun avance sans coordination.",
    success: "Une organisation alignée et efficace, une meilleure circulation de l'information, des décisions plus claires.",
  },
  {
    axis: 'Pilotage',
    keyword: 'Visibilité opérationnelle limitée',
    pain: "Un manque de clarté sur ce qui est réellement fait dans les départements, par les équipes ou les outils.",
    feeling: "L'impression d'avancer sans tous les éléments ; ce flou crée de la frustration et ralentit les décisions.",
    success: "Une vision claire, objective et centralisée des actions, résultats et performances par département.",
  },
  {
    axis: 'Pilotage',
    keyword: 'Données sous-exploitées',
    pain: "Beaucoup de données générées mais dispersées, peu exploitées et difficiles à transformer en décisions.",
    feeling: "Le sentiment de passer à côté d'opportunités parce que les données ne sont ni organisées ni analysées.",
    success: "Une meilleure compréhension des données, des décisions plus rapides, une vision claire des leviers de croissance.",
  },
  {
    axis: 'Expertise',
    keyword: 'Expertise interne insuffisante',
    pain: "Un manque de compétences spécifiques en interne pour réaliser certaines actions importantes ou techniques.",
    feeling: "Devoir confier des tâches à des personnes qui ne les maîtrisent pas totalement — incertitude, baisse de qualité.",
    success: "Une équipe augmentée par des agents IA spécialisés, sans devoir recruter immédiatement.",
  },
  {
    axis: 'Expertise',
    keyword: 'Dépendance aux prestataires externes',
    pain: "Une dépendance à plusieurs prestataires externes par manque d'expertise ou de capacité interne.",
    feeling: "Le sentiment de perdre le contrôle sur les délais, les coûts, la qualité et la connaissance opérationnelle.",
    success: "Une exécution plus directe, rapide et maîtrisée, tout en réduisant certains coûts opérationnels.",
  },
  {
    axis: 'Expertise',
    keyword: 'Adoption IA freinée',
    pain: "L'envie d'intégrer l'IA mais sans experts internes pour cadrer, déployer et piloter les bons cas d'usage.",
    feeling: "Du mal à se projeter dans la transformation IA ; le manque de compétences crée doute et hésitation.",
    success: "Une entreprise augmentée par des agents IA opérationnels, avec des agents personnalisés si besoin.",
  },
  {
    axis: 'Rentabilité',
    keyword: 'Rentabilité opérationnelle insuffisante',
    pain: "Vouloir produire plus, plus vite, sans augmenter les coûts dans les mêmes proportions.",
    feeling: "Une pression continue sur les résultats ; chaque investissement doit avoir un impact mesurable.",
    success: "Une entreprise plus efficace, capable d'exécuter davantage à coût maîtrisé grâce à des agents IA supervisés.",
  },
  {
    axis: 'Croissance',
    keyword: 'Performance insuffisante',
    pain: "Malgré les efforts, l'entreprise ou les départements n'atteignent pas toujours les résultats attendus.",
    feeling: "La frustration s'installe, les équipes doutent, difficile de comprendre ce qui bloque la performance.",
    success: "Une meilleure exécution, une analyse plus fine des performances, des actions plus ciblées.",
  },
  {
    axis: 'Croissance',
    keyword: 'Croissance commerciale insuffisante',
    pain: "Chercher à générer plus de chiffre d'affaires et à renforcer le développement commercial.",
    feeling: "Chaque mois peut devenir stressant quand le chiffre d'affaires ne permet pas d'avancer sereinement.",
    success: "Des agents IA qui soutiennent les actions commerciales et aident à atteindre les objectifs de revenus.",
  },
];

// --- 2. Persona × size → priority axes — from tab "Priorités" ----------------
type SizeTier = 'Solo' | 'TPE' | 'PME_S' | 'PME_M';
type Persona = 'CEO' | 'CMO' | 'COO' | 'CFO' | 'CRM' | 'CTO' | 'Patron';

interface PriorityRow { tier: SizeTier; persona: Persona; prio: AxisKey[]; }
const PERSONA_PRIORITY: PriorityRow[] = [
  { tier: 'Solo', persona: 'Patron', prio: ['Croissance', 'Productivité', 'Expertise'] },
  { tier: 'TPE', persona: 'CEO', prio: ['Croissance', 'Productivité', 'Rentabilité'] },
  { tier: 'TPE', persona: 'CMO', prio: ['Croissance', 'Productivité', 'Pilotage'] },
  { tier: 'TPE', persona: 'COO', prio: ['Productivité', 'Rentabilité', 'Pilotage'] },
  { tier: 'PME_S', persona: 'CEO', prio: ['Croissance', 'Rentabilité', 'Pilotage'] },
  { tier: 'PME_S', persona: 'CMO', prio: ['Croissance', 'Pilotage', 'Productivité'] },
  { tier: 'PME_S', persona: 'COO', prio: ['Productivité', 'Pilotage', 'Rentabilité'] },
  { tier: 'PME_S', persona: 'CRM', prio: ['Croissance', 'Productivité', 'Pilotage'] },
  { tier: 'PME_M', persona: 'CEO', prio: ['Rentabilité', 'Pilotage', 'Croissance'] },
  { tier: 'PME_M', persona: 'CMO', prio: ['Croissance', 'Pilotage', 'Productivité'] },
  { tier: 'PME_M', persona: 'COO', prio: ['Productivité', 'Pilotage', 'Rentabilité'] },
  { tier: 'PME_M', persona: 'CFO', prio: ['Rentabilité', 'Pilotage', 'Productivité'] },
  { tier: 'PME_M', persona: 'CRM', prio: ['Croissance', 'Pilotage', 'Productivité'] },
  { tier: 'PME_M', persona: 'CTO', prio: ['Expertise', 'Pilotage', 'Productivité'] },
];
// Persona-only fallback when the size tier is unknown.
const PERSONA_DEFAULT: Record<Persona, AxisKey[]> = {
  CEO: ['Croissance', 'Rentabilité', 'Pilotage'],
  CMO: ['Croissance', 'Pilotage', 'Productivité'],
  COO: ['Productivité', 'Pilotage', 'Rentabilité'],
  CFO: ['Rentabilité', 'Pilotage', 'Productivité'],
  CTO: ['Expertise', 'Pilotage', 'Productivité'],
  CRM: ['Croissance', 'Productivité', 'Pilotage'],
  Patron: ['Croissance', 'Productivité', 'Expertise'],
};

// --- 3. Sector → relevant FLUGIA features — from tab "Sectors" ----------------
export interface Feature { name: string; why: string; }
interface SectorRow { name: string; keywords: string[]; features: Feature[]; }
const SECTORS: SectorRow[] = [
  {
    name: 'Retail & E-commerce',
    keywords: ['retail', 'commerce', 'e-commerce', 'ecommerce', 'shop', 'store', 'boutique', 'magasin', 'vente'],
    features: [
      { name: 'Chatbot', why: 'Answer questions about sizes, returns, delivery and product availability 24/7.' },
      { name: 'E-reputation', why: "Monitor and respond to customer reviews to protect the store's online image." },
      { name: 'Campaigns', why: 'Launch personalized campaigns for new collections, promotions and seasonal offers.' },
    ],
  },
  {
    name: 'Hospitality, Tourism & Leisure',
    keywords: ['hotel', 'hospitality', 'tourism', 'travel', 'leisure', 'tourisme', 'voyage'],
    features: [
      { name: 'Chatbot', why: 'Answer guest questions 24/7 about availability, bookings, check-in and services.' },
      { name: 'Call Agent', why: 'Handle calls related to reservations, confirmations and follow-ups.' },
      { name: 'E-reputation', why: 'Monitor and respond to reviews on hospitality platforms and search engines.' },
    ],
  },
  {
    name: 'Business Services',
    keywords: ['consulting', 'agency', 'agence', 'accounting', 'comptable', 'legal', 'law', 'services', 'conseil', 'marketing'],
    features: [
      { name: 'Chatbot', why: 'Answer recurring questions about services, documents, deadlines and appointments.' },
      { name: 'Call Agent', why: 'Qualify inbound calls and route requests to the right team member.' },
      { name: 'SEO content', why: 'Build authority with optimized content around your area of expertise.' },
    ],
  },
  {
    name: 'Food & Beverages',
    keywords: ['restaurant', 'food', 'beverage', 'cafe', 'café', 'bar', 'pub', 'catering', 'traiteur', 'restauration'],
    features: [
      { name: 'E-reputation', why: 'Monitor and respond to reviews on Google, Tripadvisor and other platforms.' },
      { name: 'Chatbot', why: 'Answer questions about menus, hours, reservations and availability 24/7.' },
      { name: 'Call Agent', why: 'Handle reservation calls, confirmations, cancellations and group requests.' },
    ],
  },
  {
    name: 'Health, Wellness & Personal Care',
    keywords: ['health', 'wellness', 'salon', 'clinic', 'medical', 'beauty', 'optician', 'hair', 'santé', 'bien-être', 'coiffure', 'esthétique'],
    features: [
      { name: 'Chatbot', why: 'Answer questions about prices, services, availability and appointments 24/7.' },
      { name: 'Call Agent', why: 'Handle appointment requests, availability questions and follow-ups by phone.' },
      { name: 'E-reputation', why: 'Manage local reviews and strengthen trust before visits.' },
    ],
  },
  {
    name: 'Home & Support Services',
    keywords: ['cleaning', 'maintenance', 'repair', 'home services', 'nettoyage', 'entretien', 'dépannage', 'plomberie', 'construction'],
    features: [
      { name: 'Call Agent', why: 'Handle inbound calls for quotes, bookings, availability and urgent requests.' },
      { name: 'Chatbot', why: 'Answer questions about services, prices, areas covered and booking conditions 24/7.' },
      { name: 'E-reputation', why: 'Monitor and respond to reviews to build trust and protect local reputation.' },
    ],
  },
];

// --- mappers -----------------------------------------------------------------
function mapPersona(title: string | null | undefined): Persona {
  const t = (title ?? '').toLowerCase();
  if (/\b(cmo|marketing|growth|brand|communication|acquisition)\b/.test(t)) return 'CMO';
  if (/\b(coo|operations?|ops|opérations?)\b/.test(t)) return 'COO';
  if (/\b(cfo|finance|financial|comptab|controller|trésor)\b/.test(t)) return 'CFO';
  if (/\b(cto|engineering|technical|tech|développe|developer|it|data|product)\b/.test(t)) return 'CTO';
  if (/\b(sales|commercial|account|business development|bdr|crm|customer|client)\b/.test(t)) return 'CRM';
  if (/\b(founder|fondateur|owner|propriétaire|gérant|independent|indépendant|consultant|freelance)\b/.test(t)) return 'Patron';
  if (/\b(ceo|chief executive|président|president|managing director|directeur général|dg|patron|dirigeant)\b/.test(t)) return 'CEO';
  return 'CEO';
}

function mapTier(employeeCount: number | null | undefined): SizeTier | null {
  if (employeeCount == null || employeeCount <= 0) return null;
  if (employeeCount === 1) return 'Solo';
  if (employeeCount <= 5) return 'TPE';
  if (employeeCount <= 15) return 'PME_S';
  return 'PME_M'; // 16+ (no larger tier in the sheet)
}

function mapSector(text: string): SectorRow | null {
  const t = text.toLowerCase();
  for (const s of SECTORS) {
    if (s.keywords.some((k) => t.includes(k))) return s;
  }
  return null;
}

export interface LeadStrategy {
  persona: string;
  sizeTier: string | null;
  priorityAxis: AxisKey;
  altAxis: AxisKey | null;
  angle: AxisAngle;
  sector: string | null;
  features: Feature[];
}

/** Keyed lookup: turn a lead into the matched strategy slice for generation. */
export function selectStrategy(lead: {
  title?: string | null;
  industry?: string | null;
  company?: string | null;
  employeeCount?: number | null;
}): LeadStrategy {
  const persona = mapPersona(lead.title);
  const tier = mapTier(lead.employeeCount);

  const row = tier ? PERSONA_PRIORITY.find((r) => r.tier === tier && r.persona === persona) : undefined;
  const prio = row?.prio ?? PERSONA_DEFAULT[persona];
  const priorityAxis = prio[0];
  const altAxis = prio[1] ?? null;

  // Pick an angle within the priority axis (first defined for that axis).
  const angle = ANGLES.find((a) => a.axis === priorityAxis) ?? ANGLES[0];

  const sectorRow = mapSector([lead.industry, lead.company].filter(Boolean).join(' '));

  return {
    persona,
    sizeTier: tier,
    priorityAxis,
    altAxis,
    angle,
    sector: sectorRow?.name ?? null,
    features: sectorRow?.features ?? [],
  };
}

// --- FLUGIA company context (grounds every generated message) ----------------
// Derived from the positioning sheets — global, since all users represent FLUGIA.
export const FLUGIA_COMPANY = {
  name: 'FLUGIA',
  description:
    "FLUGIA est une plateforme d'agents IA pour les entreprises. Elle permet de déployer des agents spécialisés (chatbot, agent d'appel, e-réputation, contenu SEO, campagnes) qui se connectent aux outils déjà utilisés par l'entreprise et prennent en charge des tâches précises, avec un niveau de validation gardé par l'équipe. Elle s'adresse surtout aux TPE et PME qui veulent automatiser des tâches répétitives et utiliser l'IA sans disposer d'expertise technique en interne.",
  services:
    "Agents IA spécialisés (chatbot, agent d'appel, e-réputation, contenu SEO, campagnes), connecteurs de départements, dashboards, et développement d'agents sur-mesure.",
  usps: 'Agents autonomes mais supervisés avec validation configurable ; se connecte aux outils existants ; aucune expertise IA interne requise.',
  painPoints:
    "Tâches chronophages, capacité d'exécution limitée, départements en silos, visibilité opérationnelle faible, données sous-exploitées, manque d'expertise interne, dépendance aux prestataires, adoption IA freinée, rentabilité et croissance insuffisantes.",
};

// A generic goal for a first touch (there is no per-campaign CTA anymore).
export const FLUGIA_GOAL =
  'CTA principal : amener le prospect à visiter la page d’offre FLUGIA (https://flugia.com/pricing/) et à créer un compte, de façon directe. CTA secondaire optionnel : proposer une démo/échange, sans jamais éclipser le lien.';
export const FLUGIA_VALUE_PROP =
  "FLUGIA aide les entreprises à exécuter plus, mieux et plus vite grâce à des agents IA supervisés.";

// --- ICP: which connections are worth surfacing (in-code, not user-facing) ---
// Role-based for now (headlines only expose free text pre-enrichment); we refine
// with real industry/company-size once a connection is enriched into a lead.
//
// DECISION-MAKERS ONLY — roles with the authority to buy a product/SaaS. We
// deliberately exclude individual contributors, team/tech leads, project /
// product / program / account managers, generic "managers", CRM operators, and
// pure advisors/consultants who don't hold a budget.
const ICP_ROLE_KEYWORDS = [
  // C-level (acronyms + full forms) + generic "chief"
  'ceo', 'chief executive',
  'coo', 'chief operating', 'chief operations',
  'cfo', 'chief financial', 'chief finance',
  'cmo', 'chief marketing',
  'cto', 'chief technology', 'chief technical',
  'chief revenue', 'cro',
  'cio', 'chief information', 'cpo', 'chief product', 'cso', 'chief strategy', 'chief', 'c-level',
  // Founder / owner / entrepreneur
  'founder', 'co-founder', 'cofounder', 'co founder', 'fondateur', 'fondatrice', 'co-fondateur', 'cofondateur', 'fondateur associé',
  'owner', 'co-owner', 'propriétaire', 'proprietaire', 'entrepreneur', 'entrepreneure', 'entrepreneuse',
  'solopreneur', 'solo-preneur', 'patron', 'dirigeant', 'dirigeante',
  'auto-entrepreneur', 'micro-entrepreneur', 'porteur de projet',
  "chef d'entreprise", "chef d'établissement", "chef d'etablissement",
  // Self-employed / independent (owner of their own practice)
  'indépendant', 'independant', 'independent', 'self-employed', 'self employed', 'à son compte', 'freelance', 'freelancer',
  // President / chair
  'president', 'président', 'présidente', 'presidente', 'chairman', 'chairwoman', 'chairperson', 'chair',
  // VP
  'vp', 'v.p', 'vice president', 'vice-president', 'vice président', 'vice-président', 'svp', 'evp', 'avp',
  // Director / Directeur (function heads with budget)
  'director', 'director of', 'directrice', 'directeur', 'managing director', 'directeur général', 'directeur general',
  'directrice générale', 'general manager', 'directeur associé', 'board member', 'board director', 'administrateur',
  'directeur général adjoint', 'directeur financier', 'directrice financière', 'daf', 'directeur administratif',
  'directeur marketing', 'directrice marketing', 'directeur commercial', 'directrice commerciale',
  'directeur technique', 'directrice technique', 'directeur des opérations', 'directeur des systèmes', 'dsi',
  'drh', 'directeur des ressources humaines', 'directeur de', 'directrice de',
  'pdg', 'président-directeur', 'president-directeur', 'cadre dirigeant',
  // Owner-manager (gérant of an SME) & partners / co-owners
  'gérant', 'gerant', 'gérant associé', 'co-gérant', 'partner', 'partenaire', 'associé', 'associée', 'associe',
  // Head of a function (owns the budget for their area)
  'head of', 'department head', 
  // Secretary General (top executive)
  'secretary general', 'secretary-general', 'general secretary', 'secrétaire général', 'secretaire general', 'secrétaire générale',
];

/** Whether a connection matches FLUGIA's ICP (decision-maker roles) — headline-based. */
export function matchesICP(conn: { headline?: string | null; fullName?: string | null; title?: string | null }): boolean {
  const text = [conn.title, conn.headline, conn.fullName].filter(Boolean).join(' ').toLowerCase();
  if (!text) return false;
  return ICP_ROLE_KEYWORDS.some((k) => text.includes(k));
}
