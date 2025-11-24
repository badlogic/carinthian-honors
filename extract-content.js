import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'node-html-parser';

const CONCURRENCY = 5;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, maxRetries = 3) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.text();
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries - 1) {
                const delay = Math.pow(2, attempt) * 1000;
                await sleep(delay);
            }
        }
    }
    throw lastError;
}

function extractMainContent(html) {
    const root = parse(html);
    const main = root.querySelector('#main');
    if (!main) {
        return null;
    }
    let text = main.text
        .replace(/\n\s*\n/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
    return text;
}

async function processEntry(entry) {
    try {
        const html = await fetchWithRetry(entry.url);
        const content = extractMainContent(html);
        if (content) {
            entry.content = content;
            return { success: true, chars: content.length };
        } else {
            return { success: false, error: 'No #main element' };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function processWithConcurrency(entries, concurrency) {
    let index = 0;
    let completed = 0;
    let errors = 0;
    const total = entries.length;

    async function worker() {
        while (index < entries.length) {
            const i = index++;
            const entry = entries[i];
            const result = await processEntry(entry);
            completed++;
            if (result.success) {
                console.log(`[${completed}/${total}] ✓ ${result.chars} chars - ${entry.title.substring(0, 50)}...`);
            } else {
                errors++;
                console.log(`[${completed}/${total}] ✗ ${result.error} - ${entry.title.substring(0, 50)}...`);
            }
        }
    }

    const workers = Array(concurrency).fill(null).map(() => worker());
    await Promise.all(workers);
    return { completed, errors };
}

async function main() {
    const jsonFile = process.argv[2];
    if (!jsonFile) {
        console.error('Usage: node extract-content.js <json-file>');
        process.exit(1);
    }

    console.log(`Reading ${jsonFile}...`);
    const data = JSON.parse(readFileSync(jsonFile, 'utf-8'));
    
    const missingContent = data.filter(entry => !entry.content);
    console.log(`Found ${missingContent.length} entries without content out of ${data.length} total`);
    console.log(`Processing with ${CONCURRENCY} concurrent requests...\n`);

    if (missingContent.length === 0) {
        console.log('Nothing to do!');
        return;
    }

    const { completed, errors } = await processWithConcurrency(missingContent, CONCURRENCY);

    writeFileSync(jsonFile, JSON.stringify(data, null, 2));
    console.log(`\nDone! Updated ${completed - errors} entries, ${errors} errors`);
    console.log(`Written to ${jsonFile}`);
}

main();
