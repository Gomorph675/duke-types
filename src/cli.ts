#!/usr/bin/env node

import { Command, Option } from 'commander';
import * as path from 'path';
import { run } from './index';
import { DukeTypesConfig } from './config';

const pkg = require('../package.json');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('duke-types')
  .description('Java models in. TypeScript interfaces out.')
  .version(pkg.version);

program
  .command('generate', { isDefault: true })
  .description('Scan Java source files and generate TypeScript types')
  .option('-c, --config <path>', 'Path to config file')
  .option(
    '-i, --include <dirs...>',
    'Java source directories to scan (overrides config)',
  )
  .option('-o, --out <dir>', 'Output directory for TypeScript files (overrides config)')
  .option(
    '-r, --roots <dirs...>',
    'Extra project roots to scan for cross-project imports (overrides config)',
  )
  .addOption(
    new Option('--output-type <type>', 'Output type: interface or type')
      .choices(['interface', 'type'])
      .default(undefined),
  )
  .addOption(
    new Option('--date-type <type>', 'Date type: string or Date')
      .choices(['string', 'Date'])
      .default(undefined),
  )
  .addOption(
    new Option('--nullable <strategy>', 'Nullable strategy')
      .choices(['annotated-only', 'all-optional', 'never'])
      .default(undefined),
  )
  .option('--no-index', 'Skip generating index.ts barrel file')
  .option('--dry-run', 'Print what would be generated without writing files')
  .option('--verbose', 'Show detailed output')
  .action(async (opts) => {
    const cwd = process.cwd();

    // Build config overrides from CLI flags
    const override: Partial<DukeTypesConfig> = {};
    if (opts.include) override.include = opts.include.map((d: string) => path.resolve(cwd, d));
    if (opts.out) override.outDir = path.resolve(cwd, opts.out);
    if (opts.roots) override.projectRoots = opts.roots.map((d: string) => path.resolve(cwd, d));
    if (opts.outputType) override.outputType = opts.outputType;
    if (opts.dateType) override.dateType = opts.dateType;
    if (opts.nullable) override.nullableStrategy = opts.nullable;
    if (opts.noIndex) override.generateIndex = false;

    const verbose = !!opts.verbose;
    const isDryRun = !!opts.dryRun;

    console.log(`\n  duke-types v${pkg.version}\n`);

    try {
      let processed = 0;
      const result = await run({
        cwd,
        configPath: opts.config,
        config: override,
        write: !isDryRun,
        onProgress: (current, total, filePath) => {
          processed = current;
          if (verbose) {
            const rel = path.relative(cwd, filePath);
            process.stdout.write(`  [${current}/${total}] ${rel}\n`);
          } else {
            process.stdout.write(`\r  Scanning... ${current}/${total}`);
          }
        },
      });

      if (!verbose && processed > 0) process.stdout.write('\n');

      if (result.errors.length > 0) {
        console.error(`\n  Errors (${result.errors.length}):`);
        for (const { filePath, error } of result.errors) {
          console.error(`    ${path.relative(cwd, filePath)}: ${error.message}`);
        }
      }

      const outDir = result.config.outDir;
      const genCount = result.generated.length;

      if (genCount === 0) {
        console.log('  No Java classes found.\n');
        return;
      }

      if (isDryRun) {
        console.log(`\n  Would generate ${genCount} file(s) in ${path.relative(cwd, outDir)}:\n`);
        for (const file of result.generated) {
          console.log(`    ${path.relative(outDir, file.absolutePath)}`);
        }
      } else {
        console.log(`\n  Generated ${genCount} file(s) in ${path.relative(cwd, outDir)}/\n`);
        if (verbose) {
          for (const file of result.generated) {
            console.log(`    ${file.relativePath}`);
          }
        }
      }

      if (result.config.generateIndex && !isDryRun) {
        console.log(`  Index file: ${path.relative(cwd, outDir)}/index.ts\n`);
      }
    } catch (err) {
      console.error(`\n  Error: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Create a duke-types.config.json in the current directory')
  .action(() => {
    const fs = require('fs');
    const configPath = path.join(process.cwd(), 'duke-types.config.json');

    if (fs.existsSync(configPath)) {
      console.error('  duke-types.config.json already exists.');
      process.exit(1);
    }

    const defaultConfig = {
      include: ['src/main/java'],
      outDir: 'src/generated/types',
      projectRoots: [],
      filePattern: '**/*.java',
      modelAnnotations: [],
      outputType: 'interface',
      dateType: 'string',
      nullableStrategy: 'annotated-only',
      generateIndex: true,
      skipStaticFields: true,
      skipIgnoredFields: true,
    };

    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf8');
    console.log('  Created duke-types.config.json\n');
  });

program.parse(process.argv);
