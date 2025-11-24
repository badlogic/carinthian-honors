import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { spawn } from 'child_process';

const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

function runPi(prompt) {
    return new Promise((resolve, reject) => {
        // Write prompt to a temp file and use shell to read it
        const promptFile = '/tmp/pi_prompt_cmd.txt';
        writeFileSync(promptFile, prompt);
        
        const proc = spawn('bash', ['-c', `pi --mode json -p "$(cat ${promptFile})"`], {
            timeout: 600000 // 10 min
        });
        
        let buffer = '';
        let lastTextContent = '';
        
        proc.stdout.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);
                    handlePiEvent(event, (text) => {
                        // Only log new text content
                        if (text !== lastTextContent) {
                            const newText = text.slice(lastTextContent.length);
                            if (newText) {
                                process.stdout.write(`${CYAN}${newText}${RESET}`);
                            }
                            lastTextContent = text;
                        }
                    });
                } catch (e) {
                    // Not JSON, just log it
                    console.log(`${DIM}[pi] ${line}${RESET}`);
                }
            }
        });
        
        proc.stderr.on('data', (data) => {
            process.stderr.write(`${DIM}${data}${RESET}`);
        });
        
        proc.on('close', (code) => {
            if (lastTextContent) console.log(); // Newline after streaming
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

function handlePiEvent(event, onText) {
    switch (event.type) {
        case 'agent_start':
            console.log(`${DIM}[pi] Agent started${RESET}`);
            break;
        case 'agent_end':
            console.log(`${DIM}[pi] Agent finished${RESET}`);
            break;
        case 'turn_start':
            break;
        case 'turn_end':
            break;
        case 'message_start':
            if (event.message?.role === 'assistant') {
                process.stdout.write(`${CYAN}[pi] `);
            } else if (event.message?.role === 'user') {
                // Log user message
                const content = event.message?.content;
                if (typeof content === 'string') {
                    console.log(`${YELLOW}[user] ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}${RESET}`);
                } else if (Array.isArray(content)) {
                    const text = content.filter(p => p.type === 'text').map(p => p.text).join('');
                    console.log(`${YELLOW}[user] ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}${RESET}`);
                }
            }
            break;
        case 'message_update':
            // Extract text from assistant message
            if (event.message?.role === 'assistant' && event.message?.content) {
                const textParts = event.message.content
                    .filter(p => p.type === 'text')
                    .map(p => p.text)
                    .join('');
                onText(textParts);
            }
            break;
        case 'message_end':
            break;
        case 'tool_execution_start':
            console.log(`${DIM}[pi] Tool: ${event.toolName}${RESET}`);
            break;
        case 'tool_execution_end':
            if (event.isError) {
                console.log(`${RED}[pi] Tool error: ${event.toolName}${RESET}`);
            }
            break;
    }
}

const BATCH_SIZE = 5;
const MAX_RETRIES = 3;

function validateResult(result, expectedUrls) {
    if (!Array.isArray(result)) {
        return { valid: false, error: 'Result is not an array' };
    }
    
    // Check that we got all expected URLs
    const resultUrls = new Set(result.map(r => r.url));
    const missingUrls = expectedUrls.filter(url => !resultUrls.has(url));
    if (missingUrls.length > 0) {
        return { valid: false, error: `Missing ${missingUrls.length} URLs in output: ${missingUrls[0]}...` };
    }
    
    for (let i = 0; i < result.length; i++) {
        const entry = result[i];
        if (typeof entry.url !== 'string') {
            return { valid: false, error: `Entry ${i}: missing or invalid 'url'` };
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
    
    const data = JSON.parse(readFileSync(inputFile, 'utf-8'));
    console.log(`${YELLOW}Loaded ${data.length} entries from ${inputFile}${RESET}`);
    
    // Load existing results
    let existing = [];
    if (existsSync(outputFile)) {
        existing = JSON.parse(readFileSync(outputFile, 'utf-8'));
        console.log(`Loaded ${existing.length} existing results from ${outputFile}`);
    }
    
    // Filter out already processed (URLs already in extracted.json)
    const processedUrls = new Set(existing.map(e => e.url));
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

IMPORTANT: The data is provided inline below. DO NOT use the read tool - it truncates long lines. All data you need is already in this prompt.

=== JSON DATA TO ANALYZE ===

${JSON.stringify(batchData, null, 2)}

=== INSTRUCTIONS ===

For EACH entry above, you must:
1. Determine if this is about an honorary award/recognition being given to specific named people
2. If yes, extract ALL persons who received an honor/award/recognition

THINK OUT LOUD for each entry:
- First, identify if the article is about an award ceremony
- If yes, list EVERY person mentioned who received an award
- Count them to make sure you didn't miss anyone (titles often say "X Personen ausgezeichnet" - verify your count matches!)
- Note the specific award each person received

Then write your results to ${tempOutputFile} as a JSON array with this EXACT format:
[
  {
    "url": "the original url",
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

CRITICAL RULES:
- Include ALL entries from the input, even if isEhrung is false (set persons to empty array [])
- Politicians presenting awards are NOT honorees - only extract the RECIPIENTS
- Extract the ACTUAL award name, not generic descriptions
- Names should be clean: "Maria Müller" not "Frau Mag. Dr. Maria Müller"
- Determine gender from context (titles like "Frau", names, pronouns)
- If multiple people receive the same honor, list each separately
- If one person receives multiple honors, list them once with the most significant honor
- READ THE ENTIRE CONTENT - some articles mention 7+ people, extract ALL of them
- Look for: "wurde ausgezeichnet", "erhielt", "überreichte", "wurde gewürdigt", "bekam", "ging an"
- Berufstitel (like Hofrat, Schulrat, Oberstudienrat, etc.) are NOT honorary awards - skip these entirely
- Only include actual Ehrenzeichen, Verdienstzeichen, Orden, Medaillen, Ehrenkreuze, etc.

After writing the file, run: node validate-output.js ${tempOutputFile}
If validation fails, fix the JSON and try again until it passes.

Write ONLY valid JSON to ${tempOutputFile}, no markdown formatting.`;

        // Log the titles we're processing
        console.log('Entries in this batch:');
        batch.forEach((e, idx) => {
            console.log(`  ${idx + 1}. ${e.title.substring(0, 80)}...`);
        });
        
        // Write full prompt to temp file
        const tempPromptFile = '/tmp/ehrungen_prompt.txt';
        writeFileSync(tempPromptFile, prompt);
        const wrappedPrompt = `Use cat to read the file ${tempPromptFile} and then execute the instructions contained within it. Do NOT use the read tool as it truncates content.`;
        
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
                
                await runPi(wrappedPrompt);
                
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
                
                const expectedUrls = batchData.map(e => e.url);
                const validation = validateResult(parsed, expectedUrls);
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
        
        // Add title and content from original data to ALL results
        const urlToData = new Map(batch.map(e => [e.url, { title: e.title, content: e.content }]));
        batchResults.forEach(r => {
            const orig = urlToData.get(r.url) || {};
            r.title = orig.title || '';
            r.content = orig.content || '';
        });
        
        const ehrungen = batchResults.filter(r => r.isEhrung && r.persons && r.persons.length > 0);
        
        console.log(`\nBatch ${batchNum} results: ${ehrungen.length} Ehrungen found`);
        ehrungen.forEach(r => {
            console.log(`  ${r.title.substring(0, 60)}...`);
            r.persons.forEach(p => {
                console.log(`    - ${p.name} (${p.gender}): ${p.honor}`);
            });
        });
        
        // Add ALL results to existing (so we know what's been processed)
        existing = existing.concat(batchResults);
        
        // Atomic write: write to temp file first, then rename
        const tempOutputFile2 = outputFile + '.tmp';
        writeFileSync(tempOutputFile2, JSON.stringify(existing, null, 2));
        renameSync(tempOutputFile2, outputFile);
        
        console.log(`${GREEN}\nBatch ${batchNum}: Found ${ehrungen.length} entries with honorees${RESET}`);
        console.log(`${GREEN}Total: ${existing.length} URLs processed${RESET}`);
        
        console.log('\n' + '='.repeat(80) + '\n');
    }
    
    console.log(`\nDone! Total: ${existing.length} entries with honorees written to ${outputFile}`);
}

main();
