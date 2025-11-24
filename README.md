# Carinthian Honors

Extracts information about honorary awards ("Ehrungen") from Kärntner Landesregierung press releases.

## Prerequisites

- Node.js 18+
- [pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) coding agent: `npm install -g @mariozechner/pi-coding-agent`
- Anthropic API access via `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN` env var

## Setup

```bash
npm install
```

## Pipeline

```
1. scrape-veranstaltungen.js  →  veranstaltungen_YYYY.json (urls + titles)
2. extract-content.js         →  adds full content to each entry
3. extract-ehrungen.js        →  veranstaltungen_YYYY_extracted.json (honors + persons)
```

### Step 1: Scrape event list

```bash
node scrape-veranstaltungen.js 2025
```

Fetches the event calendar page for a year and extracts all event URLs/titles. Output: `veranstaltungen_YYYY.json`

### Step 2: Extract page content

```bash
node extract-content.js veranstaltungen_2025.json
```

Fetches full page content for each entry (5 concurrent requests, 3 retries with backoff). Updates JSON in place.

### Step 3: Extract honors via LLM

```bash
node extract-ehrungen.js veranstaltungen_2025.json
```

Uses `pi` agent to analyze each entry and extract:
- Whether it's an honorary award ceremony
- All persons who received awards (name, gender, specific honor)

Output: `veranstaltungen_YYYY_extracted.json`

**Resumable** - skips already processed URLs. Validates LLM output, retries 3x on failure.

## Output Format

```json
{
  "url": "...",
  "title": "...",
  "content": "...",
  "isEhrung": true,
  "persons": [
    { "name": "Maria Müller", "gender": "female", "honor": "Großes Goldenes Ehrenzeichen" }
  ]
}
```

**Included:** Ehrenzeichen, Verdienstzeichen, Orden, Medaillen, Ehrenkreuze  
**Excluded:** Berufstitel (Hofrat, Schulrat, etc.), diplomas, certifications

### Step 4: Generate reports

```bash
node generate-reports.js veranstaltungen_*_extracted.json
```

Merges multiple extracted JSON files and generates:
- `ehrungen_merged.json` - all entries combined
- `ehrungen_persons.json` - flattened list of all honored persons
- `ehrungen.csv` - Excel-compatible CSV
- `ehrungen_dashboard.html` - interactive dashboard (Tailwind + Chart.js)

## Data Formats

### veranstaltungen_YYYY.json (after Step 1)

```json
[
  { "url": "https://...", "title": "Event title" }
]
```

### veranstaltungen_YYYY.json (after Step 2)

```json
[
  { "url": "https://...", "title": "Event title", "content": "Full page text..." }
]
```

### veranstaltungen_YYYY_extracted.json (after Step 3)

```json
[
  {
    "url": "https://...",
    "title": "Event title",
    "content": "Full page text...",
    "isEhrung": true,
    "persons": [
      { "name": "Maria Müller", "gender": "female", "honor": "Großes Goldenes Ehrenzeichen" }
    ]
  }
]
```

### ehrungen_persons.json (after Step 4)

Flattened list with year extracted from filename:

```json
[
  {
    "name": "Maria Müller",
    "gender": "female",
    "honor": "Großes Goldenes Ehrenzeichen",
    "url": "https://...",
    "year": "2025"
  }
]
```

**Included honors:** Ehrenzeichen, Verdienstzeichen, Orden, Medaillen, Ehrenkreuze  
**Excluded:** Berufstitel (Hofrat, Schulrat, etc.), diplomas, certifications

## Quick Stats

```bash
# Count entries with honors
jq '[.[] | select(.isEhrung == true)] | length' veranstaltungen_2025_extracted.json

# Count total persons honored
jq '[.[] | select(.isEhrung == true) | .persons[]] | length' veranstaltungen_2025_extracted.json
```
