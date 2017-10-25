'use strict';

const path = require('path');
const firmware = require('./firmware');

if (process.argv.length <= 2) {
    console.log('usage: npm run unpack <inputfile>');
    console.error('Arguments missing');
    return;
}

const inputFileName = process.argv[2];
const outputDirectoryName = path.dirname(inputFileName);

try {
    firmware.unpack(inputFileName, outputDirectoryName);
} catch (error) {
    console.error(error);
}
