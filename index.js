/*
 * YI Mirrorless Firmware Tools
 * Author: Mario Guggenberger <mg@protyposis.net>
 * Licensed under the GPLv3
 */
'use strict';

const path = require('path');
const firmware = require('./firmware');

if (process.argv.length <= 3) {
    console.log('usage: npm run [unpack] <inputfile>');
    console.log(' unpack: unpacks a firmware file into its sections');
    console.error('Arguments missing');
    return;
}

const command = process.argv[2];
const inputFileName = process.argv[3];
const outputDirectoryName = path.dirname(inputFileName);

try {
    switch (command) {
        case 'unpack':
            firmware.unpack(inputFileName, outputDirectoryName);
            break;

        default:
            console.error(`Unknown command: ${command}`);
    }
} catch (error) {
    console.error(error);
}
