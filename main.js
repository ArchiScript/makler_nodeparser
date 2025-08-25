import dotenv from 'dotenv';
import puppeteer from 'puppeteer';
import https from 'https';
import axios from 'axios';
import express from 'express';
import winston from 'winston';
import 'winston-daily-rotate-file';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: './dev.env' });
}

const transport = new winston.transports.DailyRotateFile({
  filename: 'logs/parser.log',
  maxSize: '1m',
  maxFiles: 1,
  zippedArchive: false,
  datePattern: '',
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) =>
      `${timestamp} [${level}] ${message}`
    )
  ),
  transports: [transport],
});

const token = process.env.API_TOKEN;
const apiBase = process.env.API_BASE;
const isDev = process.env.NODE_ENV !== 'production';

const httpsAgent = isDev
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

// Scraper function extracted for reuse
async function runScraper() {
  const browser = await connectToBrowserless();

  console.time('execution time');

  // Shared page for normal runs
  const sharedPage = await browser.newPage();
  await setupRequestInterception(sharedPage);

  await sharedPage.goto('https://makler.md/ru/an/user/index/id/1262205');

  let refs = await sharedPage.$$eval('.ls-detail_anUrl', (elements) =>
    elements.map((el) => el.href)
  );
  console.log('found links: ', refs.length);

  refs = refs.slice(0, 3);
  const items = [];

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    console.time(`Step ${i + 1}`);
    console.log(`\n=== Step ${i + 1}/${refs.length} ===`);
    console.log(`Navigating to: ${ref}`);

    let itemObject = null;

    try {
      // Try with shared page first
      itemObject = await scrapePage(browser, sharedPage, ref);
    } catch (err) {
      console.warn(`Shared page failed for ${ref}: ${err.message}`);

      if (err.message.includes('frame was detached')) {
        console.log(`⚠️ Retrying ${ref} in a fresh tab...`);
        const newPage = await browser.newPage();
        await setupRequestInterception(newPage);

        try {
          itemObject = await scrapePage(browser, newPage, ref);
        } catch (innerErr) {
          console.error(`❌ Even fresh tab failed for ${ref}: ${innerErr.message}`);
        } finally {
          await newPage.close();
        }
      }
    }

    if (itemObject) {
      items.push(itemObject);
      console.log(`✅ Step ${i + 1} completed`);
    }

    console.timeEnd(`Step ${i + 1}`);

    // Small delay between steps
    await new Promise((res) => setTimeout(res, 100));
  }

  console.log(`All ${refs.length} pages processed!`);
  console.log('Sending data via API...');

  let inserted = null;
  if (items.length > 0) {
    inserted = await postData(`${apiBase}/v1/makler_job_stats?token=${token}`, items);
    console.log(inserted);
  }

  await browser.close();
  console.timeEnd('execution time');
  return inserted;
}

// 🔹 Page scraping logic (reused by shared and fresh page)
async function scrapePage(browser, page, ref, maxRetries = 3) {
  let itemObject = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(ref, { waitUntil: 'domcontentloaded', timeout: 8000 });
      console.log(`✅ Page loaded (attempt ${attempt})`);

      await page.waitForSelector('#contentWrapper', { timeout: 3000 });

      itemObject = await page.$eval('#contentWrapper', (el, ref) => {
        const title = el.querySelector('h1')?.textContent?.trim();
        const $info = el.querySelector('.item_title_info');
        const spans = $info?.querySelectorAll('span') || [];
        const city = spans[0]?.textContent?.trim();
        const viewsText = spans[2]?.textContent?.trim();
        const viewsMatch = viewsText?.match(/^Просмотров:\s*?(?<views>\d+)$/);
        const views = viewsMatch ? parseInt(viewsMatch['views']) : null;
        const $content = el.querySelector('#anText');
        let urls = Array.from($content?.querySelectorAll('a') || [])
          .map((a) => a.textContent)
          .filter((url) => url.match(/https:\/\/job.hi-tech.md\/job\//));
        return { url: ref, title, city, views, target_urls: urls.join(',') };
      }, ref);

      break; // ✅ success, exit retry loop
    } catch (err) {
      console.warn(`Attempt ${attempt} failed for ${ref}: ${err.message}`);
      if (attempt < maxRetries) {
        console.log('Retrying in 500ms...');
        await new Promise((res) => setTimeout(res, 500));
      } else {
        throw err; // ❌ bubble up to hybrid handler
      }
    }
  }

  return itemObject;
}

// 🔹 Request interception setup (DRY helper)
async function setupRequestInterception(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const resourceType = req.resourceType();
    if (['image', 'stylesheet', 'font'].includes(resourceType)) {
      req.abort();
    } else {
      req.continue();
    }
  });
}


async function postData(url, payload) {
  try {
    console.log(payload);
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
      httpsAgent,
    });
    return response.data;
  } catch (error) {
    console.error('Error:', error.message || error);
    return null;
  }
}

async function connectToBrowserless(retries = 5, delayMs = 2000) {
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`WS_ENDPOINT env var: ${process.env.WS_ENDPOINT}`);

  const endpoint = process.env.NODE_ENV === 'development' ? process.env.WS_ENDPOINT : 'ws://browserless:3000';
  console.log(`Using browserless endpoint: ${endpoint}`);

  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Attempt ${i + 1}: Connecting to browserless at ${endpoint}...`);
      const browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
      console.log('Successfully connected to browserless!');
      return browser;
    } catch (err) {
      console.error(`Attempt ${i + 1} failed with error: ${err.message || err}`);
      if (i < retries - 1) {
        console.log(`Retrying in ${delayMs}ms...`);
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }
  throw new Error(`Failed to connect to browserless at ${endpoint} after ${retries} attempts`);
}

// Express server setup
const app = express();
const PORT = process.env.PORT || 35001;


//scraper endpoint
app.post('/run', async (req, res) => {
  console.log('Received /run request');
  try {
    const result = await runScraper();
    res.status(200).json({ status: 'success', result });
  } catch (error) {
    console.error('Scraper error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});


// Health check endpoint
app.get('/test', async (req, res) => {
  try {
    res.status(200).json({ status: 'ok', message: 'Service healthy' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});



app.listen(PORT, '0.0.0.0',() => {
  console.log(`Scraper server listening on port ${PORT}`);
});
