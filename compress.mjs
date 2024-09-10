#!/usr/bin/env node

import { stdin, stdout, argv } from 'node:process';

import LZString from './lz_string.mjs';

const outfile = argv[2];

async function read_stdin() {
    let data = '';
    for await (const chunk of process.stdin) {
        data += chunk;
    }
    return data;
}

async function main() {
    const data = await read_stdin();

    const comp = LZString.compressToBase64(data);
    stdout.write(comp);
}
main();
