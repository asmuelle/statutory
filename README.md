# Statutory

> An UpToDate for solo professionals: a living rulebook of the exact statutes, agency rules, and rates that govern your practice — by state and specialty — with deltas pushed when something you rely on changes, plus a ready-to-send client-alert draft that turns the subscription into billable output.

**Category:** LLM wiki / auto-research (living documents + delta alerts, à la Karpathy) · 

## Concept

An UpToDate for solo professionals: a living rulebook of the exact statutes, agency rules, and rates that govern your practice — by state and specialty — with deltas pushed when something you rely on changes, plus a ready-to-send client-alert draft that turns the subscription into billable output.

## Target User

Solo and small-firm employment lawyers, CPAs and tax preparers, HR consultants, real-estate brokers — licensed professionals who already personally pay for currency (CLE ~$480/yr, Westlaw $78-400/mo, UpToDate $579/yr) and for whom one missed regulatory change is a malpractice event. Distinct buyer from RegDelta's compliance teams: the individual professional pays from their own pocket because the output is billable.

## Auto-Research Mechanic (the living document + delta engine)

Onboarding builds a practice profile (jurisdictions, practice areas, client types); the agent assembles a living 'your rules' wiki — each section a topic ('CA meal-break rules', 'IRS reasonable-comp guidance for S-corps') pinned to primary sources via the Federal Register API, state register feeds, agency RSS, and CourtListener. Daily diff monitoring of those feeds; cheap-model triage maps each change to affected sections; frontier synthesis writes the delta with effective dates: 'effective July 1 the exempt-salary threshold rises to $X; affects 3 sections of your rulebook; client-alert draft attached.' Every section versioned with effective-date history and exact statute/rule citations, span-verified — no paraphrase drift. The practice-profile-to-rules mapping improves with every user confirmation and correction.

## Product Surface

Web app for the living rulebook plus email and Slack delta alerts (solo pros live in inbox), with Word/PDF export of client-alert drafts — the artifact that converts the subscription into billable client communication.

## Why Now (2026 timing)

14,000+ regulatory updates/year against a $1.1B RCM market priced enterprise-only; the demand research calls licensed professionals the clearest underserved currency-buyers — they already prove WTP via CLE, Westlaw, and UpToDate subscriptions; primary government feeds are open and crawl-friendly, immune to the 2026 publisher-blocking wall.

## Proposed Monetization

$39/mo per seat per jurisdiction-bundle ($468/yr — precisely the CLE/UpToDate-proven price point), $89/mo small-firm tier (3 seats, shared rulebook), additional jurisdictions $15/mo. One billable client alert or one avoided missed-update covers a year.

## Competition & Gap

Westlaw/Lexis (pull-based search, no personalized living digest), Thomson Reuters Regulatory Intelligence and Compliance.ai (enterprise, no self-serve), free agency newsletters (unscoped firehose), generic ChatGPT (cannot guarantee statute-level citation fidelity or effective-date tracking — and professionals cannot bill on unverifiable output).

## Claimed Moat

(1) Per-jurisdiction primary-source plumbing — fifty state registers and hundreds of agency feeds — is unglamorous accumulation no horizontal replicates for a feature. (2) The practice-profile-to-rules mapping is per-user state that compounds with corrections. (3) The trust bar is binary in this market — cite the exact section with effective date or be professionally unusable — and generic deep research demonstrably fails it (29-86% citation mutation). (4) Client-alert drafts tie the product to the professional's revenue, not just their reading.

---

## Comparables

- Westlaw (Thomson Reuters): $78-381/mo flat rates; Classic single-state $132.80/mo, Edge from $194.40/mo — pull-based search, no personalized change push
- UpToDate (Wolters Kluwer): $579/yr individual clinician subscription, group tiers for 2-19 seats — the proven 'living reference' model Statutory clones
- CCH AnswerConnect (Wolters Kluwer): solo tier $1,498/yr via CPA.com; Essentials $755, Federal $1,510, Federal Pro $4,500/yr
- Thomson Reuters Checkpoint Edge: $3,000-5,000/user/yr, typically bundled with other TR products
- Paxton AI: $199/mo Professional, up to $500/mo Individual plans, self-serve, explicitly targeting solo and small law firms
- Compliance.ai / enterprise AI regtech: ~$15,000-25,000/user/yr multi-year contracts, BFSI-focused, no self-serve tier
- SixFifty: auto-updating state-specific HR/employment policies with law-change alerts; quote-based pricing by employee count and states — closest functional analog in the employment vertical
- Regulatory change management software market overall: $1.2-2.5B (2023-24), 12-16% CAGR, projected $3.4-8.9B by early 2030s

## Adversarial Review — strongest case AGAINST (verdict: weakened)

The pitch survives the attack it prepared for (frontier labs) and loses the attacks it ignored. (1) WRONG VILLAIN: ChatGPT scheduled tasks + deep-research-with-trusted-source-restriction and Perplexity scheduled searches already exist as $20/mo features, but they are a casual substitute, not the threat — the real killers are the vertical incumbents the deck omits. Mitratech Mineral already monitors 3,000+ federal/state law changes with tailored proactive alerts for SMBs and distributes through payroll providers, insurers, and CPA firms; SixFifty already does 'laws changed, here are your auto-updated documents' for the employment/HR wedge — that IS the living-rulebook-plus-billable-artifact loop, shipped, with Wilson Sonsini's brand behind it. Thomson Reuters Checkpoint Edge and Westlaw's statute-change/KeyCite alerts also falsify the claim that incumbents are 'pull-based search with no personalized digest.' The moat claims are mostly imagined: practice-profile mapping is rebuildable in a weekend of onboarding questions (SixFifty's questionnaire does exactly this), and 'no horizontal will do 50-state plumbing' is true but irrelevant when three funded verticals already did it. The only real moat candidates are state-register plumbing depth and distribution — and the candidate has neither yet, while incumbents own the channels (bar associations, payroll/insurance resellers) that make solo-pro CAC survivable. (2) TRUST IS STRUCTURALLY UNWINNABLE AS PITCHED: the product's stated bar is binary ('cite exactly or be professionally unusable') and its core promise is completeness ('one missed change is a malpractice event'). Span-verification can guarantee a quoted sentence exists; it cannot guarantee you didn't MISS a change (coverage is unprovable — local ordinances, case law reinterpreting statutes like Brinker on CA meal breaks, IRS notices, sub-regulatory guidance), and it cannot guarantee the synthesized EFFECT of an amendment is right. Stanford RegLab found 33% hallucination in Westlaw AI and ~17% in Lexis+ AI — tools sitting on the canonical corpus with citation grounding. The fix is an attorney-editor review layer (the actual UpToDate model — thousands of paid physician editors), which a small team can only afford for a narrow jurisdiction set, shrinking the TAM the pricing math depends on. A missed signal here doesn't just churn the user; one publicized miss destroys the category promise, and 'not legal advice, verify everything' disclaimers (required to manage liability and UPL exposure for the non-lawyer segments) directly negate the reason to pay. (3) DATA ACCESS is the one front that holds: Federal Register API, eCFR, GovInfo, CourtListener are free and open; no paywall/Cloudflare problem. But ~half of state registers are weekly PDF dumps with no feeds, so '50 states' is an 18-month parsing grind, not a launch feature — expect to ship federal + 8-12 states and quietly under-deliver the headline promise. (4) CHURN: delta cadence in a single jurisdiction-specialty is lumpy; a solo tax preparer in a quiet state gets months of 'nothing relevant changed' against a $39 charge, and tax pros are seasonal. The billable-client-alert hook is the best retention idea in the deck, but SixFifty already monetizes it. Net: not killed — WTP is proven, COGS is genuinely low, and generic deep research truly cannot be billed against — but the wedge is contested by incumbents with distribution, and the completeness liability means the product must either hire editors (UpToDate cost structure) or soften the promise (commodity newsletter).

## Tech Stack & Unit Economics

SOURCES: Federal Register API + eCFR XML (free, excellent diffability), GovInfo, Regulations.gov API, OpenStates API for state legislation, CourtListener/RECAP (free) for case law, agency RSS; state registers via Playwright scrapers + PDF pipeline (marker/Textract/Reducto-class) since ~25 states publish PDF-only weekly bulletins. CHANGE DETECTION: stable section-hash diffing of eCFR/statute XML; PDF registers parsed then diffed against stored canonical text — never re-summarize from scratch. TRIAGE: Haiku 4.5 / Gemini Flash-class model maps each detected change against user practice profiles (jurisdiction × topic taxonomy), ~$0.001/change-user pair. SYNTHESIS: Sonnet 4.6-class writes deltas with hard span-verification (every quoted span must string-match retrieved source text; effective dates extracted by model + regex cross-check; publication blocked on any verification failure and routed to human queue). KEY ECONOMIC TRICK: deltas are authored once per jurisdiction-topic and fanned out to all subscribed users — synthesis cost is shared, not per-user. HUMAN LAYER (non-optional for this trust bar): staff-attorney review queue over every published delta; ~1-2 reviewers covers federal + 10 states in one vertical. ORCHESTRATION: Temporal or SQS+workers for scheduled crawls (daily federal, weekly state registers); Postgres + pgvector for versioned rulebook sections with effective-date history. SURFACE: Next.js web app, Postmark/Resend email, Slack webhooks, docx-templater for client-alert exports. UNIT ECONOMICS: shared crawl/parse infra ~$1-3k/mo; per-user inference (profile-scoped triage + fan-out share of synthesis + initial rulebook build amortized) ~$3-8/user/mo against $39/mo → 80%+ gross margin on COGS alone. The real cost is fixed editorial: ~$25-40k/mo for attorney reviewers at federal+10-state coverage → breakeven ~900-1,200 seats; viable economics at 3k+ seats, but CAC to solo professionals (bar-association sponsorships, CPA-society channels, content SEO) is the binding constraint, not inference cost.

