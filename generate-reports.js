#!/usr/bin/env node

/**
 * Merges extracted JSON files, generates Excel and HTML dashboard
 * Usage: node generate-reports.js veranstaltungen_2023_extracted.json veranstaltungen_2024_extracted.json ...
 */

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

// Check arguments
const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('Usage: node generate-reports.js <file1.json> <file2.json> ...');
    console.error('Example: node generate-reports.js veranstaltungen_*_extracted.json');
    process.exit(1);
}

// Extract year from filename (e.g., veranstaltungen_2023_extracted.json -> 2023)
function extractYear(filename) {
    const match = filename.match(/(\d{4})/);
    return match ? match[1] : 'unknown';
}

// Merge all JSON files and flatten persons with metadata
function mergeAndFlatten(files) {
    const allPersons = [];
    const merged = [];

    for (const file of files) {
        const year = extractYear(file);
        console.log(`Processing ${file} (year: ${year})...`);
        
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        merged.push(...data);

        for (const entry of data) {
            if (entry.isEhrung && entry.persons && entry.persons.length > 0) {
                for (const person of entry.persons) {
                    allPersons.push({
                        name: person.name,
                        gender: person.gender,
                        honor: person.honor,
                        url: entry.url,
                        year: year
                    });
                }
            }
        }
    }

    return { merged, allPersons };
}

// Generate Excel file
function generateExcel(persons, outputPath) {
    const data = persons.map(p => ({
        Name: p.name,
        Geschlecht: p.gender === 'female' ? 'Weiblich' : 'Männlich',
        Ehrung: p.honor,
        URL: p.url,
        Jahr: p.year
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Ehrungen');
    
    // Auto-size columns
    const colWidths = [
        { wch: 30 },  // Name
        { wch: 12 },  // Geschlecht
        { wch: 50 },  // Ehrung
        { wch: 80 },  // URL
        { wch: 8 }    // Jahr
    ];
    worksheet['!cols'] = colWidths;

    XLSX.writeFile(workbook, outputPath);
    console.log(`Excel written to ${outputPath}`);
}

// Generate HTML dashboard
function generateDashboard(persons, outputPath) {
    // Pre-compute statistics for the dashboard
    const stats = {
        byYear: {},
        byGender: {},
        byHonor: {},
        byYearGender: {}
    };

    for (const p of persons) {
        // By year
        stats.byYear[p.year] = (stats.byYear[p.year] || 0) + 1;
        
        // By gender
        stats.byGender[p.gender] = (stats.byGender[p.gender] || 0) + 1;
        
        // By honor (use original honor name)
        stats.byHonor[p.honor] = (stats.byHonor[p.honor] || 0) + 1;
        
        // By year and gender
        const ygKey = `${p.year}`;
        if (!stats.byYearGender[ygKey]) {
            stats.byYearGender[ygKey] = { male: 0, female: 0, other: 0 };
        }
        if (p.gender === 'male') stats.byYearGender[ygKey].male++;
        else if (p.gender === 'female') stats.byYearGender[ygKey].female++;
        else stats.byYearGender[ygKey].other++;
    }

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kärntner Ehrungen Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        .chart-container { position: relative; height: 300px; }
        @media (min-width: 768px) { .chart-container { height: 350px; } }
    </style>
</head>
<body class="bg-gray-100 min-h-screen">
    <div class="container mx-auto px-4 py-8">
        <h1 class="text-3xl font-bold text-gray-800 mb-2">Kärntner Ehrungen Dashboard</h1>
        <p class="text-gray-600 mb-8">Datenanalyse der Ehrungen des Landes Kärnten</p>
        
        <!-- Summary Cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div class="bg-white rounded-lg shadow p-6">
                <div class="text-3xl font-bold text-blue-600" id="total-count">${persons.length}</div>
                <div class="text-gray-500">Gesamt Ehrungen</div>
            </div>
            <div class="bg-white rounded-lg shadow p-6">
                <div class="text-3xl font-bold text-pink-600" id="female-count">${stats.byGender.female || 0}</div>
                <div class="text-gray-500">Frauen</div>
            </div>
            <div class="bg-white rounded-lg shadow p-6">
                <div class="text-3xl font-bold text-blue-400" id="male-count">${stats.byGender.male || 0}</div>
                <div class="text-gray-500">Männer</div>
            </div>
            <div class="bg-white rounded-lg shadow p-6">
                <div class="text-3xl font-bold text-green-600" id="category-count">${Object.keys(stats.byHonor).length}</div>
                <div class="text-gray-500">Kategorien</div>
            </div>
        </div>

        <!-- Filters -->
        <div class="bg-white rounded-lg shadow p-6 mb-8">
            <h2 class="text-xl font-semibold mb-4">Filter</h2>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Jahr</label>
                    <select id="filter-year" class="w-full border rounded-md p-2">
                        <option value="">Alle Jahre</option>
                        ${Object.keys(stats.byYear).sort().map(y => `<option value="${y}">${y}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Geschlecht</label>
                    <select id="filter-gender" class="w-full border rounded-md p-2">
                        <option value="">Alle</option>
                        <option value="female">Weiblich</option>
                        <option value="male">Männlich</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Kategorie</label>
                    <select id="filter-honor" class="w-full border rounded-md p-2">
                        <option value="">Alle Kategorien</option>
                        ${Object.keys(stats.byHonor).sort().map(h => `<option value="${h}">${h}</option>`).join('')}
                    </select>
                </div>
            </div>

        </div>

        <!-- Charts Row 1 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <div class="bg-white rounded-lg shadow p-6">
                <h2 class="text-xl font-semibold mb-4">Ehrungen pro Jahr</h2>
                <div class="chart-container">
                    <canvas id="chart-year"></canvas>
                </div>
            </div>
            <div class="bg-white rounded-lg shadow p-6">
                <h2 class="text-xl font-semibold mb-4">Geschlechterverteilung</h2>
                <div class="chart-container">
                    <canvas id="chart-gender"></canvas>
                </div>
            </div>
        </div>

        <!-- Charts Column -->
        <div class="space-y-8 mb-8">
            <div class="bg-white rounded-lg shadow p-6">
                <h2 class="text-xl font-semibold mb-4">Geschlecht pro Jahr</h2>
                <div class="chart-container">
                    <canvas id="chart-year-gender"></canvas>
                </div>
            </div>
            <div class="bg-white rounded-lg shadow p-6">
                <h2 class="text-xl font-semibold mb-4">Kategorien nach Geschlecht</h2>
                <div id="chart-honor-container" style="position: relative; min-height: 400px;">
                    <canvas id="chart-honor"></canvas>
                </div>
            </div>
        </div>

        <!-- Data Table -->
        <div class="bg-white rounded-lg shadow p-6">
            <h2 class="text-xl font-semibold mb-4">Daten (<span id="filtered-count">${persons.length}</span> Einträge)</h2>
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort="name">Name ↕</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort="gender">Geschlecht ↕</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort="honor">Ehrung ↕</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort="year">Jahr ↕</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Link</th>
                        </tr>
                    </thead>
                    <tbody id="data-table" class="bg-white divide-y divide-gray-200">
                    </tbody>
                </table>
            </div>

        </div>
    </div>

    <script>
        // Data
        const allData = ${JSON.stringify(persons)};
        const honorCategories = ${JSON.stringify(stats.byHonor)};
        


        // State
        let filteredData = [...allData];
        let sortColumn = 'year';
        let sortDirection = 'desc';

        // Charts
        let chartYear, chartGender, chartYearGender, chartHonor;

        function initCharts() {
            const years = [...new Set(allData.map(d => d.year))].sort();
            
            // Year chart
            const yearCtx = document.getElementById('chart-year').getContext('2d');
            chartYear = new Chart(yearCtx, {
                type: 'bar',
                data: {
                    labels: years,
                    datasets: [{
                        label: 'Ehrungen',
                        data: years.map(y => allData.filter(d => d.year === y).length),
                        backgroundColor: 'rgba(59, 130, 246, 0.8)'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } }
                }
            });

            // Gender pie chart
            const genderCtx = document.getElementById('chart-gender').getContext('2d');
            chartGender = new Chart(genderCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Männlich', 'Weiblich'],
                    datasets: [{
                        data: [
                            allData.filter(d => d.gender === 'male').length,
                            allData.filter(d => d.gender === 'female').length
                        ],
                        backgroundColor: ['rgba(96, 165, 250, 0.8)', 'rgba(244, 114, 182, 0.8)']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });

            // Year-Gender stacked bar chart
            const ygCtx = document.getElementById('chart-year-gender').getContext('2d');
            chartYearGender = new Chart(ygCtx, {
                type: 'bar',
                data: {
                    labels: years,
                    datasets: [
                        {
                            label: 'Männlich',
                            data: years.map(y => allData.filter(d => d.year === y && d.gender === 'male').length),
                            backgroundColor: 'rgba(96, 165, 250, 0.8)'
                        },
                        {
                            label: 'Weiblich',
                            data: years.map(y => allData.filter(d => d.year === y && d.gender === 'female').length),
                            backgroundColor: 'rgba(244, 114, 182, 0.8)'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { x: { stacked: true }, y: { stacked: true } }
                }
            });

            // Honor categories with gender breakdown
            updateHonorChart();
        }

        function updateHonorChart() {
            // Calculate honor counts by gender
            const honorByGender = {};
            filteredData.forEach(d => {
                if (!honorByGender[d.honor]) {
                    honorByGender[d.honor] = { male: 0, female: 0 };
                }
                if (d.gender === 'male') honorByGender[d.honor].male++;
                else if (d.gender === 'female') honorByGender[d.honor].female++;
            });

            // Sort by total count descending
            const sortedHonors = Object.entries(honorByGender)
                .map(([honor, counts]) => ({ honor, ...counts, total: counts.male + counts.female }))
                .sort((a, b) => b.total - a.total);

            const labels = sortedHonors.map(h => h.honor);
            const maleData = sortedHonors.map(h => h.male);
            const femaleData = sortedHonors.map(h => h.female);

            // Adjust chart height based on number of categories
            const chartHeight = Math.max(400, sortedHonors.length * 25);
            document.getElementById('chart-honor-container').style.height = chartHeight + 'px';

            if (chartHonor) {
                chartHonor.destroy();
            }

            const honorCtx = document.getElementById('chart-honor').getContext('2d');
            chartHonor = new Chart(honorCtx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Männlich',
                            data: maleData,
                            backgroundColor: 'rgba(96, 165, 250, 0.8)'
                        },
                        {
                            label: 'Weiblich',
                            data: femaleData,
                            backgroundColor: 'rgba(244, 114, 182, 0.8)'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    scales: {
                        x: { stacked: true },
                        y: { stacked: true }
                    }
                }
            });
        }

        function updateCharts() {
            const years = [...new Set(allData.map(d => d.year))].sort();
            
            chartYear.data.datasets[0].data = years.map(y => filteredData.filter(d => d.year === y).length);
            chartYear.update();

            chartGender.data.datasets[0].data = [
                filteredData.filter(d => d.gender === 'male').length,
                filteredData.filter(d => d.gender === 'female').length
            ];
            chartGender.update();

            chartYearGender.data.datasets[0].data = years.map(y => filteredData.filter(d => d.year === y && d.gender === 'male').length);
            chartYearGender.data.datasets[1].data = years.map(y => filteredData.filter(d => d.year === y && d.gender === 'female').length);
            chartYearGender.update();

            // Recalculate honor categories for filtered data
            updateHonorChart();
        }

        function updateSummary() {
            document.getElementById('total-count').textContent = filteredData.length;
            document.getElementById('female-count').textContent = filteredData.filter(d => d.gender === 'female').length;
            document.getElementById('male-count').textContent = filteredData.filter(d => d.gender === 'male').length;
            const honorSet = new Set(filteredData.map(d => d.honor));
            document.getElementById('category-count').textContent = honorSet.size;
        }

        function renderTable() {
            const tbody = document.getElementById('data-table');

            tbody.innerHTML = filteredData.map(d => \`
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 text-sm">\${d.name}</td>
                    <td class="px-4 py-3 text-sm">
                        <span class="px-2 py-1 rounded-full text-xs \${d.gender === 'female' ? 'bg-pink-100 text-pink-800' : 'bg-blue-100 text-blue-800'}">
                            \${d.gender === 'female' ? 'W' : 'M'}
                        </span>
                    </td>
                    <td class="px-4 py-3 text-sm">\${d.honor}</td>
                    <td class="px-4 py-3 text-sm">\${d.year}</td>
                    <td class="px-4 py-3 text-sm">
                        <a href="\${d.url}" target="_blank" class="text-blue-600 hover:underline">→</a>
                    </td>
                </tr>
            \`).join('');

            document.getElementById('filtered-count').textContent = filteredData.length;
        }

        function applyFilters() {
            const year = document.getElementById('filter-year').value;
            const gender = document.getElementById('filter-gender').value;
            const honor = document.getElementById('filter-honor').value;

            filteredData = allData.filter(d => {
                if (year && d.year !== year) return false;
                if (gender && d.gender !== gender) return false;
                if (honor && d.honor !== honor) return false;
                return true;
            });

            // Sort
            filteredData.sort((a, b) => {
                let va = a[sortColumn] || '';
                let vb = b[sortColumn] || '';
                if (sortColumn === 'year') {
                    va = parseInt(va) || 0;
                    vb = parseInt(vb) || 0;
                }
                if (va < vb) return sortDirection === 'asc' ? -1 : 1;
                if (va > vb) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            });

            renderTable();
            updateCharts();
            updateSummary();
        }

        // Event listeners
        document.getElementById('filter-year').addEventListener('change', applyFilters);
        document.getElementById('filter-gender').addEventListener('change', applyFilters);
        document.getElementById('filter-honor').addEventListener('change', applyFilters);

        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (sortColumn === col) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortColumn = col;
                    sortDirection = 'asc';
                }
                applyFilters();
            });
        });

        // Init
        initCharts();
        applyFilters();
    </script>
</body>
</html>`;

    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(`Dashboard written to ${outputPath}`);
}



// Main
const { merged, allPersons } = mergeAndFlatten(args);

console.log(`\nTotal entries: ${merged.length}`);
console.log(`Total persons honored: ${allPersons.length}`);

// Write outputs
fs.writeFileSync('ehrungen_merged.json', JSON.stringify(merged, null, 2), 'utf-8');
console.log('Merged JSON written to ehrungen_merged.json');

fs.writeFileSync('ehrungen_persons.json', JSON.stringify(allPersons, null, 2), 'utf-8');
console.log('Persons JSON written to ehrungen_persons.json');

generateExcel(allPersons, 'ehrungen.xlsx');
generateDashboard(allPersons, 'ehrungen_dashboard.html');

console.log('\nDone! Open ehrungen_dashboard.html in a browser.');
