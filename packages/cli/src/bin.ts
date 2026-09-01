#!/usr/bin/env node
import { runCli } from "./cli.js";

const result = await runCli(process.argv.slice(2));
if (result.out.length) process.stdout.write(`${result.out.join("\n")}\n`);
if (result.err.length) process.stderr.write(`${result.err.join("\n")}\n`);
process.exit(result.code);
