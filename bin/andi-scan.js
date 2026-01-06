#!/usr/bin/env node
import { Command } from 'commander';
import { runScan } from '../src/index.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('andi-scan')
  .description('ANDI Accessibility Scanning CLI')
  .version('1.0.0')
  .argument('<url>', 'URL to scan')
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
  .action(async (url, options) => {
    try {
      console.log(chalk.blue(`Starting scan for ${url}...`));
      await runScan(url, options);
      console.log(chalk.green('Scan complete!'));
    } catch (error) {
      console.error(chalk.red('Fatal Error:'), error);
      process.exit(1);
    }
  });

program.parse();
