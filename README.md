# Meridian

**Meridian** is an AI-powered job discovery, pipeline management, and resume tailoring workspace that aggregates opportunities across job boards, email alerts, Slack, WhatsApp, and spreadsheet uploads into a single structured tracker.

## Key Features

- **Guided Account Intake & Multi-Channel Discovery**: Configure target role types, locations, work modes, keywords, employment types, and refresh cadence, then pull roles from ATS feeds (Greenhouse, Lever, Ashby, RSS), Gmail job alert senders, Slack channels (OAuth), WhatsApp exports, or uploaded CSV/JSON files with intelligent column mapping.
- **Unified Pipeline Views**: Triage and manage opportunities across **Table**, **Kanban**, and **Search Calendar** views with full job descriptions, match scoring, thumbs-up/down preference learning, and CSV export.
- **Networking & LinkedIn Outreach**: Dedicated **Networking** tab per role to track contacts, outreach status, sentiment (*Champion*, *Warm*, *Neutral*, *Cold*, *Unresponsive*), notes, and follow-up dates synced to the calendar—plus one-click **Export to LinkedIn** pre-populated 300-character connection request drafts.
- **Role-Specific 1-Page Resume Tailoring (`.docx`)**: Upload one base resume per role track (e.g., PM, PMM, Strategy) alongside an extended bank of off-resume roles and projects. Tailor your resume per job description with inline redline previews and download a strictly 1-page Word document (`.docx`) with edits highlighted in red (or a clean final copy).
- **Cloud Persistence**: Backed by Firebase Authentication and Cloud Firestore with per-user owner-only security rules.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express
- **Database & Auth**: Firebase Authentication & Cloud Firestore
- **AI & Document Processing**: `@google/genai`, `mammoth`, `docx`

## Getting Started

1. Install dependencies:
   ```bash
   npm install
