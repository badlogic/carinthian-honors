# Carinthian Honors

Extracts information about honorary awards ("Ehrungen") from Kärntner Landesregierung press releases.

## Prerequisites

- Node.js 18+
- [pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) coding agent installed globally: `npm install -g @mariozechner/pi-coding-agent`
- Anthropic API access via `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN` environment variable

## Setup

```bash
npm install
```

## Data Files

- `veranstaltungen_2023.json` - Press releases from 2023 (131 entries)
- `veranstaltungen_2024.json` - Press releases from 2024 (173 entries)
- `veranstaltungen_2025.json` - Press releases from 2025 (133 entries)

Each entry has: `date`, `title`, `url`, `content`

## Scripts

### extract-content.js

Scrapes full page content for entries missing the `content` field.

```bash
node extract-content.js <json-file>
```

- Fetches pages with 5 concurrent requests
- Retries failed requests 3x with exponential backoff
- Extracts text from `#main` element
- Updates the JSON file in place

### extract-ehrungen.js

Uses the `pi` LLM agent to extract honorary award recipients from press releases.

```bash
node extract-ehrungen.js <json-file>
```

- Processes entries in batches of 5
- For each entry, determines if it's about an honorary award ceremony
- Extracts all persons who received awards (name, gender, specific honor)
- Validates LLM output against expected schema
- Retries up to 3x on validation failure
- Outputs to `<input>_extracted.json`
- Resumable: skips already processed URLs

**Output format** (`*_extracted.json`):
```json
[
  {
    "url": "...",
    "title": "...",
    "content": "...",
    "isEhrung": true,
    "persons": [
      {
        "name": "Maria Müller",
        "gender": "female",
        "honor": "Großes Goldenes Ehrenzeichen"
      }
    ]
  }
]
```

**What counts as an Ehrung:**
- Ehrenzeichen, Verdienstzeichen, Orden, Medaillen, Ehrenkreuze
- NOT: Berufstitel (Hofrat, Schulrat, etc.), diplomas, certifications

### validate-output.js

Validates the JSON output from the LLM.

```bash
node validate-output.js <json-file>
```

Used internally by `extract-ehrungen.js` - the LLM runs this to verify its output.

## Usage Example

```bash
# Extract honors from 2025 press releases
node extract-ehrungen.js veranstaltungen_2025.json

# Check results
jq '[.[] | select(.isEhrung == true)] | length' veranstaltungen_2025_extracted.json
jq '[.[] | select(.isEhrung == true) | .persons[]] | length' veranstaltungen_2025_extracted.json
```

## Notes

- The LLM is instructed to use `cat` to read prompt files (the `read` tool truncates long lines)
- Extraction quality depends on LLM carefully reading full content and counting people mentioned
- Some articles mention "X Personen ausgezeichnet" - the LLM is instructed to verify its count matches
