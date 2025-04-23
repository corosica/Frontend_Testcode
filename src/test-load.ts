import { chromium, Page } from "playwright";
import { writeFileSync } from "fs";

// Configuration
const CONFIG = {
  USERS: 10, // Number of simulated users
  ITERATIONS_PER_USER: 3, // Each user performs multiple tests for better stats
  TARGET_URL: "http://localhost:3000/products",
  DELAY_BETWEEN_USERS: 500, // ms delay between user starts (to simulate more realistic load)
  SAVE_RESULTS: true, // Whether to save results to a file
  COLLECT_METRICS: true, // Collect additional web vitals metrics
  THROTTLING: {
    // Optional network throttling
    enabled: false,
    download: 1.5 * 1024 * 1024, // 1.5 Mbps download
    upload: 750 * 1024, // 750 Kbps upload
    latency: 40, // 40ms latency
  },
};

interface TestResult {
  userId: number;
  iteration: number;
  loadTime: number;
  domContentLoaded?: number;
  largestContentfulPaint?: number;
  firstContentfulPaint?: number;
  timeToInteractive?: number;
  timestamp: number;
}

async function collectWebVitals(page: Page): Promise<{
  domContentLoaded: number;
  lcp: number;
  fcp: number;
  tti: number;
}> {
  return page.evaluate(() => {
    return new Promise((resolve) => {
      // We need to wait for LCP to be available
      let lcpDone = false;
      let fcpDone = false;

      // Get more accurate DOM content loaded time
      const navEntry = performance.getEntriesByType(
        "navigation"
      )[0] as PerformanceNavigationTiming;
      const domContentLoaded =
        navEntry.domContentLoadedEventEnd - navEntry.startTime;

      // First Contentful Paint
      let fcp = 0;
      const fcpEntry = performance.getEntriesByName("first-contentful-paint");
      if (fcpEntry.length > 0) {
        fcp = fcpEntry[0].startTime;
        fcpDone = true;
      }

      // Largest Contentful Paint
      let lcp = 0;
      new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const lastEntry = entries[entries.length - 1];
        lcp = lastEntry.startTime;
        lcpDone = true;
        checkAllDone();
      }).observe({ type: "largest-contentful-paint", buffered: true });

      // Time to Interactive approximation (not perfect but useful)
      let tti = performance.now(); // Fallback value

      // Use first input or first input delay as an approximation
      new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        if (entries.length > 0) {
          tti = entries[0].startTime;
        }
        checkAllDone();
      }).observe({ type: "first-input", buffered: true });

      function checkAllDone() {
        if (lcpDone && fcpDone) {
          resolve({
            domContentLoaded,
            lcp,
            fcp,
            tti,
          });
        }
      }

      // Fallback in case some metrics don't arrive
      setTimeout(() => {
        resolve({
          domContentLoaded,
          lcp: lcp || 0,
          fcp: fcp || 0,
          tti: tti || 0,
        });
      }, 5000);
    });
  });
}

async function simulateUser(userId: number): Promise<TestResult[]> {
  console.log(`Starting user #${userId}`);
  const results: TestResult[] = [];

  // Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  });

  // Apply network throttling if enabled
  if (CONFIG.THROTTLING.enabled) {
    await context.route("**/*", async (route) => {
      await new Promise((resolve) =>
        setTimeout(resolve, CONFIG.THROTTLING.latency)
      );
      await route.continue();
    });
  }

  // Run iterations
  for (let i = 0; i < CONFIG.ITERATIONS_PER_USER; i++) {
    const page = await context.newPage();

    // Measure navigation time
    const start = Date.now();
    await page.goto(CONFIG.TARGET_URL, { waitUntil: "networkidle" });
    const end = Date.now();
    const loadTime = end - start;

    let webVitals = {
      domContentLoaded: 0,
      lcp: 0,
      fcp: 0,
      tti: 0,
    };

    // Collect additional metrics if enabled
    if (CONFIG.COLLECT_METRICS) {
      try {
        webVitals = await collectWebVitals(page);
      } catch (e) {
        console.error(
          `Failed to collect web vitals for user #${userId}, iteration #${
            i + 1
          }:`,
          e
        );
      }
    }

    const result: TestResult = {
      userId,
      iteration: i + 1,
      loadTime,
      domContentLoaded: webVitals.domContentLoaded,
      largestContentfulPaint: webVitals.lcp,
      firstContentfulPaint: webVitals.fcp,
      timeToInteractive: webVitals.tti,
      timestamp: Date.now(),
    };

    results.push(result);
    console.log(
      `User #${userId}, Iteration #${
        i + 1
      }: Load time = ${loadTime}ms, LCP = ${webVitals.lcp.toFixed(2)}ms`
    );

    await page.close();

    // Short delay between iterations
    if (i < CONFIG.ITERATIONS_PER_USER - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  await browser.close();
  return results;
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateStats(results: TestResult[]) {
  const loadTimes = results.map((r) => r.loadTime);
  const lcpTimes = results
    .map((r) => r.largestContentfulPaint)
    .filter(Boolean) as number[];
  const fcpTimes = results
    .map((r) => r.firstContentfulPaint)
    .filter(Boolean) as number[];

  // Helper function to calculate stats
  const getStats = (arr: number[]) => {
    if (!arr.length)
      return { min: 0, max: 0, avg: 0, median: 0, p95: 0, stdDev: 0 };

    const sorted = [...arr].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = sum / sorted.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];

    // Standard deviation
    const variance =
      sorted.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / sorted.length;
    const stdDev = Math.sqrt(variance);

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg,
      median,
      p95,
      stdDev,
    };
  };

  return {
    loadTime: getStats(loadTimes),
    lcp: getStats(lcpTimes),
    fcp: getStats(fcpTimes),
    sampleSize: results.length,
  };
}

(async () => {
  console.log(
    `Starting performance test with ${CONFIG.USERS} users, ${CONFIG.ITERATIONS_PER_USER} iterations each`
  );
  console.log(`Target URL: ${CONFIG.TARGET_URL}`);

  const allResults: TestResult[] = [];

  // Run tests with staggered starts
  for (let i = 0; i < CONFIG.USERS; i++) {
    const userPromise = simulateUser(i + 1);
    allResults.push(...(await userPromise));

    // Delay between user starts (except for the last user)
    if (i < CONFIG.USERS - 1) {
      await delay(CONFIG.DELAY_BETWEEN_USERS);
    }
  }

  // Calculate and display stats
  const stats = calculateStats(allResults);

  console.log("\n===== TEST RESULTS =====");
  console.log(
    `Sample size: ${stats.sampleSize} (${CONFIG.USERS} users × ${CONFIG.ITERATIONS_PER_USER} iterations)`
  );

  console.log("\n📊 Load Time (ms):");
  console.log(`  Min: ${stats.loadTime.min}`);
  console.log(`  Max: ${stats.loadTime.max}`);
  console.log(`  Avg: ${stats.loadTime.avg.toFixed(2)}`);
  console.log(`  Median: ${stats.loadTime.median.toFixed(2)}`);
  console.log(`  95th Percentile: ${stats.loadTime.p95.toFixed(2)}`);
  console.log(`  Std Deviation: ${stats.loadTime.stdDev.toFixed(2)}`);

  if (CONFIG.COLLECT_METRICS) {
    console.log("\n📊 Largest Contentful Paint (ms):");
    console.log(`  Min: ${stats.lcp.min.toFixed(2)}`);
    console.log(`  Max: ${stats.lcp.max.toFixed(2)}`);
    console.log(`  Avg: ${stats.lcp.avg.toFixed(2)}`);
    console.log(`  Median: ${stats.lcp.median.toFixed(2)}`);
    console.log(`  95th Percentile: ${stats.lcp.p95.toFixed(2)}`);

    console.log("\n📊 First Contentful Paint (ms):");
    console.log(`  Min: ${stats.fcp.min.toFixed(2)}`);
    console.log(`  Max: ${stats.fcp.max.toFixed(2)}`);
    console.log(`  Avg: ${stats.fcp.avg.toFixed(2)}`);
    console.log(`  Median: ${stats.fcp.median.toFixed(2)}`);
    console.log(`  95th Percentile: ${stats.fcp.p95.toFixed(2)}`);
  }

  // Save results to file if enabled
  if (CONFIG.SAVE_RESULTS) {
    const filename = `perf-test-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    writeFileSync(
      filename,
      JSON.stringify(
        {
          config: CONFIG,
          results: allResults,
          stats,
        },
        null,
        2
      )
    );
    console.log(`\nResults saved to ${filename}`);
  }
})();
