# Auto Expert Demo — Messenger, Website Chat & CRM MVP Analysis

Internal reference for client conversations and scoping: used-car buy/sell operation, after-hours leads, Facebook Messenger (and likely website), integration with **their existing CRM**, and the client’s need for **control** so leads are not lost if bot and CRM are poorly connected.

---

## 1. What you are really building

This is not only “a bot.” It is a **lead capture + qualification + handoff system** with:

- **Surfaces:** Messenger, website (and possibly WhatsApp later).
- **System of record:** Their existing CRM.
- **Human safety net:** When automation is wrong, unclear, or unavailable.

The client’s fear — *leads lost if CRM and bot are badly connected* — is valid. The product answer is **reliability by design**:

- Every meaningful interaction **creates or updates** a CRM record.
- **Real-time notifications** to the team where appropriate.
- **Fallback** (form, email, phone, “talk to a human”) always available.

---

## 2. Types of solutions that match this profile

Think in **layers**, not one magic vendor.

### 2.1 Messenger-first automation (rules + broadcasts)

**Examples:** ManyChat, Chatfuel, similar platforms.

- **Strengths:** Facebook/Instagram, flows, tags, quick replies; connect to other tools via Zapier/Make or webhooks. Good for a **fast MVP** and predictable paths (buy / sell / trade / appointment).
- **Limits:** Open-ended AI on every message needs **guardrails**; not always the right fit for deep LLM-only experiences without careful design.

### 2.2 Website + omnichannel chat with CRM-oriented products

**Examples:** Intercom, Drift, Tidio, Crisp, and similar.

- **Strengths:** Website widget; often Messenger or integrations; **CRM sync** or strong webhook/Zapier story; unified inbox angles.
- **Use when:** Priority is **unified chat** and less Meta-specific growth automation.

### 2.3 Automotive-specific AI + CRM

Vendors in the **dealer / BDC** space emphasize **24/7 response**, **CRM enrichment**, and integrations with systems such as **Elead, VinSolutions, DriveCentric, DealerSocket** (and similar). Useful as **reference** for what “good” looks like in automotive; your MVP may still be smaller: Messenger + one CRM + simple qualification.

### 2.4 General “AI agents” with CRM connectors

Many **voice and chat agents** connect via **API**, native CRM apps, or **Zapier** (e.g. Salesforce, HubSpot, and others). For used cars, what matters is:

- **Structured fields** written to the CRM.
- **Idempotency** (avoid creating the same lead many times).
- **Escalation** to a human when needed.

### 2.5 Glue: Zapier, Make, n8n, custom webhooks

For many MVPs, the path is:

**Messenger (or bot host) → webhook / Zapier / Make → CRM**

Zapier and similar tools offer patterns such as **new Messenger message → create CRM contact** for several CRMs. Often the **fastest** path when their CRM is already on those platforms.

**Summary:** Start with **simple flows + reliable CRM writes + alerts**, then add **LLM** only where it helps (FAQ, summarization, soft qualification), not everywhere on day one.

---

## 3. Best-practice patterns (control, failure, after hours)

| Concern | What good looks like |
|--------|----------------------|
| **Lead loss** | Completed intents (contact details, buy/sell interest) **create or update** one CRM lead/contact; optional **duplicate merge** rules. |
| **After hours** | Same CRM behavior **24/7**; optional **SLA** or task for first human touch next business day. |
| **Bot fails** | Clear **“Talk to a human”** path; **phone/email** visible; optional **fallback form** that posts to CRM without relying on the bot. |
| **CRM sync failures** | **Retry queue** or dead-letter log; **admin notification** on integration errors. |
| **Control** | Client approves **scripts**, **data fields**, and **when** AI is used vs fixed buttons; ability to **pause** automation or use **notify-only** mode. |
| **Compliance** | **Consent** for messaging, **opt-out**, and handling of personal data per region (e.g. GDPR-style if EU). |

Industry material on **after-hours capture** stresses **speed-to-lead** (minutes, not next morning). CRM integration is how the **human team** gets speed when the bot only handles first touch.

---

## 4. Connecting to their **existing** CRM

### 4.1 Why this is the right approach

- Leads appear **alongside** other channels with the same stages and owners.
- **No second lead inbox** as the long-term truth; reporting stays consistent.
- **Control narrative:** CRM remains source of truth; the bot is the **front door**.

### 4.2 What drives feasibility

Integration depends on **which CRM** they use, not a generic “CRM integration.”

| Their CRM situation | Typical MVP path |
|---------------------|------------------|
| **On Zapier / Make** (or official integrations) with “create contact/lead/deal” | Fast: bot or middleware → Zapier/Make → CRM. |
| **Documented REST API + OAuth or API key** | Custom or low-code service posting JSON to their endpoints. |
| **Dealer / industry CRM** | Often **partner integrations**, **webhooks**, or **approved vendors** — need docs or IT/vendor contact. |
| **Legacy / bespoke / no API** | **Email-to-CRM**, **CSV**, or **manual** bridge — flag early; affects scope and pricing. |

### 4.3 What to ask because it is *their* CRM

Beyond “which CRM?”:

1. **Exact product name** (cloud vs on-prem if relevant).
2. **Who can grant integration access** — CRM admin + someone who knows **which object** new web/chat leads should create (lead vs contact vs deal).
3. **Whether they already use or can use Zapier/Make**.
4. **Required CRM fields** for a new lead and allowed **source** values for reporting.
5. **Duplicate rules** — merge into existing contact vs always new lead.
6. **API docs or integration partner** (some dealer CRMs require vendor-approved paths).

### 4.4 One sentence for the client

*We’ll connect the bot to the CRM you already use so every conversation creates or updates the same records your team works from; how we connect depends on what your system supports — API, Zapier, or a supported integration — which we confirm once we know the exact product.*

---

## 5. Discovery checklist — what to ask the client

Beyond **website URL** and **CRM name**, group questions so the meeting stays structured.

### 5.1 Business and operations

- **Languages** (e.g. Spanish-only, bilingual).
- **Business hours** and **who** owns Messenger/website leads (owner, salesperson, BDC).
- **Definition of a qualified lead** (e.g. phone + intent + area).
- **Traffic mix:** ads vs organic; **phone vs Messenger** vs WhatsApp share.
- **Inventory:** do they publish stock (URL, feed, or not)?
- **Buy/sell steps** the bot must never skip (appointments, trade-in, etc.).

### 5.2 CRM and tools

- **Exact CRM product** (and DMS tie-in if dealer stack).
- **Zapier/Make** usage or policy.
- **Technical contact** for API keys / OAuth if going beyond no-code.
- **Fields and pipeline** expectations; **lead source** values for “Messenger” / “Website chat.”
- **Duplicate handling** policy.

### 5.3 Content for the bot (“feeding” the bot)

- **FAQ:** top real questions (pricing, warranties, financing, pickup, paperwork).
- **Policies** to state **verbatim** (deposits, “we buy as-is,” service area, etc.).
- **Tone** and **one-sentence pitch** (“who we are”).
- **Boundaries:** what the bot must **not** promise (final price, legal/financing guarantees).
- **Handoff:** phone, WhatsApp Business, email for human escalation and fallback.

### 5.4 Facebook / Meta

- **Facebook Page** access (Business Manager roles).
- **Click-to-Messenger** ads or not (affects volume).
- Interest in **WhatsApp Business** (often same expectation as Messenger).

### 5.5 Legal and risk

- **Data controller** and **retention** expectations for chats.
- **Markets** (EU vs US, etc.) for privacy messaging.

### 5.6 Success metrics (definition of “done” for MVP)

Examples: leads/week from bot, % with phone, time to first human reply, handoff rate when user asks for a person.

---

## 6. How to address “control” explicitly

- **Human-in-the-loop** for sensitive steps (appointments, firm offers).
- **Pause automation** without losing the Page (manual-only mode).
- **Every lead in CRM** with transcript or summary where the CRM allows it.

Framing: **The CRM is the source of truth; the bot is a front door.**

---

## 7. Summary

- **Comparable solutions** span Messenger builders, omnichannel chat products, automotive/BDC stacks, generic AI agents with CRM connectors, and **Zapier/Make/webhooks** as glue.
- For an MVP, prioritize **reliable CRM writes, clear handoff, monitoring, and fallback** over maximal AI on day one.
- **Their existing CRM** is the right target; scope hinges on **API vs Zapier vs dealer-specific constraints**.
- Use the discovery checklist to collect **operations, CRM technical details, content, Meta access, legal context, and metrics**.

---

*Document generated for the Auto Expert chatbot demo project. Update as the client names their CRM and channels.*
