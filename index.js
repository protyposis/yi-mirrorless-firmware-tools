'use strict';

const fs = require('fs');

const FW_SECTION_HEADER_LENGTH = 0x100;

if (process.argv.length <= 2) {
    console.log('usage: npm run unpack <inputfile>');
    console.error('Arguments missing');
    return;
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

        const header = buffer.toString('ascii');
        console.log(header);
        parseHeader(header);
    });
});

function parseHeader(header) {
    const parsedHeader = {
        sectionId: undefined,
        sectionLength: undefined,
        deviceId: undefined,
        deviceVersion: undefined,
        dvr: undefined,
        sectionSum: undefined,
        sectionOffset: undefined,
        followingSectionIds: undefined,
    };

    const parts = header.split(' ')
        // Remove empty items (null strings)
        .filter((part) => part !== '')
        // Remove whitespace paddings
        .map((part) => part.trim());

    // Parse the header parts into the parsedHeader structure
    parts.forEach((part, index) => {
        const isKeyValue = part.indexOf('=') !== -1;
        // The first part is a potential section Id
        if (!isKeyValue && index === 0) {
            parsedHeader.sectionId = part;
            return;
        }

        // After the potential section Id and the length follows the device Id
        if (!isKeyValue && index < 3) {
            parsedHeader.deviceId = part;
            return;
        }

        if (isKeyValue) {
            const [ key, value ] = part.split('=');

            switch(key) {
                case 'LENGTH':
                    parsedHeader.sectionLength = parseInt(value);
                    break;

                case 'VER':
                    parsedHeader.deviceVersion = value;
                    break;

                case 'DVR':
                    parsedHeader.dvr = value;
                    break;

                case 'SUM':
                    parsedHeader.sectionSum = parseInt(value);
                    break;

                case 'OFFSET':
                    parsedHeader.sectionOffset = parseInt(value);
                    break;
            }
        }
    });

    console.log(parts, parsedHeader);

    return parsedHeader;
}