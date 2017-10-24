'use strict';

const fs = require('fs');

const FW_SECTION_HEADER_LENGTH = 0x100;

if (process.argv.length <= 2) {
    console.log('usage: npm run unpack <inputfile>');
    console.error('Arguments missing');
    return;
}

const inputFileName = process.argv[2];
const fd = fs.openSync(inputFileName, 'r');
const buffer = Buffer.alloc(FW_SECTION_HEADER_LENGTH);
let readPosition = 0;

while(true) {
    let bytesRead = fs.readSync(fd, buffer, 0, buffer.length, readPosition);

    if (bytesRead === 0) {
        console.log('EOF');
        return;
    }

    readPosition += bytesRead;

    const header = buffer.toString('ascii').trim();
    console.log(header);
    const parsedHeader = parseHeader(header);

    const sectionBuffer = Buffer.alloc(parsedHeader.sectionLength);
    bytesRead = fs.readSync(fd, sectionBuffer, 0, sectionBuffer.length, readPosition);
    readPosition += bytesRead;

    if (bytesRead < sectionBuffer.length) {
        console.error(`Incomplete section read: ${bytesRead} < ${sectionBuffer.length}`);
        return;
    }
}

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
        // Remove empty items (null strings / spaces)
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
        } else {
            parsedHeader.followingSectionIds = parsedHeader.followingSectionIds || [];
            parsedHeader.followingSectionIds.push(part);
        }
    });

    console.log(parts, parsedHeader);

    return parsedHeader;
}