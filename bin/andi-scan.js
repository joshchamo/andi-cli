#!/usr/bin/env node
import { Command } from 'commander';
import { runScan } from '../src/index.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('andi-scan')
  .description('ANDI Accessibility Scanning CLI')
  .version('1.0.0')
  .argument('<urls...>', 'URLs to scan')
  .option(
    '-b, --browser <browser>',
    'Browser to use: chromium, firefox, webkit',
    'chromium'
  )
  .option('-o, --out <path>', 'Output directory', './runs')
  .option('-s, --screenshots', 'Take screenshots of alerts', false)
  .option('--headed', 'Run in headed mode', false)
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--csv', 'Output results to CSV', false)
  .action(async (urls, options) => {
    try {
      console.log(chalk.blue(`Received ${urls.length} URL(s) to scan.`));

      for (const [index, url] of urls.entries()) {
        console.log(
          chalk.bold(
            `\n--- Starting Scan ${index + 1} of ${urls.length}: ${url} ---`
          )
        );
        try {
          await runScan(url, options);
        } catch (err) {
          console.error(chalk.red(`Failed to scan ${url}:`), err.message);
          // Continue to next URL
        }
      }

      console.log(chalk.green('\nAll requests processed!'));
    } catch (error) {
      console.error(chalk.red('Fatal CLI Error:'), error);
      process.exit(1);
    }
  });

program.parse();
