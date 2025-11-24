#!/usr/bin/env node
import { readFileSync } from 'fs';

const file = process.argv[2];
if (!file) {
    console.error('Usage: node validate-output.js <json-file>');
    process.exit(1);
}

try {
    const raw = readFileSync(file, 'utf-8').trim();
    
    if (!raw) {
        console.log('ERROR: File is empty');
        process.exit(1);
    }
    
    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        console.log(`ERROR: Invalid JSON - ${e.message}`);
        process.exit(1);
    }
    
    if (!Array.isArray(data)) {
        console.log('ERROR: Root must be an array');
        process.exit(1);
    }
    
    for (let i = 0; i < data.length; i++) {
        const entry = data[i];
        
        if (typeof entry.url !== 'string') {
            console.log(`ERROR: Entry ${i}: missing or invalid 'url' (must be string)`);
            process.exit(1);
        }
        if (typeof entry.isEhrung !== 'boolean') {
            console.log(`ERROR: Entry ${i}: missing or invalid 'isEhrung' (must be true or false)`);
            process.exit(1);
        }
        if (!Array.isArray(entry.persons)) {
            console.log(`ERROR: Entry ${i}: missing or invalid 'persons' (must be array)`);
            process.exit(1);
        }
        
        for (let j = 0; j < entry.persons.length; j++) {
            const person = entry.persons[j];
            
            if (typeof person.name !== 'string' || !person.name.trim()) {
                console.log(`ERROR: Entry ${i}, person ${j}: missing or invalid 'name' (must be non-empty string)`);
                process.exit(1);
            }
            if (person.gender !== 'male' && person.gender !== 'female') {
                console.log(`ERROR: Entry ${i}, person ${j}: 'gender' must be exactly "male" or "female"`);
                process.exit(1);
            }
            if (typeof person.honor !== 'string' || !person.honor.trim()) {
                console.log(`ERROR: Entry ${i}, person ${j}: missing or invalid 'honor' (must be non-empty string)`);
                process.exit(1);
            }
        }
    }
    
    console.log(`OK: Valid JSON with ${data.length} entries`);
    process.exit(0);
    
} catch (e) {
    console.log(`ERROR: Could not read file - ${e.message}`);
    process.exit(1);
}
