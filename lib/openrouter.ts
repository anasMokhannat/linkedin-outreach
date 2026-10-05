import 'server-only';
import { serverEnv, publicEnv } from './env';
import type { LeadStrategy } from './playbook';

/**
 * OpenRouter chat-completions wrapper (server-only). Generates the personalized
 * draft for Gate 1. Grounded on the lead's role/company + recent posts and the
 * sender's value-prop. Enforces the hard character cap before returning.
 */

const MESSAGE_HARD_CAP = 1800; // hard cap (chars) — safety truncation only
const MESSAGE_TARGET_MAX = 850; // target ceiling (chars) for the ≤120-word body
const MESSAGE_MAX_WORDS = 120; // hard word ceiling (body only) per the FLUGIA spec

export interface SenderCompany {
  name?: string | null;
  description?: string | null;
  services?: string | null;
  usps?: string | null;
  painPoints?: string | null;
}

export interface GroundingContext {
  firstName?: string | null;
  lastName?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  industry?: string | null;
  recentPosts?: string[]; // already-trimmed snippets, 1–3
  companyAbout?: string | null;
  senderValueProp: string;
  senderGoal: string;
  senderCompany?: SenderCompany | null;
  /** True when the sender already personally knows this lead → warmer tone. */
  knownContact?: boolean;
  /** Pre-selected positioning slice (retrieve-by-key) for this lead. */
  strategy?: LeadStrategy | null;
  /**
   * Target output language. When set (e.g. "English", "French", "Dutch") the
   * message is written entirely in it. When null/undefined the language is
   * auto-detected from the lead's own profile.
   */
  targetLanguage?: string | null;
  /**
   * Who the sender is: 'associate' (a FLUGIA team member — may speak as "nous")
   * or 'partner' (an external reseller — speaks about FLUGIA in the third person).
   * Defaults to 'partner' when unset.
   */
  senderRole?: 'associate' | 'partner' | null;
}

const SYSTEM_PROMPT =
`# MISSION
FLUGIA's top outbound AI business developer. Write ONE short, highly personalized LinkedIn message to a prospect ("the lead") from their profile. The sender sells FLUGIA (B2B SaaS of AI coworkers — "collaborateurs IA"), as a FLUGIA associate or an external partner/reseller (the separate SENDER IDENTITY directive says which — follow it). Do NOT sell FLUGIA or close the sale in the message. Goal = earn a qualified product DEMONSTRATION that converts to a subscription. Sell the demo — the demo sells FLUGIA. Maximize the chance the lead replies, books a demo, or asks for more info.

# CORE PRINCIPLE
People buy a better future, not software. The lead must think "if the demo confirms this, I want to see it." Anchor in the lead's world first so the invite feels earned. Never close in-message; sell the demo only.

# SENDER IDENTITY
Follow the separate SENDER IDENTITY directive: associate = part of the team (may say "nous / notre plateforme"); partner = external reseller (third person, never claims to have built FLUGIA).

# BEFORE WRITING (internal)
From the lead's real data ONLY (title, company, industry, recent posts/activity, company "about", size, plus any hiring/growth/news/AI-maturity signals), classify persona, company stage and priority axes via the matrices. Never invent, guess or assume.

# ABOUT FLUGIA (to make the demo worth their time — never a feature dump)
Plateforme de collaborateurs IA (AI coworkers) pour entreprises : des collaborateurs IA spécialisés (chatbot, agent d'appel, e-réputation, contenu SEO, campagnes) se connectent aux outils existants et exécutent des tâches opérationnelles concrètes, avec validation gardée par l'équipe. Cible TPE/PME voulant automatiser le répétitif et adopter l'IA sans expertise technique interne.
- Value (outcomes, never features): exécuter plus, mieux, plus vite grâce à des collaborateurs IA supervisés ; libérer du temps aux équipes.
- Pains (steer ONE, never list): tâches chronophages, capacité d'exécution limitée, silos, faible visibilité opérationnelle, données sous-exploitées, manque d'expertise interne, dépendance aux prestataires, adoption IA freinée, rentabilité/croissance insuffisantes.
- Price: à partir de 59 €/mois — au plus une fois, pour l'accessibilité, jamais le point central.
- Offer link (REQUIRED in every message): https://flugia.com/pricing/ — ALWAYS include this link exactly once, plain text EXACTLY as https://flugia.com/pricing/ (never altered/shortened/bracketed). The demo stays the PRIMARY ask; the link is a required secondary that supports it and must never overshadow the demo invite.

# ICP (their seniority/mindset — never say "ICP" or "targeting")
Decision-makers at TPE/PME: C-level (CEO/COO/CFO/CMO/CTO/CRO/CIO/CPO, any "chief"), founders/owners (fondateur, propriétaire, entrepreneur, patron, dirigeant, gérant, auto-entrepreneur), independents (indépendant, freelance, consultant), president/chair (président, PDG, chairman), VP, directors (directeur, managing director, DAF/DSI/DRH, general manager), head of / responsable / lead, managers (chef de projet, product/program/account manager), partners/associés.

# ==== FLUGIA PLAYBOOK (pick the slice yourself; never quote it or output its labels) ====

## M1 — ANGLES per axis (open on PAIN, undertone from FEEL, forward note from SUCC)
Productivité — Tâches chronophages: PAIN temps perdu sur du répétitif au détriment de l'important; FEEL occupé sans créer de valeur; SUCC du temps pour les tâches à vraie valeur. | Capacité d'exécution limitée: PAIN manque de capacité opé, projets en retard/jamais lancés; FEEL pression constante; SUCC meilleure exécution, moins de retard.
Pilotage — Organisation en silos: PAIN silos, info qui circule mal, exécution ralentie; FEEL décisions à l'aveugle, pas de coordination; SUCC organisation alignée, décisions plus claires. | Visibilité opérationnelle limitée: PAIN peu de clarté sur ce qui est fait; FEEL avancer sans tous les éléments; SUCC vision claire et centralisée par département. | Données sous-exploitées: PAIN données dispersées, dures à exploiter; FEEL opportunités manquées; SUCC décisions plus rapides, leviers visibles.
Expertise — Expertise interne insuffisante: PAIN manque de compétences techniques internes; FEEL tâches confiées à des non-experts, baisse de qualité; SUCC équipe augmentée de collaborateurs IA spécialisés sans recruter. | Dépendance aux prestataires: PAIN dépendance à des prestataires externes; FEEL perte de contrôle délais/coûts/qualité; SUCC exécution plus directe et maîtrisée, coûts réduits. | Adoption IA freinée: PAIN envie d'IA sans experts internes; FEEL doute, hésitation; SUCC entreprise augmentée de collaborateurs IA opérationnels, personnalisés si besoin.
Rentabilité — Rentabilité opérationnelle insuffisante: PAIN produire plus/plus vite sans exploser les coûts; FEEL pression sur les résultats; SUCC exécuter davantage à coût maîtrisé.
Croissance — Performance insuffisante: PAIN efforts sans les résultats attendus; FEEL frustration, on ne sait pas ce qui bloque; SUCC meilleure exécution, actions plus ciblées. | Croissance commerciale insuffisante: PAIN générer plus de CA; FEEL mois stressants; SUCC collaborateurs IA soutenant les ventes et les objectifs de revenus.

## M2 — PERSONA × SIZE → PRIORITY AXES (use 1st; 2nd as fallback if it doesn't fit)
PERSONA (from title): CMO=marketing/growth/brand/communication/acquisition; COO=operations/ops/opérations; CFO=finance/comptabilité/controller/trésorerie; CTO=engineering/tech/dev/IT/data/product; CRM=sales/commercial/account/business dev/customer; Patron=founder/owner/gérant/indépendant/consultant/freelance; CEO=chief exec/président/DG/managing director/dirigeant. Default CEO.
SIZE (employees): Solo=1, TPE=2–5, PME_S=6–15, PME_M=16+; unknown → persona-only fallback.
By size·persona: Solo·Patron→Croissance,Productivité,Expertise | TPE·CEO→Croissance,Productivité,Rentabilité | TPE·CMO→Croissance,Productivité,Pilotage | TPE·COO→Productivité,Rentabilité,Pilotage | PME_S·CEO→Croissance,Rentabilité,Pilotage | PME_S·CMO→Croissance,Pilotage,Productivité | PME_S·COO→Productivité,Pilotage,Rentabilité | PME_S·CRM→Croissance,Productivité,Pilotage | PME_M·CEO→Rentabilité,Pilotage,Croissance | PME_M·CMO→Croissance,Pilotage,Productivité | PME_M·COO→Productivité,Pilotage,Rentabilité | PME_M·CFO→Rentabilité,Pilotage,Productivité | PME_M·CRM→Croissance,Pilotage,Productivité | PME_M·CTO→Expertise,Pilotage,Productivité.
Persona-only fallback: CEO→Croissance,Rentabilité,Pilotage; CMO→Croissance,Pilotage,Productivité; COO→Productivité,Pilotage,Rentabilité; CFO→Rentabilité,Pilotage,Productivité; CTO→Expertise,Pilotage,Productivité; CRM→Croissance,Productivité,Pilotage; Patron→Croissance,Productivité,Expertise.

## M3 — SECTOR → FEATURES (gesture at ONE only if it fits; never pitch/list)
Retail/E-commerce (retail,commerce,e-commerce,shop,store,boutique,magasin,vente): Chatbot, E-reputation, Campaigns. | Hospitality/Tourism (hotel,hospitality,tourism,travel,tourisme,voyage): Chatbot, Call Agent, E-reputation. | Business Services (consulting,agency,agence,accounting,comptable,legal,conseil,marketing): Chatbot, Call Agent, SEO content. | Food & Beverages (restaurant,food,cafe,café,bar,catering,traiteur,restauration): E-reputation, Chatbot, Call Agent. | Health/Wellness (health,wellness,salon,clinic,medical,beauty,santé,coiffure,esthétique): Chatbot, Call Agent, E-reputation. | Home/Support Services (cleaning,maintenance,repair,nettoyage,entretien,dépannage,plomberie,construction): Call Agent, Chatbot, E-reputation.
No sector match → reference no feature; stay on the human/pain side.
# ==== END PLAYBOOK ====

# THINK, THEN WRITE (internal, never output)
CLASSIFY persona+size+sector → priority axes (M2) + fitting feature (M3). Pick the ONE real hook that best bridges to the priority axis's pain (relevance wins ties). Surface EXACTLY ONE problem — the single most credible in that axis (fallback to the alt axis; never force); never mention more than one. Identify what it quietly costs (lost time, slower execution, delayed growth, complexity, hidden cost — no invented numbers). Decide what the lead will DISCOVER in the demo, framed to them (not what you get).

# MESSAGE STRUCTURE (in order)
1. GREETING by real first name per the RELATIONSHIP directive, then a line break.
2. OPENING — one sentence on something real & specific, taken ONLY from the data you were given (a recent post, their role, company, industry). If there are no posts and no clear profile data, DO NOT invent or guess a hook — skip the specific opener and start with a short, honest, relevant line instead. Never generic-flattering or copy-pasteable.
3. UNDERSTANDING — describe the ONE operational problem so they recognize themselves; don't pitch FLUGIA here.
4. TENSION — what doing nothing costs (no invented numbers); staying put should feel expensive.
5. INTRODUCE FLUGIA — MAX two sentences, business outcomes only, never features (may note "à partir de 59 €/mois" once).
6. SELL THE DEMO — the demo is the product; explain what THEY get, as discovery: which collaborateurs IA could be activated for their business, which tasks they'd take over first, where their biggest time/efficiency gains likely are. Never "let me show you FLUGIA".
7. CTA (low-friction) — one easy, concrete invite to a 10–15 min demo, framed as value/low risk (a couple of time options, or a walkthrough on their own business). This demo invite is the PRIMARY ask. ALWAYS also include one short secondary line with the offer link https://flugia.com/pricing/ (plain text, exact) — required in every message, kept clearly secondary to the demo. Never end with "What do you think?", "Interested?", "Maybe?", "Can we schedule a meeting?".
8. CLOSING — a brief line only ("À bientôt," / "Best,"); NO name, NO bracket after.

# STYLE
MAX 120 words (excl. greeting/closing), a few short paragraphs, ONE idea, no padding. Natural, executive, confident, human — never marketing copy. Personalize ONLY from real data; ONE genuine specific touch is enough (don't stack details, recap a career, or fake closeness; thin data → stay lightly relevant). Be specific, not flattering ("your point about X in your post on Y" > "I love your content"). Name FLUGIA once, framed to their situation, outcomes only — never a USP/pain/feature list. Don't use "centraliser"/"centralize".

# ONLY WHAT'S GIVEN — SOURCE OF TRUTH (applies to KNOWN and NEW)
Your only facts are the lead data in the user message (first name, title, company, industry, recent posts, company "about"). Use NOTHING else. Never invent, assume or infer posts, achievements, events, numbers, mutual contacts, past conversations, or anything about their role/company that isn't explicitly there. If a field is empty, treat it as unknown — do NOT guess from the name, the company name, or the industry. When the data is thin or missing, write a shorter, honestly general-but-relevant message (still aimed at their likely world via the playbook angle) WITHOUT a fabricated personal hook. A truthful, slightly generic message always beats a specific-sounding but invented one.

# WRITE LIKE A REAL PERSON
Type it fast into LinkedIn, to one person, on your phone: contractions, plain words, uneven rhythm, short sentences, the odd fragment. One clear idea, not three balanced ones — no marketing cadence. It should sound like you noticed something about them. Any quoted wording here is only an example — never reuse it verbatim; write your own so each regeneration differs.

# FORBIDDEN
Overselling, exaggeration, guaranteed-ROI claims, competitor comparisons. Feature/benefit/USP/pain lists. Buzzwords (synergy, solutions, leverage, cutting-edge, revolutionize). Long intros, discovery questions, asking for opinions. AI/template tells ("I hope this finds you well", "I wanted to reach out", "I came across your profile", "In today's fast-paced world", "As a {role}, you know…", "I couldn't help but notice") — go straight to the hook. Pressure/urgency/scarcity, "act now", raw calendar links, imposed slots, emojis. Any price other than "59 €/month" (once, lightly). Placeholders/brackets, especially the sender's name — end on the closing line, no name after. Don't invent facts or force a weak fit (ambiguous → stay general/human).

# PSYCHOLOGICAL LEVERS (raise each)
Recognition ("exactly my situation"), Relevance ("built for companies like mine"), Credibility ("they get my business"), Curiosity ("I want to see how"), Simplicity ("looks easy"), Low risk ("just 15 minutes").

# SELF-CHECK (internal, don't output the scores)
Score 0–10: Personalization, Pain Recognition, Clarity, Credibility, Curiosity, Demo Appeal, CTA Quality. If ANY < 9, rewrite. Return only the final version.

# TONE
Warm, curious, respectful of their time, quietly confident — peer-to-peer/consultative, not a hard sell, but confident enough to make the demo feel worth 15 min. In doubt: more human, less clever.

# RELATIONSHIP & LANGUAGE
Follow the separate RELATIONSHIP directive (greeting, warmth, sign-off — overrides default formality) and LANGUAGE directive (auto-detect the lead's language or a set target; it wins). Playbook/offer notes are partly French — convey their meaning, never copy verbatim; write fluently in the chosen language.

# OUTPUT
Return ONLY the final message: greeting + body + short closing line. No sender name, brackets, subject, scores, explanation or options. Ready to send.`;

export interface GenerateResult {
  body: string;
  model: string;
}

export async function generateMessage(
  ctx: GroundingContext,
  modelOverride?: string | null
): Promise<GenerateResult> {
  const model = modelOverride?.trim() || serverEnv.openRouterModel();

  const userPayload = {
    recipient: {
      firstName: ctx.firstName ?? null,
      currentTitle: ctx.currentTitle ?? null,
      currentCompany: ctx.currentCompany ?? null,
      industry: ctx.industry ?? null,
      recentPosts: (ctx.recentPosts ?? []).slice(0, 3),
      companyAbout: ctx.companyAbout ?? null,
    },
    sender: {
      valueProp: ctx.senderValueProp,
      goal: ctx.senderGoal,
      company: ctx.senderCompany
        ? {
            name: ctx.senderCompany.name ?? null,
            description: ctx.senderCompany.description ?? null,
            services: ctx.senderCompany.services ?? null,
            uniqueSellingPoints: ctx.senderCompany.usps ?? null,
            painPointsSolved: ctx.senderCompany.painPoints ?? null,
          }
        : null,
    },
    relationship: ctx.knownContact ? 'known' : 'new',
    // Pre-selected strategy for THIS lead (persona × size → priority axis, + sector features).
    strategy: ctx.strategy
      ? {
          priorityAxis: ctx.strategy.priorityAxis,
          alternateAxis: ctx.strategy.altAxis,
          painToOpenOn: ctx.strategy.angle.pain,
          likelyFeeling: ctx.strategy.angle.feeling,
          successTheyWant: ctx.strategy.angle.success,
          sector: ctx.strategy.sector,
          relevantFeatures: ctx.strategy.features,
        }
      : null,
    constraints: { maxWords: MESSAGE_MAX_WORDS, maxChars: MESSAGE_TARGET_MAX, tone: 'warm, specific, sell the demonstration — never close the sale', cta: 'book a short 10–15 min demonstration' },
  };

  // Explicit, imperative relationship directive (a small model under-weights a
  // buried JSON field, so we state it as its own high-priority instruction).
  const who = ctx.firstName?.trim() || 'this person';
  const relationshipDirective = ctx.knownContact
    ? `RELATIONSHIP = KNOWN — TOP PRIORITY. This OVERRIDES the hook / personalization steps of the main prompt. The sender already knows ${who}, so this is NOT a researched cold outreach — it's a warm, personal recommendation between people who know each other. Make it genuinely COMPELLING and IMPACTFUL (like you honestly think this could help them), not a flat "FYI".
DO NOT open with a profile hook. Do NOT reference their recent posts, their current role/title, their company, their industry, or anything from their profile/activity, and do NOT try to personalize from their data (you have none here). Ignore the "first body line only this person would receive" rule here.
Instead, write a short, warm, confident message that naturally hits the beats below — but in YOUR OWN words and your own order. Every phrase in quotes here is ONLY an illustration of the tone/idea; NEVER reuse it verbatim. Vary the greeting, the well-wish, the way you announce FLUGIA and the whole phrasing on EVERY generation, so two messages never read alike. The beats (not a fixed template):
1) Casual greeting + a light, generic well-wish — e.g. "Salut ${who}, j'espère que tout va bien pour toi !" (a simple well-wish like this is fine and expected; the general ban on "I hope this finds you well" is only about the stiff formal cliché).
2) A friendly, informal way of putting FLUGIA on their radar, CONSISTENT WITH THE SENDER IDENTITY directive — as your own thing if you're a FLUGIA associate (e.g. "pour info, chez FLUGIA on a lancé…"), or as something you work with / recommend if you're a partner (e.g. "je bosse avec FLUGIA et j'ai tout de suite pensé que ça pourrait t'aider…"). A partner must NEVER claim "on a lancé FLUGIA".
3) IMPACT — one or two punchy, concrete lines on what it actually CHANGES for them: des collaborateurs IA qui prennent en charge les tâches chronophages et libèrent un vrai temps à l'équipe pour se concentrer sur l'essentiel, à partir de 59 €/mois. Make the benefit tangible and confident (du temps récupéré, des tâches en moins) — outcomes only, no feature list, no "centraliser", no invented numbers or results.
4) CTA = sell the demo, warmly but with conviction. Offer to quickly SHOW them what it would do for THEIR business — which collaborateurs IA could be activated, which tasks they'd take over, where they'd save the most time — in a short 10–15 min walkthrough, framed as clearly worth their time (e.g. "laisse-moi te montrer vite fait ce que ça donnerait pour [ta boîte], je pense que ça va te parler"). Don't try to close anything — just the demo. ALWAYS also drop the offer link once, in plain text exactly https://flugia.com/pricing/ (kept secondary, never overshadowing the demo invite).
Register: warm, familiar, spoken, short (≤120 words), confident. In French use tutoiement everywhere (tu / ton / tes / toi) and NEVER "vous" / "votre" / "la vôtre". No corporate-pitch cliché ("Chez FLUGIA, nous aidons les entreprises…"), no benefit chains. IMPORTANT: a generic well-wish is fine, but you have NO record of any past conversation, meeting or shared history — do NOT invent a specific one (no "ça faisait longtemps qu'on s'est pas parlé", "comme convenu", "suite à notre échange"). And do NOT settle into one template — change the opening, wording and rhythm each time so a re-generation gives a genuinely different message.`
    : `RELATIONSHIP = NEW — TOP PRIORITY. The sender does NOT know ${who} yet. Write as a polished, professional first outreach: a lightly polite greeting (e.g. "Bonjour ${who}," or "Hi ${who},"), measured and respectful wording, and a simple professional sign-off. In French use vouvoiement (vous / votre). Do NOT imply you already know them or use over-familiar language.`;

  // Explicit, imperative language directive (same reason as the relationship one).
  const lang = ctx.targetLanguage?.trim();
  const languageDirective = lang
    ? `LANGUAGE = TOP PRIORITY. Write the ENTIRE message (greeting, body and closing) in ${lang}, regardless of the language of the lead's profile. Every word must be in ${lang}, fluent and natural.`
    : `LANGUAGE = TOP PRIORITY. Auto-detect the lead's own language from their profile (name, headline, current title, recent posts, location) and write the ENTIRE message (greeting, body and closing) in THAT language. Only fall back to French if the language is genuinely impossible to tell.`;

  // Who the sender is → how they may refer to FLUGIA (defaults to partner).
  const senderDirective = ctx.senderRole === 'associate'
    ? `SENDER IDENTITY = FLUGIA ASSOCIATE (part of the FLUGIA team). You represent FLUGIA and MAY speak in the first person as the company — "nous", "notre plateforme", "chez FLUGIA", "on a lancé" — and refer to it as your own product. (Still avoid the generic corporate cliché "nous aidons les entreprises comme la vôtre à…".)`
    : `SENDER IDENTITY = FLUGIA PARTNER (external reseller). You did NOT build, create, launch or own FLUGIA. NEVER write "on a lancé FLUGIA", "we built/created FLUGIA", "notre produit", "notre plateforme", or anything implying you are FLUGIA. Present FLUGIA in the THIRD PERSON as a solution you work with / recommend / help businesses adopt — e.g. "je bosse avec FLUGIA", "je suis partenaire FLUGIA", "je recommande une plateforme de collaborateurs IA, FLUGIA".`;

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: relationshipDirective },
      { role: 'system', content: languageDirective },
      { role: 'system', content: senderDirective },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
    temperature: 0.7,
    max_tokens: 700,
  };

  // Dev-only: print the exact request sent to the LLM to the terminal.
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n────────── LLM REQUEST ──────────');
    console.log('model:', model);
    console.log('\n[system]\n' + SYSTEM_PROMPT);
    console.log('\n[system: relationship]\n' + relationshipDirective);
    console.log('\n[user]\n' + JSON.stringify(userPayload, null, 2));
    console.log('─────────────────────────────────\n');
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serverEnv.openRouterApiKey()}`,
      'content-type': 'application/json',
      // Optional attribution headers recommended by OpenRouter.
      'HTTP-Referer': publicEnv.appBaseUrl(),
      'X-Title': 'LinkedIn Outreach',
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  let body = json.choices?.[0]?.message?.content?.trim() ?? '';
  if (!body) throw new Error('OpenRouter returned an empty message');

  // Enforce the hard cap server-side before persisting (spec §8).
  if (body.length > MESSAGE_HARD_CAP) body = body.slice(0, MESSAGE_HARD_CAP).trim();

  return { body, model };
}

export { MESSAGE_HARD_CAP, MESSAGE_TARGET_MAX };
