<!-- converted from CollectRx_Financial_Model.xlsx -->

## Sheet: Executive Summary
| CollectRx - Financial Planning Model |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Created: January 30, 2026 |  |  |  |  |  |
| BUSINESS OVERVIEW |  |  |  |  |  |
| Business Name: | CollectRx |  |  |  |  |
| Tagline: | The prescription for better collections |  |  |  |  |
| Business Model: | SaaS Platform for Dental Practices |  |  |  |  |
| Core Service: | Accounts Receivable Automation |  |  |  |  |
| Payment Infrastructure: | Stripe Connect (Platform Model) |  |  |  |  |
| Target Market: | Dental Practices (Starting with Small Practices) |  |  |  |  |
| KEY FINANCIAL METRICS (Year 1) |  |  |  |  |  |
| Metric | Conservative | Moderate | Aggressive |  |  |
| Monthly SaaS Price per Practice | $200 | $300 | $450 |  |  |
| Practices by Month 12 | 5 | 10 | 20 |  |  |
| Annual Recurring Revenue (ARR) | $12,000 | $36,000 | $108,000 |  |  |
| Monthly Operating Costs | $500 | $750 | $1,200 |  |  |
| Break-even Month | Month 3 | Month 2 | Month 2 |  |  |
| CRITICAL DECISIONS NEEDED |  |  |  |  |  |
| 1. PRICING STRATEGY |  |  |  |  |  |
|    - Monthly subscription fee: $200-$450/practice recommended |  |  |  |  |  |
|    - Current agreement: ~$200-300/month with first client |  |  |  |  |  |
|    - Consider tiered pricing as you scale |  |  |  |  |  |
| 2. STRIPE CONNECT SETUP |  |  |  |  |  |
|    - Choose fee payer model (practices pay their own vs platform pays) |  |  |  |  |  |
|    - Recommended: Practices pay Stripe fees (2.9% + $0.30 per transaction) |  |  |  |  |  |
|    - Platform charges application fee if needed (0-2% of transaction) |  |  |  |  |  |
| 3. TAX COMPLIANCE |  |  |  |  |  |
|    - Register for GST/HST once revenue exceeds $30,000 CAD/year |  |  |  |  |  |
|    - Ontario: Charge 13% HST on SaaS subscription fees |  |  |  |  |  |
|    - Set up quarterly/annual tax remittance schedule |  |  |  |  |  |
| 4. OPERATING COSTS TO TRACK |  |  |  |  |  |
|    - Hosting (Azure/AWS): ~$50-100/month |  |  |  |  |  |
|    - SendGrid (email service): ~$20-50/month |  |  |  |  |  |
|    - Stripe Connect fees: $2/active account/month |  |  |  |  |  |
|    - Domain, SSL, monitoring tools: ~$30-50/month |  |  |  |  |  |
## Sheet: Revenue Projections
| CollectRx - Revenue Projections (12 Months) |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRICING ASSUMPTIONS |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Scenario | Monthly Price/Practice | Setup Fee | Target by Month 12 |  |  |  |  |  |  |  |  |  |  |  |
| Conservative | $200 | $0 | 5 practices |  |  |  |  |  |  |  |  |  |  |  |
| Moderate | $300 | $0 | 10 practices |  |  |  |  |  |  |  |  |  |  |  |
| Aggressive | $450 | $99 | 20 practices |  |  |  |  |  |  |  |  |  |  |  |
| CONSERVATIVE SCENARIO ($200/month) |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Metric | Month 1 | Month 2 | Month 3 | Month 4 | Month 5 | Month 6 | Month 7 | Month 8 | Month 9 | Month 10 | Month 11 | Month 12 | TOTAL |  |
| Active Practices | 1 | 1 | 1 | 2 | 2 | 2 | 3 | 3 | 4 | 4 | 5 | 5 |  |  |
| Monthly Subscription Revenue |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Annual Recurring Revenue (ARR) |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
## Sheet: Operating Costs
| CollectRx - Monthly Operating Costs |  |  |  |  |
| --- | --- | --- | --- | --- |
| FIXED MONTHLY COSTS |  |  |  |  |
| Expense Category | Min Cost | Max Cost | Notes |  |
| Hosting (Azure/AWS) | 50 | 150 | Scales with usage |  |
| SendGrid (Email Service) | 20 | 100 | Based on email volume |  |
| Domain & SSL | 10 | 30 | Annual costs spread monthly |  |
| Monitoring Tools | 20 | 50 | Uptime monitoring, error tracking |  |
| Database Hosting | 25 | 75 | PostgreSQL/MySQL hosting |  |
| File Storage | 10 | 30 | S3 or Azure Blob |  |
| Security & Backups | 15 | 40 | Automated backups, security tools |  |
| TOTAL FIXED COSTS |  |  |  |  |
| VARIABLE COSTS (Per Practice) |  |  |  |  |
| Expense Category | Cost | Frequency | Notes |  |
| Stripe Connect Fee | 2 | Per active account/month | Only when practice has payouts |  |
| Customer Support Tools | 5 | Per practice/month | Helpdesk, chat support |  |
| Transaction Processing | Varies | Per transaction | Practice pays Stripe 2.9% + $0.30 |  |
| TOTAL MONTHLY OPERATING COSTS BY SCENARIO |  |  |  |  |
| Scenario | # Practices | Fixed Costs | Variable Costs | TOTAL |
| Conservative (5 practices) | 5 | 150 | 35 | 185 |
| Moderate (10 practices) | 10 | 200 | 70 | 270 |
| Aggressive (20 practices) | 20 | 350 | 140 | 490 |
## Sheet: Stripe Fees & Pricing
| CollectRx - Stripe Connect Fee Structure |  |  |  |  |
| --- | --- | --- | --- | --- |
| STRIPE FEE STRUCTURE |  |  |  |  |
| Fee Type | Amount | When Charged | Who Pays |  |
| Payment Processing Fee | 2.9% + $0.30 | Per successful card charge | Paid by dental practice |  |
| Stripe Connect Platform Fee | $2.00/month | Per active connected account | Paid by you (CollectRx) |  |
| Payout Fee | $0.25 | Per payout to practice bank | Optional - only if using separate payouts |  |
| RECOMMENDED SETUP: |  |  |  |  |
| • Each practice connects their own Stripe account (OAuth) |  |  |  |  |
| • Practice pays Stripe processing fees (2.9% + $0.30) directly |  |  |  |  |
| • You pay $2/month per active practice to Stripe |  |  |  |  |
| • Funds go directly to practice's bank account |  |  |  |  |
| OPTIONAL: APPLICATION FEE STRATEGY |  |  |  |  |
| What is an Application Fee? |  |  |  |  |
| An optional fee you can charge on each patient payment processed through Stripe. |  |  |  |  |
| Should you charge one? |  |  |  |  |
| PROS: | • Additional revenue stream | • Industry standard (0.5-2%) |  |  |
|  | • Can help offset platform costs |  |  |  |
| CONS: | • Reduces practice's revenue per payment | • May be seen as taking a cut |  |  |
|  | • Could affect pricing competitiveness |  |  |  |
| RECOMMENDATION FOR NOW: |  |  |  |  |
| Start WITHOUT application fees. Focus on SaaS subscription revenue. |  |  |  |  |
| Consider adding later (0.5-1%) once you have 10+ practices. |  |  |  |  |
| EXAMPLE: Patient Payment Breakdown |  |  |  |  |
| Patient owes: | 500 |  |  |  |
| Stripe processing fee (2.9% + $0.30): | 14.8 |  |  |  |
| Practice receives: | 485.2 |  |  |  |
| CollectRx receives: | $0 (from this transaction) |  |  |  |
| Your revenue comes from the monthly SaaS subscription, not from payment processing. |  |  |  |  |
## Sheet: Tax Compliance
| CollectRx - Canadian SaaS Tax Compliance Guide |  |  |  |  |
| --- | --- | --- | --- | --- |
| GST/HST REQUIREMENTS |  |  |  |  |
| Item | Details | Description | Notes |  |
| Registration Threshold | $30,000 CAD | Annual taxable revenue | MUST register once exceeded |  |
| Ontario HST Rate | 13% | 5% federal GST + 8% provincial | Charge on SaaS subscription |  |
| YOUR SITUATION: |  |  |  |  |
| Current Revenue: | $0 | You're a startup |  |  |
| When to Register: | Once you hit $30K in annual revenue | ~3-4 months at moderate growth |  |  |
| What to Charge: | Add 13% HST to your monthly subscription | $300 becomes $339 |  |  |
| FILING SCHEDULE: |  |  |  |  |
| Under $1.5M annual: | File QUARTERLY | Due 30 days after quarter ends |  |  |
| Over $1.5M annual: | File MONTHLY | Due last day of following month |  |  |
| PROVINCIAL SALES TAX (PST) - IMPORTANT |  |  |  |  |
| GOOD NEWS: | Ontario uses HST (harmonized) | You only need ONE tax registration |  |  |
| If you expand to other provinces: |  |  |  |  |
| British Columbia (BC) | Requires separate PST registration | 7% PST + 5% GST | Threshold: $10,000 |  |
| Saskatchewan | Requires separate PST registration | 6% PST + 5% GST | Threshold: $0 (first sale) |  |
| Quebec | Requires QST registration | 9.975% QST + 5% GST | Threshold: $30,000 |  |
| PRICING EXAMPLES (Including Tax) |  |  |  |  |
| Monthly Subscription | Before Tax | HST (13%) | Total Charged |  |
| $200/month | 200 | 26 | 226 |  |
| $300/month | 300 | 39 | 338.9999999999999 |  |
| $450/month | 450 | 58.5 | 508.4999999999999 |  |
| ACTION ITEMS & TIMELINE |  |  |  |  |
| NOW (Before Launch): |  |  |  |  |
| ☐ Set up accounting software (QuickBooks/Wave/FreshBooks) |  |  |  |  |
| ☐ Track all revenue from day 1 |  |  |  |  |
| ☐ Display prices as '$X + applicable taxes' on website |  |  |  |  |
| AT $30,000 REVENUE: |  |  |  |  |
| ☐ Register for GST/HST number at CRA website |  |  |  |  |
| ☐ Update invoicing to include GST/HST |  |  |  |  |
| ☐ Set up quarterly filing reminders |  |  |  |  |
| ONGOING: |  |  |  |  |
| ☐ File GST/HST returns quarterly |  |  |  |  |
| ☐ Remit collected taxes to CRA |  |  |  |  |
| ☐ Keep records for 6 years (CRA requirement) |  |  |  |  |
## Sheet: Pricing Strategy
| CollectRx - Recommended Pricing Strategy |  |  |  |  |
| --- | --- | --- | --- | --- |
| MARKET RESEARCH - Competitor Pricing |  |  |  |  |
| Competitor Type | Pricing | What's Included | Notes |  |
| Full Dental Practice Software | $200-600/month per provider | Includes scheduling, billing, AR, charts |  |  |
| Standalone AR Software | $150-350/month | Accounts receivable only |  |  |
| Open Dental | $129-179/month per location | Comprehensive practice management | Industry standard |  |
| Adit/Pearly | $250+/month | AR automation + patient communication | Similar to your offering |  |
| YOUR POSITIONING |  |  |  |  |
| Your Value Proposition: |  |  |  |  |
| • Focused solution (AR automation only - not full practice management) |  |  |  |  |
| • Modern tech stack |  |  |  |  |
| • Direct Stripe integration (practices keep control) |  |  |  |  |
| • Automated payment reminders |  |  |  |  |
| • Easy patient payment portal |  |  |  |  |
| Competitive Advantage: |  |  |  |  |
| • Lower cost than full practice software |  |  |  |  |
| • Easier to implement than competitors |  |  |  |  |
| • No long-term contracts (flexible for practices) |  |  |  |  |
| RECOMMENDED TIERED PRICING MODEL |  |  |  |  |
| Tier | Monthly Price | Target Customer | Features |  |
| Starter | $199/month | Small practices (1-2 providers) | • Up to 500 patients
• Basic AR automation
• Email reminders
• Payment portal |  |
| Professional | $299/month | Growing practices (3-5 providers) | • Up to 2,000 patients
• SMS + Email reminders
• Advanced reporting
• Priority support |  |
| Enterprise | $449/month | Large/multi-location practices | • Unlimited patients
• Custom workflows
• Multi-location support
• Dedicated success manager |  |
| LAUNCH PRICING STRATEGY |  |  |  |  |
| PHASE 1 (Months 1-3): Early Adopter Pricing |  |  |  |  |
| Price: $199/month (or special rate for founding customers) |  |  |  |  |
| Goal: Get your first 5-10 practices |  |  |  |  |
| Offer: Lock in this rate for 12 months |  |  |  |  |
| PHASE 2 (Months 4-6): Validate & Iterate |  |  |  |  |
| Price: $249/month for new customers |  |  |  |  |
| Goal: Refine product based on feedback |  |  |  |  |
| PHASE 3 (Months 7-12): Scale |  |  |  |  |
| Price: Launch tiered pricing ($199/$299/$449) |  |  |  |  |
| Goal: Reach 15-25 practices |  |  |  |  |
| RECOMMENDATION FOR YOUR CURRENT CLIENT: |  |  |  |  |
| Charge $250/month as agreed |  |  |  |  |
| This is your beta pricing - fair for both parties |  |  |  |  |
| Consider $199 founder rate for next 2-3 practices |  |  |  |  |
## Sheet: Action Plan
| CollectRx - Financial Setup Action Plan |  |  |  |
| --- | --- | --- | --- |
| IMMEDIATE ACTIONS (This Week) |  |  |  |
| Action Item | Details | Notes |  |
| 1. PRICING DECISION |  |  |  |
| ☐ Finalize your monthly subscription price | $250/month recommended to start | Talk to your team |  |
| ☐ Document pricing in writing with current client | Get agreement in email | Protect yourself legally |  |
| 2. STRIPE SETUP |  |  |  |
| ☐ Research Stripe Connect documentation | https://stripe.com/connect |  |  |
| ☐ Decide who pays Stripe fees | Recommend: practices pay their own fees |  |  |
| ☐ Talk to your developer about Stripe Connect integration | Standard vs Express vs Custom accounts |  |  |
| 3. ACCOUNTING SETUP |  |  |  |
| ☐ Choose accounting software | Wave (free) or QuickBooks ($15-30/month) |  |  |
| ☐ Open business bank account if not done | Keep business finances separate | Critical! |  |
| ☐ Set up revenue tracking spreadsheet | Track every dollar from day 1 |  |  |
| SHORT TERM (First Month) |  |  |  |
| Action Item | Details | Notes |  |
| ☐ Complete Stripe Connect integration | Work with developer | Test thoroughly |  |
| ☐ Set up automated invoicing | Monthly billing on specific date |  |  |
| ☐ Create financial projections | Use this spreadsheet as template |  |  |
| ☐ Document all operating costs | Track every expense |  |  |
| ☐ Set revenue goals | How many practices by month 6? |  |  |
| MEDIUM TERM (Months 2-6) |  |  |  |
| Action Item | Timing | Notes |  |
| ☐ Monitor path to $30K revenue | Track monthly to know when to register GST/HST |  |  |
| ☐ Register for GST/HST when appropriate | Once you hit $30K annual revenue |  |  |
| ☐ Review and adjust pricing | After first 3-5 customers |  |  |
| ☐ Consider tiered pricing launch | When you have 8-10 practices |  |  |
| ☐ Optimize operating costs | Cut unnecessary expenses |  |  |
| KEY FINANCIAL MILESTONES |  |  |  |
| Milestone | Target Date | What Happens |  |
| First paying customer | Month 1 | Revenue starts flowing! |  |
| Break-even point | Month 2-3 | Revenue exceeds operating costs |  |
| $1,000/month MRR | Month 4-5 | 3-5 practices at $250 each |  |
| $2,500/month MRR | Month 6-8 | Sustainable business model proven |  |
| $30K annual revenue | Month 10-12 | GST/HST registration required |  |
| $5,000/month MRR | Month 12-15 | Consider hiring/scaling |  |
| IMPORTANT: PARTNERSHIP & EQUITY DISCUSSION |  |  |  |
| You mentioned: | Team of 3, splitting based on percentages |  |  |
| CRITICAL ACTIONS: |  |  |  |
| ☐ Formalize equity split in writing | Founders agreement or partnership agreement | Do this NOW |  |
| ☐ Define roles and responsibilities | Who does what? |  |  |
| ☐ Discuss vesting schedule | 4-year vest with 1-year cliff is standard |  |  |
| ☐ Decide on profit distribution | Reinvest vs distribute? |  |  |
| ☐ Consider incorporating | LLC or Inc? Consult lawyer/accountant |  |  |
| RECOMMENDATION: |  |  |  |
| Spend $1,000-2,000 on proper legal setup now | Saves tens of thousands in disputes later | Worth it! |  |