import { type NextRequest } from 'next/server';
import { json } from '@/lib/http';
import { generateMessage } from '@/lib/openrouter';
import { selectStrategy } from '@/lib/playbook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DEV-ONLY message generation preview.
 *
 * Generates a LinkedIn message from realistic dummy data shaped exactly like a
 * fully-enriched Unipile lead + the FLUGIA playbook — WITHOUT Unipile, a DB, or
 * login. Only needs OPENROUTER_API_KEY.
 *
 *   GET /api/dev/preview-message?preset=0        → one preset
 *   GET /api/dev/preview-message?preset=1&known=1
 *   GET /api/dev/preview-message?all=1           → all presets at once
 *   POST /api/dev/preview-message  { ...lead overrides }
 *
 * Disabled in production.
 */

// FLUGIA sender context (what Settings → company context would hold).
const FLUGIA = {
  name: 'FLUGIA',
  description:
    "FLUGIA connecte les départements et outils d'une entreprise, puis déploie des agents IA supervisés pour automatiser les opérations, centraliser les données et appuyer la prise de décision.",
  services:
    'Agents IA spécialisés (chatbot, agent d\'appel, e-réputation, contenu SEO, campagnes), connecteurs de départements, dashboards, et développement d\'agents sur-mesure.',
  usps: "Agents autonomes mais supervisés avec validation configurable ; se connecte aux outils existants ; aucune expertise IA interne requise.",
  painPoints:
    'Tâches chronophages, capacité d\'exécution limitée, départements en silos, visibilité opérationnelle faible, données sous-exploitées, manque d\'expertise interne, dépendance aux prestataires, adoption IA freinée, rentabilité et croissance insuffisantes.',
};

interface DummyLead {
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  industry: string;
  companySize: number;
  location: string;
  recentPosts: string[];
  known: boolean;
  offer: string;
  cta: string;
}

// Realistic, fully-enriched dummy leads (as Unipile would return them).
const PRESETS: DummyLead[] = [
  {
    firstName: 'Sara', lastName: 'El Amrani', title: 'Head of Growth', company: 'Nimbus',
    industry: 'SaaS / Software', companySize: 12, location: 'Casablanca, Morocco',
    recentPosts: [
      "On vient de doubler notre pipeline en 2 mois, mais notre équipe growth passe 60% de son temps sur du reporting manuel. Il faut qu'on automatise ça.",
      "La rétention, c'est le vrai moteur du SaaS. On lance une nouvelle stratégie de lifecycle marketing ce trimestre.",
    ],
    known: false,
    offer: 'FLUGIA — Croissance : des agents IA qui exécutent vos actions marketing et commerciales.',
    cta: 'Échanger 15 min sur votre stratégie growth',
  },
  {
    firstName: 'Yassine', lastName: 'Berrada', title: 'Founder & CEO', company: 'Palmier Group',
    industry: 'Food & Beverages', companySize: 45, location: 'Rabat, Morocco',
    recentPosts: [
      "5 nouveaux restaurants cette année. Le plus dur n'est pas d'ouvrir, c'est de garder la même qualité de service partout.",
      "Nos avis Google sont notre meilleure pub — et notre plus grande source de stress.",
    ],
    known: false,
    offer: 'FLUGIA — Rentabilité : produire plus sans exploser les coûts.',
    cta: 'Voir comment FLUGIA soutient vos opérations',
  },
  {
    firstName: 'Nadia', lastName: 'Cherkaoui', title: 'CTO', company: 'Wafr',
    industry: 'Artificial Intelligence', companySize: 60, location: 'Tangier, Morocco',
    recentPosts: [
      "Recruter des ingénieurs IA séniors au Maroc reste un vrai défi. On construit beaucoup avec une petite équipe.",
      "Shipped our new LLM-powered onboarding flow this week — small team, big output.",
    ],
    known: true,
    offer: "FLUGIA — Expertise : augmentez votre équipe avec des agents IA spécialisés.",
    cta: 'En discuter autour d\'un café',
  },
  {
    firstName: 'Omar', lastName: 'Fassi', title: 'Owner', company: 'Atlas Boutique',
    industry: 'Retail & E-commerce', companySize: 3, location: 'Marrakech, Morocco',
    recentPosts: [
      "Petite boutique, grandes ambitions. On veut vendre en ligne partout au Maroc cette année.",
    ],
    known: false,
    offer: 'FLUGIA — Croissance : générez plus de ventes avec des agents IA.',
    cta: 'Découvrir FLUGIA',
  },
];

async function run(lead: DummyLead) {
  const strategy = selectStrategy({
    title: lead.title,
    industry: lead.industry,
    company: lead.company,
    employeeCount: lead.companySize,
  });

  const { body, model } = await generateMessage({
    firstName: lead.firstName,
    lastName: lead.lastName,
    currentTitle: lead.title,
    currentCompany: lead.company,
    industry: lead.industry,
    recentPosts: lead.recentPosts,
    companyAbout: null,
    senderValueProp: lead.offer,
    senderGoal: lead.cta,
    senderCompany: {
      name: FLUGIA.name,
      description: FLUGIA.description,
      services: FLUGIA.services,
      usps: FLUGIA.usps,
      painPoints: FLUGIA.painPoints,
    },
    knownContact: lead.known,
    strategy,
  });

  return {
    lead: { ...lead },
    strategy: {
      persona: strategy.persona,
      sizeTier: strategy.sizeTier,
      priorityAxis: strategy.priorityAxis,
      altAxis: strategy.altAxis,
      angle: strategy.angle.keyword,
      sector: strategy.sector,
      features: strategy.features.map((f) => f.name),
    },
    model,
    message: body,
  };
}

async function handle(overrides: Partial<DummyLead>, url: URL) {
  if (process.env.NODE_ENV === 'production') {
    return json({ error: 'Disabled in production.' }, 403);
  }
  try {
    if (url.searchParams.get('all')) {
      const results = [];
      for (const p of PRESETS) results.push(await run(p));
      return json({ results });
    }
    const idx = Math.min(PRESETS.length - 1, Math.max(0, parseInt(url.searchParams.get('preset') ?? '0', 10) || 0));
    const base = PRESETS[idx];
    const known = url.searchParams.get('known');
    const lead: DummyLead = { ...base, ...overrides };
    if (known != null) lead.known = known === '1' || known === 'true';
    return json(await run(lead));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'generation failed' }, 500);
  }
}

export async function GET(req: NextRequest) {
  return handle({}, new URL(req.url));
}

export async function POST(req: NextRequest) {
  const overrides = (await req.json().catch(() => ({}))) as Partial<DummyLead>;
  return handle(overrides, new URL(req.url));
}
