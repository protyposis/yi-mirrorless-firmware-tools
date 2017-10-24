'use strict';

const fs = require('fs');

const FW_SECTION_HEADER_LENGTH = 0x100;

if (process.argv.length <= 2) {
    throw 'Arguments missing';
}

const inputFileName = process.argv[2];

fs.open(inputFileName, 'r', (err, fd) => {
    if (err) {
        throw err.message;
    }

    let buffer = Buffer.alloc(FW_SECTION_HEADER_LENGTH);

    fs.read(fd, buffer, 0, FW_SECTION_HEADER_LENGTH, 0, (err, bytesRead, buffer) => {
        if (err) {
            throw err.message;
        }

        console.log(buffer.toString('ascii'));
    });
});