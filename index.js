/*
 * YI Mirrorless Firmware Tools
 * Author: Mario Guggenberger <mg@protyposis.net>
 * Licensed under the GPLv3
 */
'use strict';

const path = require('path');
const firmware = require('./firmware');

if (process.argv.length <= 3) {
    console.log('usage: npm run [unpack|flipregion|test] <inputfile>');
    console.log(' unpack: unpacks a firmware file into its sections');
    console.log(' flipregion: changes the region of a firmware file between CN and INT');
    console.log(' test: unpacks and repacks a firmware file and compares input to output to validate everything working correctly');
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

        case 'flipregion':
            firmware.flipRegion(inputFileName, outputDirectoryName);
            break;

        case 'test':
            firmware.test(inputFileName, outputDirectoryName);
            break;


        default:
            console.error(`Unknown command: ${command}`);
    }
} catch (error) {
    console.error(error);
}
