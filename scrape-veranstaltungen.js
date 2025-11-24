import { writeFileSync } from 'fs';
import { parse } from 'node-html-parser';

const BASE_URL = 'https://www.ktn.gv.at';

async function fetchPage(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.text();
}

async function scrapeYear(year) {
    const url = `${BASE_URL}/Politik/Landesregierung/LH-Dr-Peter-Kaiser/Protokoll/Veranstaltungen-${year}`;
    console.log(`Fetching ${url}...`);
    
    const html = await fetchPage(url);
    const root = parse(html);
    
    const items = root.querySelectorAll('.protokollItem');
    console.log(`Found ${items.length} items`);
    
    const entries = [];
    
    for (const item of items) {
        // Get the link with pid
        const link = item.querySelector('a[href*="pid="]');
        if (!link) continue;
        
        const href = link.getAttribute('href');
        const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        
        // Get title from h2
        const h2 = item.querySelector('h2');
        const title = h2 ? h2.text.trim() : '';
        
        // Get date - it's in a <strong> tag inside .text
        const textDiv = item.querySelector('.media-body .text');
        const strong = textDiv?.querySelector('strong');
        const date = strong ? strong.text.trim() : '';
        
        entries.push({
            date,
            title,
            url: fullUrl,
            content: null // Will be filled by extract-content.js
        });
    }
    
    return entries;
}

async function main() {
    const year = process.argv[2];
    if (!year) {
        console.error('Usage: node scrape-veranstaltungen.js <year>');
        console.error('Example: node scrape-veranstaltungen.js 2025');
        process.exit(1);
    }
    
    const entries = await scrapeYear(year);
    const outputFile = `veranstaltungen_${year}.json`;
    
    writeFileSync(outputFile, JSON.stringify(entries, null, 2));
    console.log(`Written ${entries.length} entries to ${outputFile}`);
    console.log(`\nNext step: node extract-content.js ${outputFile}`);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
