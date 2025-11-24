import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { spawn } from 'child_process';

const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

function runPi(promptFile) {
    return new Promise((resolve, reject) => {
        const proc = spawn('pi', ['-p', `$(cat ${promptFile})`], {
            shell: true,
            timeout: 600000 // 10 min
        });
        
        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                if (line) console.log(`${CYAN}[pi] ${line}${RESET}`);
            });
        });
        
        proc.stderr.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                if (line) console.log(`${CYAN}[pi] ${line}${RESET}`);
            });
        });
        
        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`pi exited with code ${code}`));
            }
        });
        
        proc.on('error', (err) => {
            reject(err);
        });
    });
}

const BATCH_SIZE = 20;
const MAX_RETRIES = 3;

function validateResult(result) {
    if (!Array.isArray(result)) {
        return { valid: false, error: 'Result is not an array' };
    }
    for (let i = 0; i < result.length; i++) {
        const entry = result[i];
        if (typeof entry.url !== 'string') {
            return { valid: false, error: `Entry ${i}: missing or invalid 'url'` };
        }
        if (typeof entry.title !== 'string') {
            return { valid: false, error: `Entry ${i}: missing or invalid 'title'` };
        }
        if (typeof entry.isEhrung !== 'boolean') {
            return { valid: false, error: `Entry ${i}: missing or invalid 'isEhrung' (must be boolean)` };
        }
        if (!Array.isArray(entry.persons)) {
            return { valid: false, error: `Entry ${i}: missing or invalid 'persons' (must be array)` };
        }
        for (let j = 0; j < entry.persons.length; j++) {
            const person = entry.persons[j];
            if (typeof person.name !== 'string' || !person.name.trim()) {
                return { valid: false, error: `Entry ${i}, person ${j}: missing or invalid 'name'` };
            }
            if (person.gender !== 'male' && person.gender !== 'female') {
                return { valid: false, error: `Entry ${i}, person ${j}: 'gender' must be 'male' or 'female'` };
            }
            if (typeof person.honor !== 'string' || !person.honor.trim()) {
                return { valid: false, error: `Entry ${i}, person ${j}: missing or invalid 'honor'` };
            }
        }
    }
    return { valid: true };
}



async function main() {
    const inputFile = process.argv[2];
    if (!inputFile) {
        console.error('Usage: node extract-ehrungen.js <input.json>');
        process.exit(1);
    }

    const outputFile = inputFile.replace('.json', '_extracted.json');
    const processedFile = inputFile.replace('.json', '_processed_urls.json');
    
    const data = JSON.parse(readFileSync(inputFile, 'utf-8'));
    console.log(`${YELLOW}Loaded ${data.length} entries from ${inputFile}${RESET}`);
    
    // Load existing results
    let existing = [];
    if (existsSync(outputFile)) {
        existing = JSON.parse(readFileSync(outputFile, 'utf-8'));
        console.log(`Loaded ${existing.length} existing results from ${outputFile}`);
    }
    
    // Load processed URLs (includes URLs that had no honorees)
    let processedUrls = new Set();
    if (existsSync(processedFile)) {
        processedUrls = new Set(JSON.parse(readFileSync(processedFile, 'utf-8')));
        console.log(`Loaded ${processedUrls.size} processed URLs from ${processedFile}`);
    }
    
    // Filter out already processed
    const remaining = data.filter(e => !processedUrls.has(e.url));
    console.log(`${remaining.length} entries remaining (${existing.length} already processed)`);
    
    if (remaining.length === 0) {
        console.log('Nothing to do!');
        return;
    }

    // Process in batches
    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
        const batch = remaining.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(remaining.length / BATCH_SIZE);
        
        console.log(`\nProcessing batch ${batchNum}/${totalBatches} (${batch.length} entries)...`);
        
        // Prepare batch data - only send what's needed
        const batchData = batch.map(e => ({
            url: e.url,
            title: e.title,
            content: e.content
        }));
        
        // Write batch to temp file
        const tempInputFile = '/tmp/ehrungen_batch_input.json';
        const tempOutputFile = '/tmp/ehrungen_batch_output.json';
        writeFileSync(tempInputFile, JSON.stringify(batchData, null, 2));
        
        const prompt = `You are analyzing government press releases from Kärnten, Austria to extract information about honorary awards ("Ehrungen" / "Auszeichnungen").

Read the JSON file at ${tempInputFile}. It contains an array of entries with url, title, and content.

For EACH entry, determine:
1. Is this about an honorary award/recognition being given to specific people? (Not just announcements about award programs, but actual ceremonies where named individuals receive honors)
2. If yes, extract ALL persons who received an honor/award/recognition

Write your results to ${tempOutputFile} as a JSON array with this EXACT format:
[
  {
    "url": "the original url",
    "title": "the original title", 
    "isEhrung": true or false,
    "persons": [
      {
        "name": "Full name of person honored (without titles like Dr., Mag., etc.)",
        "gender": "male" or "female",
        "honor": "specific award/honor they received, e.g. 'Großes Goldenes Ehrenzeichen', 'Berufstitel Professor', 'Ehrenring der Stadt'"
      }
    ]
  }
]

IMPORTANT:
- Only include entries where isEhrung is TRUE and persons array is NOT empty
- Skip entries that are about award programs in general without naming recipients
- Skip entries where politicians are just attending/presenting (they are NOT the honorees)
- Extract the ACTUAL honor/award name, not generic descriptions
- Names should be clean: "Maria Müller" not "Frau Mag. Dr. Maria Müller"
- Determine gender from context (titles like "Frau", names, pronouns used)
- If multiple people receive the same honor, list each separately
- If one person receives multiple honors, list them once with the most significant honor

Write ONLY the JSON array to ${tempOutputFile}, nothing else.`;

        // Log the titles we're processing
        console.log('Entries in this batch:');
        batch.forEach((e, idx) => {
            console.log(`  ${idx + 1}. ${e.title.substring(0, 80)}...`);
        });
        
        // Write prompt to temp file for pi to read
        const tempPromptFile = '/tmp/ehrungen_prompt.txt';
        writeFileSync(tempPromptFile, prompt);
        
        console.log(`\nInput: ${tempInputFile}`);
        console.log(`Output will be: ${tempOutputFile}`);
        
        let batchResults = null;
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            console.log(`\nAttempt ${attempt}/${MAX_RETRIES}: Calling pi...`);
            
            try {
                // Remove old output file if exists
                if (existsSync(tempOutputFile)) {
                    writeFileSync(tempOutputFile, '');
                }
                
                await runPi(tempPromptFile);
                
                // Read and validate results
                if (!existsSync(tempOutputFile)) {
                    console.log(`Warning: Output file ${tempOutputFile} not created`);
                    continue;
                }
                
                const raw = readFileSync(tempOutputFile, 'utf-8').trim();
                console.log(`\nRaw output (first 500 chars): ${raw.substring(0, 500)}`);
                
                if (!raw) {
                    console.log('Empty output, retrying...');
                    continue;
                }
                
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch (parseErr) {
                    console.error(`Failed to parse JSON: ${parseErr.message}`);
                    console.log('Retrying...');
                    continue;
                }
                
                const validation = validateResult(parsed);
                if (!validation.valid) {
                    console.error(`Validation failed: ${validation.error}`);
                    console.log('Retrying...');
                    continue;
                }
                
                // Success!
                batchResults = parsed;
                console.log('Validation passed!');
                break;
                
            } catch (err) {
                console.error(`Error: ${err.message}`);
                if (attempt < MAX_RETRIES) {
                    console.log('Retrying...');
                }
            }
        }
        
        if (batchResults === null) {
            console.error(`${RED}Failed to process batch ${batchNum} after ${MAX_RETRIES} attempts, skipping...${RESET}`);
            console.log('\n' + '='.repeat(80) + '\n');
            continue;
        }
        
        const validResults = batchResults.filter(r => r.isEhrung && r.persons && r.persons.length > 0);
        
        // Add full content from original data
        const urlToContent = new Map(batch.map(e => [e.url, e.content]));
        validResults.forEach(r => {
            r.content = urlToContent.get(r.url) || '';
        });
        
        console.log(`\nBatch ${batchNum} results:`);
        validResults.forEach(r => {
            console.log(`  ${r.title.substring(0, 60)}...`);
            r.persons.forEach(p => {
                console.log(`    - ${p.name} (${p.gender}): ${p.honor}`);
            });
        });
        
        // Mark all URLs in batch as processed
        batchResults.forEach(r => processedUrls.add(r.url));
        
        // Add valid results to existing
        existing = existing.concat(validResults);
        
        // Atomic writes: write to temp files first, then rename
        const tempOutputFile2 = outputFile + '.tmp';
        const tempProcessedFile = processedFile + '.tmp';
        
        writeFileSync(tempOutputFile2, JSON.stringify(existing, null, 2));
        writeFileSync(tempProcessedFile, JSON.stringify([...processedUrls], null, 2));
        
        // Rename (atomic on most filesystems)
        renameSync(tempOutputFile2, outputFile);
        renameSync(tempProcessedFile, processedFile);
        
        console.log(`${GREEN}\nBatch ${batchNum}: Found ${validResults.length} entries with honorees${RESET}`);
        console.log(`${GREEN}Total: ${existing.length} results, ${processedUrls.size} URLs processed${RESET}`);
        
        console.log('\n' + '='.repeat(80) + '\n');
    }
    
    console.log(`\nDone! Total: ${existing.length} entries with honorees written to ${outputFile}`);
}

main();
