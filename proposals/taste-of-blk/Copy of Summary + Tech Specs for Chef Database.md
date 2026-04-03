### **Chef Database discussion (building a custom solution):**

* Need: Taste of BLK wants an internal chef database to match clients to chefs by menu, cuisine, service style, guest counts, budget, dietary needs, availability, staffing/equipment requirements, and other qualifications.  
* Desired workflow: client submits request (cuisine, event type, guest count, budget, menu requests). Taste of BLK remains the liaison/agent — the system should surface matching chefs for the team to review and present options to the client (rather than exposing full chef contact info publicly).  
* Jalen’s proposal and capabilities: he said he can build the database and matching flow, including the option to accept payments on the website and route a commission (e.g., 10%) automatically to Taste of BLK if desired. He noted a common risk: clients pursuing chefs directly outside the system, so suggested keeping full contact details internal and preserving Taste of BLK as the intermediary.  
* Next steps discussed: Jessica aims for a summer (June–July) rollout timeline; she will share the existing culinary partner intake form and additional chef responses. Jasmine will act as the internal point person for requirements. Jalen requested details on timeline and budget and offered onboarding/support calls as needed.

### **Outcomes / Action items (implied or stated):**

  1\) Jalen to: 1\) enable reply-to email option; 2\) ensure template variables include all market fields (parking, day-of instructions, etc.); 3\) provide list of available email/template variables; 4\) follow up on feasibility, timeline and budget for building the Chef Database and matching workflow. (Jalen shared his phone: 919-614-0457.)

  2\) Taste of BLK to: share the chef intake Google Form and chef responses with Jalen; confirm requirements (fields, matching rules, desired UI for internal use); align on timeline and budget (target: June–July rollout).

## Technical Spec — Chef Database

### **Goal**

Provide an internal chef directory \+ matching workflow so Taste of BLK staff can quickly find and recommend chefs for client requests while preserving Taste of BLK as the intermediary.

### **Primary Users**

Internal: Taste of BLK staff (admin, booker/liaison, events lead)

Read-only (optional): invited partners/stakeholders

### **Core Data Model / Fields**

* Chef Profile (stored, private to staff)  
  * Chef ID (internal)   
  * Display name / Business name  
  * Contact (email, phone) — hidden from public, visible to staff only  
  * Short bio / specialties  
  * Cuisine types (multi-select tags)  
  * Signature dishes / sample menu items (text \+ price-per-person ranges)  
  * Service styles (plated / buffet / grazing / passed apps / food truck / catering-on-site)  
  * Typical capacity ranges (min, max guests)  
  * Staffing requirements (chef only, requires servers, preferred staff count)  
  * Equipment needs (stove, fryer, oven, grill, power, tent, etc.)  
  * Dietary accommodations (vegan, GF, halal, kosher, allergies) — tags  
  * Pricing model (per guest, flat fee, packages) \+ sample rates / quote history  
  * Availability calendar or general availability notes  
  * Geographic service area / travel constraints  
  * Lead time required (days/weeks notice)  
  * Portfolio (photos, PDF menus) and references  
  * Contract status / paperwork (W9, insurance) — boolean/attachments  
  * Internal notes / reliability score / past event feedback  
* Client Request (input form)  
  * Request ID  
  * Client contact \+ event date/time  
  * Event type (private dinner, cookout, wedding, corporate, festival)  
  * Guest count  
  * Budget (total or $/guest) and willingness to negotiate  
  * Desired cuisine / menu examples  
  * Service style preferred  
  * Dietary restrictions / special requests  
  * Venue constraints (on-site kitchen? power? indoor/outdoor?)  
  * Priority (high/normal) and timeline

### **Matching Rules / Logic**

* Primary filter sequence (fast pass): availability on date → capacity fits guest count → service style match → cuisine tag match → geography/travel constraints → lead time OK → budget compatibility (chef’s min ≤ client budget) → equipment constraints compatible.  
* Scoring: assign weighted score per field (example weights: availability 30%, capacity 20%, service style 15%, cuisine match 15%, budget match 10%, equipment/venue fit 10%). Return top N (3–5) chefs.  
* Fallback rules: if \<3 matches, relax budget constraints first, then cuisine specificity, then allow chefs with partial availability (requires staff confirmation).  
* Manual override: staff can add/remove filters and manually include chefs; staff finalizes list before client presentation.  
* Audit trail: store matching snapshot \+ scores and staff actions for each request.

### **UI / Workflow (internal)**

1. Staff opens “New Client Request” form (or imports client request).   
2. System auto-suggests top 3–5 chefs with scores and match reasons (e.g., "capacity matches", "cuisine \+ budget within 10%").  
3. Staff reviews suggestions, inspects profiles, optionally toggles filters or requests updated quotes from selected chefs via templated email.  
4. Staff presents 1–3 curated options to client (email / PDF), schedules consult, handles booking.  
5. When a chef is selected, staff records booking, creates contract record and triggers payment flow if applicable.

### **Access Control**

* Role-based access: Admin (full read/write), Booker (create requests, view/edit chef profiles, contact chefs), Viewer (read-only internal summary), External (optional limited-view link to curated chef summary with no contact details).  
* Sensitive data (chef direct contact, contract documents, bank details) visible only to Admin \+ Booker.  
* Audit logs for all profile edits, matches generated, and booking actions.

### **Payment & Commission Flow (options)**

Option A — Internal referral \+ off-platform payments (recommended initial):

Taste of BLK remains intermediary; bookings invoiced by Taste of BLK; payments collected by Taste of BLK (Stripe account) and payouts to chefs as manual/process via bank transfer. System stores invoice and payout records. Commission applied when invoicing (e.g., 10%).

Option B — On-platform payments (future):

Integrate Stripe/Payments so clients pay on site; platform splits payment (application of commission) or credits Taste of BLK automatically; chef payout scheduled (via Stripe Connect) after aggregation (e.g., every 2 weeks). Requires chefs to onboard Stripe Connect and accept terms.

Security/PCI notes: use Stripe for card processing; never store raw card data.

### **Integrations**

* Optional: sync with Google Calendar / availability calendar  
* Stripe (payments, Connect) for Option B  
* File storage (S3 or equivalent) for contracts/menus/photos  
* Email templating (for quote requests, confirmations)

### **Data Governance & Privacy**

Chef consent for storing PII; limit public exposure of direct contact details

Retention policy for client requests and invoices (e.g., 7 years for records)

### **Estimated Timeline & Phases (MVP \-\> v1)**

Assumptions: small roster (50–150 chefs), internal-only UI, no full payment splitting for MVP.

* Week 0: Requirements & intake (confirm fields, weight priorities, sample chef data) — 1 week  
* Week 1–3: Backend \+ data model, admin auth/roles, chef profile CRUD — 2–3 weeks  
* Week 3–5: Matching engine \+ scoring rules, request intake form, basic UI for suggestions — 2–3 weeks  
* Week 5–6: Booking workflow, contract/attachments, audit logs, email templates — 1–2 weeks  
* Week 6–7: QA, sample data import, staff training, minor adjustments — 1–2 weeks  
* Week 8: Launch MVP (internal rollout)

Total MVP estimate: 6–8 weeks.

Optional add-ons (post‑MVP)

* Stripe Connect payouts and automated commission splits (adds 2–4 weeks \+ compliance)  
* Availability calendar sync, public-facing client intake portal, analytics dashboard, chef self-service portal to update profiles.

### **Assumptions & Risks**

* Chefs must provide accurate pricing & availability for good matches  
* Protecting intermediary revenue requires staff control over chef contact exposure  
* On-platform payments require chef onboarding to payment provider and additional compliance work

