import {
  AtsType,
  FeedbackEntry,
  JobEvent,
  JobRecord,
  JobSource,
  LearnedRule,
} from '../types/job';

export const INITIAL_SEARCH_PROMPT =
  'Senior or Staff Backend / Infrastructure Engineer working primarily with Go, Rust, or TypeScript. Minimum $185k base compensation, Remote US or flexible hybrid in Pacific timezone. Product-led SaaS or developer infrastructure companies (Series B+). No agency consulting or crypto protocols.';

export const INITIAL_RULES: LearnedRule[] = [
  {
    id: 'rule-1',
    text: 'Require compensation band >= $185,000 when listed',
    origin: 'manual',
    active: true,
  },
  {
    id: 'rule-2',
    text: 'Prioritize Go, Rust, PostgreSQL, and distributed systems roles',
    origin: 'manual',
    active: true,
  },
  {
    id: 'rule-3',
    text: 'Exclude strict 5-day onsite roles outside Pacific timezone',
    origin: 'synthesized',
    active: true,
  },
];

export const VERIFIED_LIVE_PRESETS: {
  name: string;
  url: string;
  atsType: AtsType;
}[] = [
  {
    name: 'Linear Careers',
    url: 'https://jobs.ashbyhq.com/linear',
    atsType: 'Ashby',
  },
  {
    name: 'Vercel Careers',
    url: 'https://boards.greenhouse.io/vercel',
    atsType: 'Greenhouse',
  },
  {
    name: 'Ramp Careers',
    url: 'https://jobs.ashbyhq.com/ramp',
    atsType: 'Ashby',
  },
  {
    name: 'Discord Careers',
    url: 'https://boards.greenhouse.io/discord',
    atsType: 'Greenhouse',
  },
  {
    name: 'Stripe Careers',
    url: 'https://boards.greenhouse.io/stripe',
    atsType: 'Greenhouse',
  },
];

export const INITIAL_SOURCES: JobSource[] = [
  {
    id: 'src-linear',
    name: 'Linear Careers',
    url: 'https://jobs.ashbyhq.com/linear',
    atsType: 'Ashby',
    cadenceHours: 4,
    enabled: true,
    lastCheckedAt: 'Ready for live pull',
    totalFound: 0,
    lastNewCount: 0,
  },
  {
    id: 'src-vercel',
    name: 'Vercel Careers',
    url: 'https://boards.greenhouse.io/vercel',
    atsType: 'Greenhouse',
    cadenceHours: 4,
    enabled: true,
    lastCheckedAt: 'Ready for live pull',
    totalFound: 0,
    lastNewCount: 0,
  },
  {
    id: 'src-ramp',
    name: 'Ramp Careers',
    url: 'https://jobs.ashbyhq.com/ramp',
    atsType: 'Ashby',
    cadenceHours: 6,
    enabled: true,
    lastCheckedAt: 'Ready for live pull',
    totalFound: 0,
    lastNewCount: 0,
  },
  {
    id: 'src-discord',
    name: 'Discord Careers',
    url: 'https://boards.greenhouse.io/discord',
    atsType: 'Greenhouse',
    cadenceHours: 6,
    enabled: false,
    lastCheckedAt: 'Paused',
    totalFound: 0,
    lastNewCount: 0,
  },
];

export const INITIAL_JOBS: JobRecord[] = [
  {
    id: 'job-101',
    urlHash: 'a91f4c01',
    title: 'Staff Distributed Systems Engineer',
    company: 'Veridian Cloud',
    companyDomain: 'veridiancloud.example',
    stage: 'inbox',
    isNew: true,
    matchScore: 96,
    matchReason:
      'Direct Go/Rust storage engine match, remote US, and top-band compensation well above your $185k floor.',
    salaryMin: 215000,
    salaryMax: 255000,
    salaryLabel: '$215k – $255k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-veridian',
    sourceName: 'Veridian Cloud Careers',
    atsType: 'Greenhouse',
    jobUrl: 'https://boards.greenhouse.io/veridiancloud/jobs/49102',
    discoveredAt: '2026-11-18',
    discoveredTime: '06:15 AM',
    deadlineAt: '2026-11-27',
    skills: ['Go', 'Rust', 'Raft', 'PostgreSQL', 'gRPC'],
    summary:
      'Lead design and performance optimization for our multi-region metadata control plane serving 140k requests per second. Work directly with the core runtime team on consensus reliability and zero-downtime shard rebalancing.',
    fullDescription: `About the Role
Veridian Cloud builds globally distributed storage and compute infrastructure for high-throughput SaaS workloads. As a Staff Distributed Systems Engineer on our Core Control Plane team, you will architect the next generation of our multi-region metadata cluster, currently handling 140k+ RPS with sub-12ms p99 latency.

What You'll Do
- Design and ship consensus reliability improvements across Raft-backed metadata groups and lease management services in Go and Rust.
- Lead zero-downtime shard splitting, rebalancing, and regional failover drills across AWS and GCP production fleets.
- Partner with product engineering and SRE to define SLOs, telemetry invariants, and capacity planning models.
- Mentor senior engineers through architecture RFCs, design reviews, and live incident retrospectives.

Qualifications
- 7+ years building production distributed systems, databases, or cloud control planes in Go, Rust, or C++.
- Deep familiarity with Raft/Paxos consensus protocols, PostgreSQL internals, gRPC, and Linux networking.
- Track record of leading cross-team infrastructure migrations without customer-facing downtime.

Compensation & Benefits
- Base salary: $215,000 – $255,000 USD plus meaningful Series C equity and annual performance refreshers.
- 100% Remote across US time zones with quarterly optional engineering summits.
- Comprehensive medical/dental/vision coverage, 401(k) match, and $3,500 home office & learning stipend.`,
    notes: '',
    feedback: null,
  },
  {
    id: 'job-102',
    urlHash: 'b22c8e14',
    title: 'Senior Backend Engineer, Query Engine',
    company: 'Kestrel Systems',
    companyDomain: 'kestrelsyst.example',
    stage: 'inbox',
    isNew: true,
    matchScore: 93,
    matchReason:
      'Strong Rust and PostgreSQL internals alignment at a Series C developer tools company with fully remote policy.',
    salaryMin: 195000,
    salaryMax: 230000,
    salaryLabel: '$195k – $230k',
    location: 'Remote (US / Canada)',
    locationType: 'Remote',
    sourceId: 'src-kestrel',
    sourceName: 'Kestrel Systems',
    atsType: 'Ashby',
    jobUrl: 'https://jobs.ashbyhq.com/kestrelsyst/query-engine-sr',
    discoveredAt: '2026-11-18',
    discoveredTime: '06:15 AM',
    deadlineAt: '2026-11-30',
    skills: ['Rust', 'PostgreSQL', 'SQL Planners', 'Arrow'],
    summary:
      'Build vectorized execution operators and adaptive caching for Kestrel’s analytical telemetry engine. Collaborate with database researchers and customer engineering to cut p99 query latency.',
    fullDescription: `About the Role
Kestrel Systems powers real-time operational observability for engineering teams ingesting petabytes of logs, metrics, and traces. Our Query Engine team is looking for a Senior Backend Engineer to push the boundaries of vectorized query planning and execution.

What You'll Do
- Implement vectorized Apache Arrow execution operators, cost-based optimizer rules, and adaptive predicate pushdown in Rust.
- Design tiered NVMe and object-storage caching strategies that keep p99 interactive queries under 500ms at petabyte scale.
- Collaborate directly with database researchers and enterprise customers to diagnose real-world analytical bottlenecks.
- Improve SQL compatibility and PostgreSQL wire-protocol ergonomics for BI and developer tooling integrations.

Qualifications
- 5+ years of systems or backend engineering experience, with strong proficiency in Rust and modern SQL query engines.
- Hands-on experience with columnar storage formats (Parquet, Arrow), memory management, and CPU profiling.
- Comfort working autonomously in a remote-first, RFC-driven engineering organization.

Compensation & Benefits
- Base salary: $195,000 – $230,000 USD + equity in a well-capitalized Series C developer tools company.
- Fully remote across US & Canada with flexible Pacific/Eastern overlap hours.`,
    notes: '',
    feedback: null,
  },
  {
    id: 'job-103',
    urlHash: 'c34d119a',
    title: 'Principal Platform Engineer',
    company: 'Loomis Data',
    companyDomain: 'loomisdata.example',
    stage: 'inbox',
    isNew: true,
    matchScore: 89,
    matchReason:
      'Matches Go infrastructure focus and salary target, though requires occasional quarterly offsites.',
    salaryMin: 210000,
    salaryMax: 245000,
    salaryLabel: '$210k – $245k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-loomis',
    sourceName: 'Loomis Data Platform',
    atsType: 'Lever',
    jobUrl: 'https://jobs.lever.co/loomisdata/principal-platform',
    discoveredAt: '2026-11-18',
    discoveredTime: '04:00 AM',
    deadlineAt: '2026-11-25',
    skills: ['Go', 'Kubernetes', 'Terraform', 'Kafka'],
    summary:
      'Own multi-tenant ingestion pipelines and regional failover architecture for high-throughput event streams. Define internal developer platform standards across 8 backend squads.',
    fullDescription: `About the Role
Loomis Data processes billions of streaming customer events daily for B2B product analytics. As Principal Platform Engineer, you will set the technical roadmap for our multi-tenant ingestion plane and internal developer platform supporting 8 product engineering squads.

What You'll Do
- Architect multi-region Kafka ingestion pipelines and Go stream processors with deterministic backpressure and tenant isolation.
- Establish golden-path Kubernetes, Terraform, and observability templates used across every backend service.
- Lead high-leverage cost and reliability initiatives across compute, storage, and cross-AZ data transfer.
- Advise VP of Engineering on technical hiring bars, architectural governance, and build-vs-buy decisions.

Qualifications
- 8+ years in platform, backend, or infrastructure engineering with deep production mastery of Go, Kubernetes, and Kafka.
- Proven influence across multiple engineering squads without relying on formal management authority.
- Ability to attend 2–3 quarterly architecture offsites per year (all travel covered).

Compensation & Benefits
- Base salary: $210,000 – $245,000 USD plus equity and comprehensive healthcare benefits.`,
    notes: '',
    feedback: null,
  },
  {
    id: 'job-104',
    urlHash: 'd88f02b7',
    title: 'Senior Backend Engineer, Billing APIs',
    company: 'Cinder Compute',
    companyDomain: 'cindercompute.example',
    stage: 'inbox',
    isNew: true,
    matchScore: 81,
    matchReason:
      'Strong Go/TypeScript stack and Series B growth stage, but hybrid Seattle expectation (3 days/week).',
    salaryMin: 185000,
    salaryMax: 215000,
    salaryLabel: '$185k – $215k',
    location: 'Seattle, WA',
    locationType: 'Hybrid',
    sourceId: 'src-cinder',
    sourceName: 'Cinder Compute',
    atsType: 'Custom Markdown',
    jobUrl: 'https://cindercompute.example/careers/billing-apis',
    discoveredAt: '2026-11-17',
    discoveredTime: '10:00 PM',
    deadlineAt: '2026-12-04',
    skills: ['Go', 'TypeScript', 'PostgreSQL', 'Ledger Systems'],
    summary:
      'Architect usage-based metering and real-time invoicing ledgers for GPU cluster workloads. Guarantee strict idempotency and sub-second balance checks across global regions.',
    fullDescription: `About the Role
Cinder Compute provides elastic, low-latency GPU and serverless compute clusters for AI engineering teams. You will join the Billing & Metering team to build the double-entry financial ledger and real-time quota enforcement APIs that power customer spend tracking.

What You'll Do
- Build idempotent usage-metering pipelines and real-time balance checks in Go, TypeScript, and PostgreSQL.
- Design automated invoicing, Stripe reconciliation workflows, and customer-facing spend anomaly alerts.
- Partner closely with Finance, Enterprise Sales, and Developer Experience teams on custom committed-use pricing tiers.

Qualifications
- 5+ years of backend engineering experience in Go and/or TypeScript with strong relational database design skills.
- Experience with financial ledgers, billing systems, or strictly idempotent distributed APIs.
- Able to work hybrid (3 days/week) from our Seattle, WA engineering hub.

Compensation & Benefits
- Base salary: $185,000 – $215,000 USD + Series B equity + commuter and lunch stipends.`,
    notes: '',
    feedback: null,
  },
  {
    id: 'job-105',
    urlHash: 'e19a77c2',
    title: 'Solutions Architect, Enterprise Cloud',
    company: 'Veridian Cloud',
    companyDomain: 'veridiancloud.example',
    stage: 'inbox',
    isNew: true,
    matchScore: 64,
    matchReason:
      'Company matches your target list, but role is customer-facing with 25% travel rather than core backend engineering.',
    salaryMin: 170000,
    salaryMax: 195000,
    salaryLabel: '$170k – $195k',
    location: 'San Francisco, CA',
    locationType: 'Hybrid',
    sourceId: 'src-veridian',
    sourceName: 'Veridian Cloud Careers',
    atsType: 'Greenhouse',
    jobUrl: 'https://boards.greenhouse.io/veridiancloud/jobs/49118',
    discoveredAt: '2026-11-18',
    discoveredTime: '06:15 AM',
    deadlineAt: null,
    skills: ['Cloud Architecture', 'Go', 'Customer Advisory'],
    summary:
      'Partner with enterprise technical buyers on proof-of-concept deployments, security reviews, and production migrations. Expect roughly 25% domestic travel for customer workshops.',
    fullDescription: `About the Role
Join Veridian Cloud’s Enterprise Field Engineering organization to guide Fortune 500 technical buyers from initial proof-of-concept through full production migration onto Veridian’s distributed cloud platform.

What You'll Do
- Lead architectural discovery workshops, security reviews, and benchmark POCs alongside Account Executives.
- Build reference architectures and sample Go/Terraform integration templates tailored to enterprise environments.
- Relay customer product gaps directly to Core Engineering and Product Management.

Qualifications
- 4+ years in Solutions Architecture, Forward-Deployed Engineering, or customer-facing cloud infrastructure roles.
- Comfortable traveling roughly 25% domestically for executive briefings and onsite workshops.

Compensation & Benefits
- Base salary: $170,000 – $195,000 USD OTE/base range depending on experience.`,
    notes: '',
    feedback: null,
  },
  {
    id: 'job-106',
    urlHash: 'f55b90d1',
    title: 'Staff Infrastructure Engineer, Storage',
    company: 'Bramble Financial',
    companyDomain: 'bramblefin.example',
    stage: 'saved',
    isNew: false,
    matchScore: 94,
    matchReason:
      'High-throughput Go + PostgreSQL financial core, remote US, and strong equity + base package.',
    salaryMin: 220000,
    salaryMax: 250000,
    salaryLabel: '$220k – $250k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-bramble',
    sourceName: 'Bramble Financial Tech',
    atsType: 'Greenhouse',
    jobUrl: 'https://boards.greenhouse.io/bramblefin/jobs/8812',
    discoveredAt: '2026-11-15',
    discoveredTime: '08:00 AM',
    deadlineAt: '2026-11-24',
    skills: ['Go', 'PostgreSQL', 'Distributed Transactions', 'AWS'],
    summary:
      'Scale our double-entry clearing engine and replication topology to support 10x transaction throughput with strict auditability guarantees.',
    fullDescription: `About the Role
Bramble Financial builds real-time treasury and payment clearing infrastructure for modern fintechs and marketplaces. As Staff Infrastructure Engineer on our Storage & Ledger Core team, you will scale our deterministic clearing engine to handle 10x transaction volume while preserving strict financial auditability.

What You'll Do
- Architect high-throughput PostgreSQL partitioning, read/write isolation, and multi-region replication topologies.
- Build distributed transaction orchestration and idempotency primitives in Go for real-time ACH, FedNow, and wire settlement.
- Lead chaos testing, disaster-recovery drills, and zero-downtime schema migration tooling.
- Partner with Risk, Compliance, and Core Banking leadership on SOC2/PCI-aligned data governance.

Qualifications
- 7+ years building mission-critical Go and PostgreSQL backend systems at scale.
- Strong understanding of ACID isolation levels, write-ahead logging, replication lag, and distributed locking.
- Prior fintech, payments, or ledger engineering experience strongly valued.

Compensation & Benefits
- Base salary: $220,000 – $250,000 USD + meaningful equity + 100% Remote US policy.`,
    networkingContacts: [
      {
        id: 'net-106-1',
        name: 'Maya Patel',
        role: 'Senior Staff Engineer (Core Platform)',
        channel: 'Slack',
        status: 'Referred',
        sentiment: 'Champion',
        lastContactDate: '2026-11-15',
        followUpDate: '2026-11-21',
        notes: 'Former colleague — submitted internal referral and shared hiring manager context.',
      },
      {
        id: 'net-106-2',
        name: 'Devon Brooks',
        role: 'Director of Infrastructure (Hiring Manager)',
        channel: 'LinkedIn',
        status: 'To Reach Out',
        sentiment: 'Neutral',
        followUpDate: '2026-11-20',
        notes: 'Draft short note referencing their recent PostgreSQL sharding talk.',
      },
    ],
    notes: 'Reached out to former colleague Maya on the core platform team for a referral.',
    feedback: 'up',
  },
  {
    id: 'job-107',
    urlHash: 'g12e44a8',
    title: 'Senior Runtime Engineer (Rust)',
    company: 'Cinder Compute',
    companyDomain: 'cindercompute.example',
    stage: 'saved',
    isNew: false,
    matchScore: 91,
    matchReason:
      'Pure Rust microVM scheduling work with strong remote engineering culture and clear compensation.',
    salaryMin: 200000,
    salaryMax: 235000,
    salaryLabel: '$200k – $235k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-cinder',
    sourceName: 'Cinder Compute',
    atsType: 'Custom Markdown',
    jobUrl: 'https://cindercompute.example/careers/runtime-rust',
    discoveredAt: '2026-11-14',
    discoveredTime: '02:00 PM',
    deadlineAt: '2026-11-28',
    skills: ['Rust', 'Linux', 'eBPF', 'Firecracker'],
    summary:
      'Optimize cold-start latency and memory snapshotting for sandboxed compute containers running untrusted workloads at edge locations.',
    fullDescription: `About the Role
Cinder Compute’s Runtime team builds the Rust-based microVM execution fabric powering thousands of isolated sandboxes per second. We are hiring a Senior Runtime Engineer to drive cold-start latency under 50ms globally.

What You'll Do
- Build and profile Firecracker microVM lifecycle orchestration, memory snapshotting, and copy-on-write disk layers in Rust.
- Use eBPF and Linux namespaces/cgroups to enforce strict multi-tenant network and CPU isolation.
- Publish open-source benchmarks and engineering deep dives on sandbox performance.

Qualifications
- 5+ years systems programming in Rust, C, or C++ on Linux.
- Experience with KVM/Firecracker, container runtimes, eBPF, or kernel-level performance tuning.

Compensation & Benefits
- Base salary: $200,000 – $235,000 USD + equity, fully remote across the US.`,
    notes: 'Review their recent engineering blog post on memory ballooning before applying.',
    feedback: 'up',
  },
  {
    id: 'job-108',
    urlHash: 'h73c91f0',
    title: 'Senior Distributed Systems Engineer',
    company: 'Kestrel Systems',
    companyDomain: 'kestrelsyst.example',
    stage: 'applied',
    isNew: false,
    matchScore: 95,
    matchReason:
      'Ideal match on Go + observability ingestion pipeline, remote-first team, and $205k+ band.',
    salaryMin: 205000,
    salaryMax: 240000,
    salaryLabel: '$205k – $240k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-kestrel',
    sourceName: 'Kestrel Systems',
    atsType: 'Ashby',
    jobUrl: 'https://jobs.ashbyhq.com/kestrelsyst/distributed-sr',
    discoveredAt: '2026-11-11',
    discoveredTime: '09:30 AM',
    deadlineAt: '2026-11-22',
    skills: ['Go', 'ClickHouse', 'Kafka', 'OpenTelemetry'],
    summary:
      'Design high-volume log and trace ingestion gateways capable of absorbing 50M events/sec with automatic backpressure and schema evolution.',
    fullDescription: `About the Role
Kestrel Systems’ Ingestion team is the front door for 50M+ OpenTelemetry events per second. You will design resilient, low-overhead Go ingestion gateways and ClickHouse batching writers that keep customer telemetry flowing even under 10x traffic spikes.

What You'll Do
- Build high-throughput HTTP/gRPC ingestion gateways in Go with zero-allocation serialization and dynamic rate limiting.
- Optimize Kafka partitioning, ClickHouse merge pressure, and automated schema evolution pipelines.
- Drive end-to-end reliability metrics and participate in a humane, well-instrumented on-call rotation.

Qualifications
- 5+ years writing high-throughput networked services in Go or Rust.
- Hands-on experience with Kafka, ClickHouse, OpenTelemetry, or large-scale observability pipelines.

Compensation & Benefits
- Base salary: $205,000 – $240,000 USD + Series C equity + Remote US.`,
    networkingContacts: [
      {
        id: 'net-108-1',
        name: 'Claire Henderson',
        role: 'Senior Technical Recruiter',
        channel: 'Email',
        status: 'Replied',
        sentiment: 'Warm',
        lastContactDate: '2026-11-12',
        followUpDate: '2026-11-19',
        notes: 'Confirmed application is with hiring manager; following up if no update by Thursday.',
      },
    ],
    notes: 'Applied directly via Ashby on Nov 12. Recruiter acknowledged receipt.',
    feedback: 'up',
  },
  {
    id: 'job-109',
    urlHash: 'i88d21b3',
    title: 'Backend Engineer, Realtime Sync',
    company: 'Almanac Studio',
    companyDomain: 'almanacstudio.example',
    stage: 'applied',
    isNew: false,
    matchScore: 88,
    matchReason:
      'TypeScript + Rust CRDT sync engine for collaborative workspaces; remote friendly with strong product team.',
    salaryMin: 190000,
    salaryMax: 220000,
    salaryLabel: '$190k – $220k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-loomis',
    sourceName: 'Loomis Data Platform',
    atsType: 'Lever',
    jobUrl: 'https://jobs.lever.co/almanacstudio/realtime-sync',
    discoveredAt: '2026-11-10',
    discoveredTime: '11:00 AM',
    deadlineAt: null,
    skills: ['TypeScript', 'Rust', 'WebSockets', 'CRDTs'],
    summary:
      'Build low-latency document synchronization servers and offline conflict resolution protocols for collaborative product planning tools.',
    fullDescription: `About the Role
Almanac Studio builds multiplayer planning and specification software for fast-moving product teams. As a Backend Engineer on our Realtime Sync squad, you will own the WebSocket gateway and CRDT persistence layer that keeps thousands of concurrent editors seamlessly in sync.

What You'll Do
- Architect stateful TypeScript and Rust synchronization servers with instant offline-to-online merge semantics.
- Optimize presence fanout, delta compression, and snapshotting to keep p95 sync latency below 35ms worldwide.
- Collaborate tightly with frontend engineers on client-side state hydration and conflict visualization.

Qualifications
- 4+ years building real-time distributed web applications in TypeScript/Node.js and/or Rust.
- Experience with WebSockets, CRDTs/OT, Redis Streams, or collaborative editing architectures.

Compensation & Benefits
- Base salary: $190,000 – $220,000 USD + equity, 100% remote US.`,
    notes: 'Submitted tailored resume highlighting WebSocket fanout work.',
    feedback: 'up',
  },
  {
    id: 'job-110',
    urlHash: 'j29a55e4',
    title: 'Staff Backend Engineer, Core API',
    company: 'Northstar Labs',
    companyDomain: 'northstarlabs.example',
    stage: 'interviewing',
    isNew: false,
    matchScore: 97,
    matchReason:
      'Top match across Go, PostgreSQL, remote US culture, and staff scope with direct architectural ownership.',
    salaryMin: 225000,
    salaryMax: 260000,
    salaryLabel: '$225k – $260k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-veridian',
    sourceName: 'Veridian Cloud Careers',
    atsType: 'Greenhouse',
    jobUrl: 'https://boards.greenhouse.io/northstarlabs/jobs/3102',
    discoveredAt: '2026-11-04',
    discoveredTime: '07:45 AM',
    deadlineAt: null,
    skills: ['Go', 'PostgreSQL', 'GraphQL', 'Redis'],
    summary:
      'Lead API gateway evolution, rate-limiting architecture, and developer ergonomics for Northstar’s multi-region cloud automation platform.',
    fullDescription: `About the Role
Northstar Labs automates cloud compliance and deployment workflows for 1,200+ engineering organizations. As Staff Backend Engineer on our Core API team, you will own the architectural direction of our public GraphQL/REST API platform, global rate-limiting layer, and multi-region PostgreSQL data access patterns.

What You'll Do
- Lead the technical roadmap for Northstar’s Go API gateway, webhook delivery engine, and tenant-aware Redis rate limiter.
- Define API versioning, backward-compatibility guarantees, and SDK generation workflows loved by external developers.
- Partner with Security and Infrastructure teams to enforce fine-grained RBAC and audit logging across all endpoints.
- Elevate engineering craftsmanship through clear RFCs, pairing, and mentoring across a 25-person backend org.

Qualifications
- 7+ years building external-facing API platforms and high-reliability backend services in Go and PostgreSQL.
- Deep experience with GraphQL/REST design, Redis clustering, authentication standards (OAuth2/OIDC), and developer experience.

Compensation & Benefits
- Base salary: $225,000 – $260,000 USD + generous equity + 100% Remote US + 4 weeks PTO.`,
    networkingContacts: [
      {
        id: 'net-110-1',
        name: 'Marcus Chen',
        role: 'VP of Engineering (Hiring Manager)',
        channel: 'Coffee Chat',
        status: 'Replied',
        sentiment: 'Champion',
        lastContactDate: '2026-11-14',
        notes: 'Great HM screen — emphasized API reliability and mentoring staff-level RFC culture.',
      },
      {
        id: 'net-110-2',
        name: 'Elena Rostova',
        role: 'Staff Engineer, API Platform',
        channel: 'LinkedIn',
        status: 'Coffee Chat Scheduled',
        sentiment: 'Warm',
        lastContactDate: '2026-11-16',
        followUpDate: '2026-11-21',
        notes: 'Informal 20-min chat scheduled after systems design round to learn about team roadmap.',
      },
    ],
    notes: 'Passed hiring manager screen. Systems design deep dive scheduled for Nov 20.',
    feedback: 'up',
  },
  {
    id: 'job-111',
    urlHash: 'k40c18d9',
    title: 'Senior Platform Engineer, Data Plane',
    company: 'Vesper Security',
    companyDomain: 'vespersec.example',
    stage: 'interviewing',
    isNew: false,
    matchScore: 90,
    matchReason:
      'Rust proxy and identity control plane matching security-hardened infrastructure interests.',
    salaryMin: 195000,
    salaryMax: 225000,
    salaryLabel: '$195k – $225k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-kestrel',
    sourceName: 'Kestrel Systems',
    atsType: 'Ashby',
    jobUrl: 'https://jobs.ashbyhq.com/vespersec/data-plane',
    discoveredAt: '2026-11-06',
    discoveredTime: '01:15 PM',
    deadlineAt: null,
    skills: ['Rust', 'TLS', 'Envoy', 'Go'],
    summary:
      'Develop zero-trust network proxies and ephemeral credential brokers used by enterprise security teams.',
    fullDescription: `About the Role
Vesper Security eliminates standing production credentials through short-lived identity-aware proxies. Join our Data Plane team to build ultra-fast, memory-safe Rust network proxies and Envoy extensions deployed in enterprise customer VPCs.

What You'll Do
- Develop TLS-terminating data-plane proxies and ephemeral SSH/DB credential brokers in Rust and Go.
- Harden cryptographic handshake paths, mTLS certificate rotation, and FIPS-compliant audit trails.
- Collaborate with security researchers and enterprise CISOs on zero-trust deployment ergonomics.

Qualifications
- 5+ years of systems/network engineering in Rust or Go, with solid knowledge of TLS, mTLS, HTTP/2, and Envoy.
- Passion for security-first engineering and crisp protocol design.

Compensation & Benefits
- Base salary: $195,000 – $225,000 USD + Series B equity + 100% Remote US.`,
    notes: 'Recruiter screen done. Technical pairing session booked for Nov 23.',
    feedback: 'up',
  },
  {
    id: 'job-112',
    urlHash: 'l92f03c6',
    title: 'Principal Systems Architect',
    company: 'Quarry Analytics',
    companyDomain: 'quarryanalytics.example',
    stage: 'offer',
    isNew: false,
    matchScore: 95,
    matchReason:
      'Full remote leadership role over Go/Rust ingestion infrastructure with competitive total compensation.',
    salaryMin: 230000,
    salaryMax: 265000,
    salaryLabel: '$230k – $265k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-loomis',
    sourceName: 'Loomis Data Platform',
    atsType: 'Lever',
    jobUrl: 'https://jobs.lever.co/quarryanalytics/principal-architect',
    discoveredAt: '2026-10-28',
    discoveredTime: '08:00 AM',
    deadlineAt: '2026-11-26',
    skills: ['Go', 'Rust', 'DuckDB', 'Kubernetes'],
    summary:
      'Guide technical direction for Quarry’s distributed compute engine and partner with engineering leadership on multi-year scalability milestones.',
    fullDescription: `About the Role
Quarry Analytics enables data teams to run sub-second SQL analytics directly over cloud object storage using an elastic DuckDB-powered compute fabric. As Principal Systems Architect, you will partner directly with the CTO to steer our multi-year distributed execution and cluster scheduling architecture.

What You'll Do
- Design distributed query shuffling, fault-tolerant worker orchestration, and adaptive memory spilling across Go/Rust services.
- Set multi-quarter architectural standards and evaluate emerging storage/compute primitives (DuckDB, Iceberg, Arrow Flight).
- Represent Quarry’s engineering brand through technical blog posts, conference talks, and executive customer architecture reviews.

Qualifications
- 9+ years designing and scaling distributed data or cloud infrastructure systems in Go, Rust, or C++.
- Track record of driving company-defining technical architecture decisions at growth-stage startups.

Compensation & Benefits
- Base salary: $230,000 – $265,000 USD + meaningful principal-level equity grant + 100% Remote US.`,
    networkingContacts: [
      {
        id: 'net-112-1',
        name: 'Samir Kulkarni',
        role: 'Co-Founder & CTO',
        channel: 'Email',
        status: 'Replied',
        sentiment: 'Champion',
        lastContactDate: '2026-11-17',
        followUpDate: '2026-11-25',
        notes: 'Sent written offer ($242k + 0.18% equity); open to discussing signing bonus on Nov 25 call.',
      },
    ],
    notes: 'Written offer received: $242k base + 0.18% equity. Decision requested by Nov 26.',
    feedback: 'up',
  },
  {
    id: 'job-113',
    urlHash: 'm11b44a2',
    title: 'Backend Engineer II (Java / Spring)',
    company: 'Bramble Financial',
    companyDomain: 'bramblefin.example',
    stage: 'archived',
    isNew: false,
    matchScore: 58,
    matchReason:
      'Below target seniority and Java-heavy stack outside preferred Go/Rust focus.',
    salaryMin: 145000,
    salaryMax: 165000,
    salaryLabel: '$145k – $165k',
    location: 'New York, NY',
    locationType: 'Onsite',
    sourceId: 'src-bramble',
    sourceName: 'Bramble Financial Tech',
    atsType: 'Greenhouse',
    jobUrl: 'https://boards.greenhouse.io/bramblefin/jobs/8790',
    discoveredAt: '2026-11-12',
    discoveredTime: '06:00 AM',
    deadlineAt: null,
    skills: ['Java', 'Spring Boot', 'Oracle'],
    summary:
      'Maintain internal compliance reporting workflows and batch reconciliation jobs for institutional clients.',
    fullDescription: `About the Role
Join Bramble Financial’s Institutional Operations Engineering team in New York to maintain and extend our internal compliance reporting pipelines and overnight batch reconciliation jobs.

What You'll Do
- Maintain Java / Spring Boot microservices and Oracle SQL reporting queries for institutional audit deliverables.
- Support regulatory filing schedules and collaborate with Compliance Analysts on data validation rules.

Qualifications
- 2–4 years of backend engineering experience in Java, Spring Boot, and Oracle/SQL databases.
- Full-time onsite presence in our Midtown Manhattan office (5 days/week).

Compensation & Benefits
- Base salary: $145,000 – $165,000 USD.`,
    notes: '',
    feedback: 'down',
    dislikeReason: 'Wrong role type',
  },
  {
    id: 'job-114',
    urlHash: 'n54e82b1',
    title: 'Field Platform Engineer',
    company: 'Loomis Data',
    companyDomain: 'loomisdata.example',
    stage: 'archived',
    isNew: false,
    matchScore: 62,
    matchReason: 'Requires 30% onsite client travel and hybrid office attendance.',
    salaryMin: 175000,
    salaryMax: 195000,
    salaryLabel: '$175k – $195k',
    location: 'Austin, TX',
    locationType: 'Hybrid',
    sourceId: 'src-loomis',
    sourceName: 'Loomis Data Platform',
    atsType: 'Lever',
    jobUrl: 'https://jobs.lever.co/loomisdata/field-platform',
    discoveredAt: '2026-11-13',
    discoveredTime: '06:00 AM',
    deadlineAt: null,
    skills: ['Go', 'Kubernetes', 'Client Deployments'],
    summary:
      'Embed with enterprise customers to deploy on-premise clusters and optimize streaming workloads.',
    fullDescription: `About the Role
Loomis Data is seeking a Field Platform Engineer based in Austin, TX to embed directly with strategic enterprise accounts deploying Loomis streaming infrastructure inside private data centers.

What You'll Do
- Deploy, tune, and troubleshoot self-hosted Kubernetes and Go streaming clusters at enterprise customer sites.
- Deliver hands-on operator training and migration runbooks for customer SRE teams.

Qualifications
- 4+ years working with Go, Kubernetes, and enterprise Linux deployments.
- Willingness to travel up to 30% to customer locations across North America plus hybrid Austin office attendance.

Compensation & Benefits
- Base salary: $175,000 – $195,000 USD + travel per diem.`,
    notes: '',
    feedback: 'down',
    dislikeReason: 'Location',
  },
];

export const INITIAL_EVENTS: JobEvent[] = [
  {
    id: 'evt-1',
    jobId: 'job-110',
    date: '2026-11-20',
    label: 'Systems Design Deep Dive — Northstar Labs',
    type: 'interview',
  },
  {
    id: 'evt-2',
    jobId: 'job-111',
    date: '2026-11-23',
    label: 'Rust Pairing Session — Vesper Security',
    type: 'interview',
  },
  {
    id: 'evt-3',
    jobId: 'job-108',
    date: '2026-11-19',
    label: 'Follow up with Ashby recruiter — Kestrel Systems',
    type: 'followup',
  },
  {
    id: 'evt-4',
    jobId: 'job-112',
    date: '2026-11-25',
    label: 'Comp review call — Quarry Analytics',
    type: 'followup',
  },
];

export const INITIAL_FEEDBACK: FeedbackEntry[] = [
  {
    id: 'fb-1',
    jobId: 'job-110',
    jobTitle: 'Staff Backend Engineer, Core API',
    company: 'Northstar Labs',
    vote: 'up',
    createdAt: 'Nov 04',
  },
  {
    id: 'fb-2',
    jobId: 'job-108',
    jobTitle: 'Senior Distributed Systems Engineer',
    company: 'Kestrel Systems',
    vote: 'up',
    createdAt: 'Nov 11',
  },
  {
    id: 'fb-3',
    jobId: 'job-113',
    jobTitle: 'Backend Engineer II (Java / Spring)',
    company: 'Bramble Financial',
    vote: 'down',
    reason: 'Wrong role type',
    createdAt: 'Nov 12',
  },
  {
    id: 'fb-4',
    jobId: 'job-114',
    jobTitle: 'Field Platform Engineer',
    company: 'Loomis Data',
    vote: 'down',
    reason: 'Location',
    createdAt: 'Nov 13',
  },
  {
    id: 'fb-5',
    jobId: 'job-106',
    jobTitle: 'Staff Infrastructure Engineer, Storage',
    company: 'Bramble Financial',
    vote: 'up',
    createdAt: 'Nov 15',
  },
];

/**
 * Candidate pool used when the user clicks "Run Agent Now".
 * Simulates deduplicating seen URL hashes and pulling 2–3 fresh unseen roles.
 */
export const AGENT_DISCOVERY_POOL: Omit<JobRecord, 'discoveredAt' | 'discoveredTime'>[] = [
  {
    id: 'job-201',
    urlHash: 'p90x11a1',
    title: 'Staff Go Engineer, Edge Routing',
    company: 'Veridian Cloud',
    companyDomain: 'veridiancloud.example',
    stage: 'inbox',
    isNew: true,
    matchScore: 97,
    matchReason:
      'Matches your Go + distributed networking criteria and mirrors your upvoted Staff roles at Northstar and Kestrel.',
    salaryMin: 220000,
    salaryMax: 258000,
    salaryLabel: '$220k – $258k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-veridian',
    sourceName: 'Veridian Cloud Careers',
    atsType: 'Greenhouse',
    jobUrl: 'https://boards.greenhouse.io/veridiancloud/jobs/49280',
    deadlineAt: '2026-12-03',
    skills: ['Go', 'BGP', 'Anycast', 'Linux'],
    summary:
      'Build low-latency global traffic directors and automated anomaly mitigation across 45 points of presence.',
    notes: '',
    feedback: null,
  },
  {
    id: 'job-202',
    urlHash: 'q41y29c3',
    title: 'Senior Storage Systems Engineer',
    company: 'Kestrel Systems',
    companyDomain: 'kestrelsyst.example',
    stage: 'inbox',
    isNew: true,
    matchScore: 92,
    matchReason:
      'Rust object-storage compaction engine with full remote US support and Series C stability.',
    salaryMin: 198000,
    salaryMax: 232000,
    salaryLabel: '$198k – $232k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-kestrel',
    sourceName: 'Kestrel Systems',
    atsType: 'Ashby',
    jobUrl: 'https://jobs.ashbyhq.com/kestrelsyst/storage-systems-sr',
    deadlineAt: '2026-12-08',
    skills: ['Rust', 'S3 APIs', 'LSM Trees', 'Async IO'],
    summary:
      'Design tiered object-store compaction pipelines and local NVMe read caches for multi-petabyte telemetry datasets.',
    notes: '',
    feedback: null,
  },
  {
    id: 'job-203',
    urlHash: 'r77z04d8',
    title: 'Staff Scheduler Engineer',
    company: 'Cinder Compute',
    companyDomain: 'cindercompute.example',
    stage: 'inbox',
    isNew: true,
    matchScore: 87,
    matchReason:
      'Strong Go/Rust systems fit with transparent $210k+ band; hybrid optional in Pacific timezone.',
    salaryMin: 210000,
    salaryMax: 245000,
    salaryLabel: '$210k – $245k',
    location: 'Remote or Seattle',
    locationType: 'Remote',
    sourceId: 'src-cinder',
    sourceName: 'Cinder Compute',
    atsType: 'Custom Markdown',
    jobUrl: 'https://cindercompute.example/careers/staff-scheduler',
    deadlineAt: '2026-11-29',
    skills: ['Go', 'Rust', 'Kubernetes', 'Bin Packing'],
    summary:
      'Optimize gang-scheduling and preemption policies across heterogeneous compute clusters with sub-second placement guarantees.',
    notes: '',
    feedback: null,
  },
  {
    id: 'job-204',
    urlHash: 's15w88f9',
    title: 'Senior Platform Engineer, Streaming',
    company: 'Loomis Data',
    companyDomain: 'loomisdata.example',
    stage: 'inbox',
    isNew: true,
    matchScore: 91,
    matchReason:
      'Go + Kafka data plane engineering with 100% remote US eligibility and zero travel requirement.',
    salaryMin: 192000,
    salaryMax: 226000,
    salaryLabel: '$192k – $226k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-loomis',
    sourceName: 'Loomis Data Platform',
    atsType: 'Lever',
    jobUrl: 'https://jobs.lever.co/loomisdata/streaming-platform',
    deadlineAt: '2026-12-06',
    skills: ['Go', 'Kafka', 'Protobuf', 'PostgreSQL'],
    summary:
      'Scale schema-validated streaming connectors and dead-letter replay tooling powering real-time analytics feeds.',
    notes: '',
    feedback: null,
  },
  {
    id: 'job-205',
    urlHash: 't63v50e2',
    title: 'Senior Backend Engineer, Ledger Core',
    company: 'Bramble Financial',
    companyDomain: 'bramblefin.example',
    stage: 'inbox',
    isNew: true,
    matchScore: 94,
    matchReason:
      'High-reliability Go + PostgreSQL role closely aligned with your previously saved Storage role at Bramble.',
    salaryMin: 205000,
    salaryMax: 238000,
    salaryLabel: '$205k – $238k',
    location: 'Remote (US)',
    locationType: 'Remote',
    sourceId: 'src-bramble',
    sourceName: 'Bramble Financial Tech',
    atsType: 'Greenhouse',
    jobUrl: 'https://boards.greenhouse.io/bramblefin/jobs/8944',
    deadlineAt: '2026-12-10',
    skills: ['Go', 'PostgreSQL', 'gRPC', 'Idempotency'],
    summary:
      'Own settlement state machines and reconciliation invariants for real-time treasury transfers.',
    notes: '',
    feedback: null,
  },
];

export function detectAtsType(url: string): AtsType {
  const lower = url.toLowerCase();
  if (lower.includes('greenhouse.io')) return 'Greenhouse';
  if (lower.includes('lever.co')) return 'Lever';
  if (lower.includes('ashbyhq.com')) return 'Ashby';
  if (lower.includes('rss') || lower.includes('.xml') || lower.includes('/feed')) {
    return 'RSS Feed';
  }
  return 'Custom Markdown';
}

export const WEEK1_POSTGRES_SCHEMA = `-- Week 1 Core Schema: PostgreSQL + pgvector
-- Supports normalized multi-view jobs, ATS source routing, URL deduplication,
-- preference feedback memory, and calendar milestones.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TYPE pipeline_stage AS ENUM (
  'inbox',
  'saved',
  'applied',
  'interviewing',
  'offer',
  'archived'
);

CREATE TYPE ats_type AS ENUM (
  'greenhouse',
  'lever',
  'ashby',
  'custom_markdown',
  'rss_feed'
);

CREATE TABLE user_preferences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE,
  criteria_prompt   TEXT NOT NULL,
  explicit_rules    JSONB NOT NULL DEFAULT '[]'::jsonb,
  poll_cadence_hrs  SMALLINT NOT NULL DEFAULT 4,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  name              TEXT NOT NULL,
  url               TEXT NOT NULL,
  ats_type          ats_type NOT NULL DEFAULT 'custom_markdown',
  cadence_hours     SMALLINT NOT NULL DEFAULT 4,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  last_checked_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, url)
);

CREATE TABLE jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  source_id         UUID REFERENCES sources(id) ON DELETE SET NULL,
  canonical_hash    TEXT NOT NULL, -- SHA-256(canonical_url | company+title+loc)
  title             TEXT NOT NULL,
  company           TEXT NOT NULL,
  stage             pipeline_stage NOT NULL DEFAULT 'inbox',
  is_new            BOOLEAN NOT NULL DEFAULT true,
  match_score       SMALLINT CHECK (match_score BETWEEN 0 AND 100),
  match_reason      TEXT,
  salary_min        INTEGER,
  salary_max        INTEGER,
  location          TEXT,
  location_type     TEXT CHECK (location_type IN ('Remote', 'Hybrid', 'Onsite')),
  job_url           TEXT NOT NULL,
  skills            TEXT[] NOT NULL DEFAULT '{}',
  summary           TEXT,
  notes             TEXT NOT NULL DEFAULT '',
  embedding         VECTOR(1536),
  discovered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at       DATE,
  last_verified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, canonical_hash)
);

CREATE INDEX idx_jobs_user_stage ON jobs (user_id, stage);
CREATE INDEX idx_jobs_user_new   ON jobs (user_id, is_new) WHERE is_new = true;
CREATE INDEX idx_jobs_embedding  ON jobs USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE feedback_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  vote              TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  reason_tag        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE calendar_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL CHECK (event_type IN ('interview', 'followup')),
  event_date        DATE NOT NULL,
  label             TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
