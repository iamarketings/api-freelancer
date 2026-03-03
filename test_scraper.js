const axios = require('axios');
const cheerio = require('cheerio');

async function testScrape(url, name) {
    try {
        console.log(`\n--- Testing ${name} (${url}) ---`);
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(res.data);

        // Remotive test
        if (name === 'Remotive') {
            const desc = $('.job-description').text().trim() || $('section.tw-mt-16.tw-mb-16').text().trim();
            console.log(`Description found (first 100 chars): ${desc.substring(0, 100)}...`);
            const applyBtn = $('a[href*="/apply/"]').attr('href');
            console.log(`Apply link found: ${applyBtn}`);
        }

        // Jobicy test
        if (name === 'Jobicy') {
            const desc = $('.job__desc').text().trim();
            console.log(`Description found (first 100 chars): ${desc.substring(0, 100)}...`);
            const applyBtn = $('a.jobcy-apply-btn').attr('href') || $('button.popup-with-zoom-anim').text();
            console.log(`Apply button/link: ${applyBtn}`);
        }
    } catch (e) {
        console.error(`Error scraping ${name}: ${e.message}`);
    }
}

async function run() {
    await testScrape('https://remotive.com/remote-jobs/software-development/senior-independent-ai-engineer-architect-1919266', 'Remotive');
    // Need a real Jobicy URL from their API v2
    const jobicyRes = await axios.get('https://jobicy.com/api/v2/remote-jobs?count=1');
    if (jobicyRes.data.jobs && jobicyRes.data.jobs[0]) {
        await testScrape(jobicyRes.data.jobs[0].url, 'Jobicy');
    }
}

run();
